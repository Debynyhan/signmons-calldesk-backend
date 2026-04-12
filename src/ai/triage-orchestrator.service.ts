import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { CommunicationChannel } from "@prisma/client";
import { AI_PROVIDER } from "./ai.constants";
import type { IAiProvider } from "./interfaces/ai-provider.interface";
import { AiErrorHandler } from "./ai-error.handler";
import { LoggingService } from "../logging/logging.service";
import { ToolSelectorService } from "./tools/tool-selector.service";
import { AiPromptOrchestrationService } from "./prompts/prompt-orchestration.service";
import { CallLogService } from "../logging/call-log.service";
import appConfig from "../config/app.config";
import { getRequestContext } from "../common/context/request-context";
import {
  isAiRouteIntent,
  type AiRouteIntent,
} from "./routing/ai-route-state";
import type {
  AiAssistantMessage,
  AiChatMessageParam,
  AiToolCall,
} from "./types/ai-completion.types";
import { ToolDispatchService, type ToolDispatchResult } from "./tool-dispatch.service";

export type TriageOrchestratorResult = ToolDispatchResult | {
  status: "tool_called";
  toolName: string;
  rawArgs: string | null;
};

export interface TriageRunParams {
  tenantId: string;
  sessionId: string;
  conversationId: string;
  collectedData: Record<string, unknown> | null | undefined;
  tenantContextPrompt: string;
  conversationHistory: AiChatMessageParam[];
  userMessage: string;
  originalUserMessage: string;
  channel?: CommunicationChannel;
  incomingMessageLength: number;
}

@Injectable()
export class TriageOrchestratorService {
  constructor(
    @Inject(AI_PROVIDER) private readonly aiProviderService: IAiProvider,
    private readonly loggingService: LoggingService,
    private readonly toolSelector: ToolSelectorService,
    private readonly promptOrchestration: AiPromptOrchestrationService,
    private readonly toolDispatch: ToolDispatchService,
    private readonly callLogService: CallLogService,
    private readonly errorHandler: AiErrorHandler,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  async run(params: TriageRunParams): Promise<TriageOrchestratorResult> {
    let openAIResponseId: string | undefined;
    try {
      const {
        tenantId,
        sessionId,
        conversationId,
        tenantContextPrompt,
        conversationHistory,
        userMessage,
        originalUserMessage,
        channel,
      } = params;

      const enabledTools = this.toolSelector.getEnabledToolsForTenant(tenantId);
      const routerFlowDecision = this.promptOrchestration.getTextRouterFlowDecision(
        tenantId,
        channel,
      );
      if (
        this.promptOrchestration.isTextChannel(channel) &&
        !routerFlowDecision.enabled
      ) {
        this.logAiTrace("log", tenantId, "ai.router_flow_disabled", {
          channel: channel ?? CommunicationChannel.WEBCHAT,
          reason: routerFlowDecision.reason,
        });
      }
      let routeIntent = this.promptOrchestration.getConversationRouteIntent(
        params.collectedData,
      );
      let routeContinuationCount = 0;
      let continuationNote: string | undefined;

      while (true) {
        const effectiveRouteIntent = routerFlowDecision.enabled ? routeIntent : null;
        const triageLane = this.promptOrchestration.selectTriageLane(
          channel,
          effectiveRouteIntent,
          { routerFlowEnabled: routerFlowDecision.enabled },
        );
        const systemPrompt = this.promptOrchestration.selectSystemPrompt(
          channel,
          effectiveRouteIntent,
          { routerFlowEnabled: routerFlowDecision.enabled },
        );
        if (!systemPrompt) {
          throw new InternalServerErrorException(
            "AI is not configured on the server.",
          );
        }

        const tools = this.promptOrchestration.filterToolsForLane(
          enabledTools,
          channel,
          effectiveRouteIntent,
          { routerFlowEnabled: routerFlowDecision.enabled },
        );
        const messages = this.promptOrchestration.buildTriageMessages({
          systemPrompt,
          tenantContextPrompt,
          conversationHistory,
          userMessage,
          continuationNote,
        });
        this.logAiTrace("log", tenantId, "ai.triage_lane_selected", {
          channel: channel ?? CommunicationChannel.WEBCHAT,
          lane: triageLane,
          routerFlowEnabled: routerFlowDecision.enabled,
          routerFlowReason: routerFlowDecision.reason,
          routeIntent: effectiveRouteIntent,
          routeContinuationCount,
          toolNames: tools
            .map((tool) =>
              tool.type === "function" ? tool.function?.name ?? null : null,
            )
            .filter((name): name is string => Boolean(name)),
        });

        const response = await this.aiProviderService.createCompletion({
          messages,
          tools: tools.length ? tools : undefined,
          maxTokens: this.config.aiMaxTokens,
          temperature:
            channel === CommunicationChannel.VOICE
              ? this.config.aiVoiceReplyTemperature
              : undefined,
          context: {
            channel: channel === CommunicationChannel.VOICE ? "VOICE" : "TEXT",
            lane: triageLane,
          },
        });
        openAIResponseId = response.id;
        const choice = response.choices[0];
        const { message } = choice;

        const responseModel = response.model;
        const validation = this.validateAssistantMessage(
          message,
          tenantId,
          responseModel,
        );

        if (validation.type === "tool") {
          const toolCall = validation.toolCall;
          if (this.isFunctionToolCall(toolCall) && toolCall.function?.name) {
            const toolResult = await this.toolDispatch.dispatch({
              tenantId,
              sessionId,
              conversationId,
              name: toolCall.function.name,
              rawArgs: toolCall.function.arguments ?? undefined,
              model: responseModel,
              channel,
              routeContinuationCount,
              currentRouteIntent: effectiveRouteIntent,
            });

            if (
              toolResult &&
              "status" in toolResult &&
              (toolResult as { status: string }).status === "continue" &&
              "intent" in toolResult &&
              this.promptOrchestration.isTextChannel(channel)
            ) {
              const intent = (toolResult as { intent: unknown }).intent;
              if (!isAiRouteIntent(intent)) {
                throw new BadRequestException("Invalid route tool result.");
              }
              this.logAiTrace("log", tenantId, "ai.route_changed", {
                channel: channel ?? CommunicationChannel.WEBCHAT,
                previousIntent: routeIntent,
                nextIntent: intent,
                routeContinuationCount,
              });
              routeIntent = intent;
              routeContinuationCount += 1;
              continuationNote =
                `Conversation route is already set to ${routeIntent}. ` +
                "Continue in this lane for the current user message. " +
                "Do not call route_conversation again unless the user changes intent in a future turn.";
              continue;
            }

            return toolResult;
          }

          return {
            status: "tool_called",
            toolName: toolCall.type,
            rawArgs: this.isFunctionToolCall(toolCall)
              ? toolCall.function?.arguments ?? null
              : null,
          };
        }

        const reply = {
          status: "reply" as const,
          reply: validation.reply,
        };
        const shouldPersistVoiceOutbound = channel !== CommunicationChannel.VOICE;

        await this.callLogService.createLog({
          tenantId,
          sessionId,
          conversationId,
          transcript: originalUserMessage,
          aiResponse: shouldPersistVoiceOutbound ? validation.reply : undefined,
          metadata: {
            sessionId,
            openAIResponseId,
          },
          channel,
        });

        return reply;
      }
    } catch (error) {
      this.errorHandler.handle(error, {
        tenantId: params.tenantId,
        metadata: {
          sessionId: params.sessionId,
        },
        stage: "triage",
        messageLength: params.incomingMessageLength,
        openAIResponseId,
      });
    }
  }

  private isFunctionToolCall(
    toolCall: AiToolCall,
  ): toolCall is AiToolCall & {
    function: { name: string; arguments?: string | null };
  } {
    return toolCall.type === "function" && typeof toolCall.function === "object";
  }

  private validateAssistantMessage(
    message: AiAssistantMessage,
    tenantId: string,
    model?: string,
  ) {
    if (typeof message.refusal === "string" && message.refusal.trim()) {
      this.logAiEvent(tenantId, "ai.refusal", {
        model,
        reason: message.refusal.trim(),
      });
      throw new BadRequestException("AI refused the request.");
    }

    if (message.tool_calls?.length) {
      if (message.tool_calls.length > this.config.aiMaxToolCalls) {
        this.logAiEvent(tenantId, "ai.invalid_output", {
          model,
          reason: "too_many_tool_calls",
        });
        this.loggingService.warn(
          {
            event: "ai_budget_triggered",
            budget: "AI_MAX_TOOL_CALLS",
            limit: this.config.aiMaxToolCalls,
          },
          TriageOrchestratorService.name,
        );
        throw new BadRequestException("Too many tool calls.");
      }
      const toolCall = message.tool_calls[0];
      if (!this.isFunctionToolCall(toolCall) || !toolCall.function?.name) {
        this.logAiEvent(tenantId, "ai.invalid_output", {
          model,
          reason: "invalid_tool_call",
        });
        throw new BadRequestException("Invalid tool call response.");
      }
      const rawArgs = toolCall.function.arguments ?? "";
      if (!rawArgs.trim()) {
        this.logAiEvent(tenantId, "ai.invalid_output", {
          model,
          reason: "missing_tool_args",
        });
        throw new BadRequestException("Tool call arguments missing.");
      }
      return { type: "tool" as const, toolCall };
    }

    const replyPayload = Array.isArray(message.content)
      ? message.content
          .map((part) =>
            typeof part === "string"
              ? part
              : ((part as { text?: string })?.text ?? ""),
          )
          .join(" ")
      : (message.content ?? "");

    const trimmed = replyPayload.trim();
    if (!trimmed) {
      this.logAiEvent(tenantId, "ai.invalid_output", {
        model,
        reason: "empty_reply",
      });
      throw new BadRequestException("AI response was empty.");
    }

    return { type: "reply" as const, reply: trimmed };
  }

  private logAiEvent(
    tenantId: string,
    event: "ai.refusal" | "ai.invalid_output",
    details: { model?: string; reason: string; promptVersion?: string },
  ) {
    const context = getRequestContext();
    const payload: Record<string, unknown> = {
      event,
      tenantId,
      requestId: context?.requestId,
      model: details.model,
      reason: details.reason,
    };

    if (context?.callSid) {
      payload.callSid = context.callSid;
    }

    if (context?.conversationId) {
      payload.conversationId = context.conversationId;
    }

    if (details.promptVersion) {
      payload.promptVersion = details.promptVersion;
    }

    this.loggingService.warn(payload, TriageOrchestratorService.name);
  }

  private logAiTrace(
    level: "log" | "warn",
    tenantId: string,
    event: string,
    details: Record<string, unknown>,
  ) {
    const context = getRequestContext();
    const payload: Record<string, unknown> = {
      event,
      tenantId,
      requestId: context?.requestId,
      ...details,
    };

    if (context?.callSid) {
      payload.callSid = context.callSid;
    }

    if (context?.conversationId) {
      payload.conversationId = context.conversationId;
    }

    if (level === "warn") {
      this.loggingService.warn(payload, TriageOrchestratorService.name);
      return;
    }

    this.loggingService.log(payload, TriageOrchestratorService.name);
  }
}
