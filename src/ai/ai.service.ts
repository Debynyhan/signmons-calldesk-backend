import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { AI_PROVIDER } from "./ai.constants";
import type { IAiProvider } from "./interfaces/ai-provider.interface";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { AiErrorHandler } from "./ai-error.handler";
import { LoggingService } from "../logging/logging.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { ToolSelectorService } from "./tools/tool-selector.service";
import { CallLogService } from "../logging/call-log.service";
import { ConversationsService } from "../conversations/conversations.service";
import appConfig from "../config/app.config";
import { getRequestContext } from "../common/context/request-context";
import { CommunicationChannel } from "@prisma/client";
import { AiPromptOrchestrationService } from "./prompts/prompt-orchestration.service";
import {
  isAiRouteIntent,
  type AiRouteIntent,
} from "./routing/ai-route-state";
import { ToolExecutorRegistryService } from "./tools/tool-executor.registry";
import type {
  AiAssistantMessage,
  AiChatMessageParam,
  AiToolCall,
} from "./types/ai-completion.types";

@Injectable()
export class AiService {
  constructor(
    @Inject(AI_PROVIDER) private readonly aiProviderService: IAiProvider,
    private readonly errorHandler: AiErrorHandler,
    private readonly loggingService: LoggingService,
    private readonly sanitizationService: SanitizationService,
    private readonly toolSelector: ToolSelectorService,
    private readonly promptOrchestration: AiPromptOrchestrationService,
    private readonly toolExecutorRegistry: ToolExecutorRegistryService,
    @Inject(TENANTS_SERVICE) private readonly tenantsService: TenantsService,
    private readonly callLogService: CallLogService,
    private readonly conversationsService: ConversationsService,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  async triage(
    tenantId: string,
    sessionId: string,
    userMessage: string,
    options?: { conversationId?: string; channel?: CommunicationChannel },
  ) {
    let safeTenantId: string | undefined;
    let safeSessionId: string | undefined;
    let openAIResponseId: string | undefined;
    const incomingMessageLength = userMessage?.length ?? 0;
    try {
      safeTenantId = this.sanitizationService.sanitizeIdentifier(tenantId);
      const safeUserMessage =
        this.sanitizationService.sanitizeText(userMessage);
      safeSessionId = this.sanitizationService.sanitizeIdentifier(sessionId);

      if (!safeTenantId) {
        throw new BadRequestException("Invalid tenant identifier.");
      }

      if (!safeSessionId) {
        throw new BadRequestException("Invalid session identifier.");
      }

      if (!safeUserMessage) {
        throw new BadRequestException("Message must contain text.");
      }

      const tenantContext =
        await this.tenantsService.getTenantContext(safeTenantId);
      const conversation = options?.conversationId
        ? await this.conversationsService.getConversationById({
            tenantId: safeTenantId,
            conversationId: options.conversationId,
          })
        : await this.conversationsService.ensureConversation(
            safeTenantId,
            safeSessionId,
          );

      if (!conversation) {
        throw new BadRequestException("Conversation not found.");
      }
      const tenantContextPrompt = tenantContext.prompt;
      const recentMessages = await this.callLogService.getRecentMessages(
        safeTenantId,
        safeSessionId,
        10,
      );
      const conversationHistory: AiChatMessageParam[] =
        recentMessages.map((entry) => ({
          role: entry.role,
          content: entry.content,
        }));
      const enabledTools = this.toolSelector.getEnabledToolsForTenant(safeTenantId);
      const routerFlowDecision = this.promptOrchestration.getTextRouterFlowDecision(
        safeTenantId,
        options?.channel,
      );
      if (
        this.promptOrchestration.isTextChannel(options?.channel) &&
        !routerFlowDecision.enabled
      ) {
        this.logAiTrace("log", safeTenantId, "ai.router_flow_disabled", {
          channel: options?.channel ?? CommunicationChannel.WEBCHAT,
          reason: routerFlowDecision.reason,
        });
      }
      let routeIntent = this.promptOrchestration.getConversationRouteIntent(
        conversation.collectedData,
      );
      let routeContinuationCount = 0;
      let continuationNote: string | undefined;

      while (true) {
        const effectiveRouteIntent = routerFlowDecision.enabled ? routeIntent : null;
        const triageLane = this.promptOrchestration.selectTriageLane(
          options?.channel,
          effectiveRouteIntent,
          { routerFlowEnabled: routerFlowDecision.enabled },
        );
        const systemPrompt = this.promptOrchestration.selectSystemPrompt(
          options?.channel,
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
          options?.channel,
          effectiveRouteIntent,
          { routerFlowEnabled: routerFlowDecision.enabled },
        );
        const messages = this.promptOrchestration.buildTriageMessages({
          systemPrompt,
          tenantContextPrompt,
          conversationHistory,
          userMessage: safeUserMessage,
          continuationNote,
        });
        this.logAiTrace("log", safeTenantId, "ai.triage_lane_selected", {
          channel: options?.channel ?? CommunicationChannel.WEBCHAT,
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
            options?.channel === CommunicationChannel.VOICE
              ? this.config.aiVoiceReplyTemperature
              : undefined,
          context: {
            channel:
              options?.channel === CommunicationChannel.VOICE ? "VOICE" : "TEXT",
            lane: triageLane,
          },
        });
        openAIResponseId = response.id;
        const choice = response.choices[0];
        const { message } = choice;

        const responseModel = response.model;
        const validation = this.validateAssistantMessage(
          message,
          safeTenantId,
          responseModel,
        );

        if (validation.type === "tool") {
          const toolCall = validation.toolCall;
          if (this.isFunctionToolCall(toolCall) && toolCall.function?.name) {
            const toolResult = await this.handleToolCall(
              safeTenantId,
              safeSessionId,
              conversation.id,
              toolCall.function.name,
              toolCall.function.arguments ?? undefined,
              responseModel,
              options?.channel,
              routeContinuationCount,
              effectiveRouteIntent,
            );

            if (
              toolResult &&
              "status" in toolResult &&
              toolResult.status === "continue" &&
              "intent" in toolResult &&
              this.promptOrchestration.isTextChannel(options?.channel)
            ) {
              if (!isAiRouteIntent(toolResult.intent)) {
                throw new BadRequestException("Invalid route tool result.");
              }
              this.logAiTrace("log", safeTenantId, "ai.route_changed", {
                channel: options?.channel ?? CommunicationChannel.WEBCHAT,
                previousIntent: routeIntent,
                nextIntent: toolResult.intent,
                routeContinuationCount,
              });
              routeIntent = toolResult.intent;
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
        const shouldPersistVoiceOutbound =
          options?.channel !== CommunicationChannel.VOICE;

        await this.callLogService.createLog({
          tenantId: safeTenantId,
          sessionId: safeSessionId,
          conversationId: conversation.id,
          transcript: userMessage,
          aiResponse: shouldPersistVoiceOutbound ? validation.reply : undefined,
          metadata: {
            sessionId: safeSessionId,
            openAIResponseId,
          },
          channel: options?.channel,
        });

        return reply;
      }
    } catch (error) {
      this.errorHandler.handle(error, {
        tenantId: safeTenantId ?? tenantId,
        metadata: {
          sessionId: safeSessionId ?? sessionId,
        },
        stage: "triage",
        messageLength: incomingMessageLength,
        openAIResponseId,
      });
    }
  }

  async extractNameCandidate(
    tenantId: string,
    transcript: string,
  ): Promise<string | null> {
    const safeTenantId = this.sanitizationService.sanitizeIdentifier(tenantId);
    const safeTranscript = this.sanitizationService.sanitizeText(transcript);
    if (!safeTenantId || !safeTranscript) {
      return null;
    }

    const messages: AiChatMessageParam[] = [
      {
        role: "system",
        content:
          "Extract the caller's name from the transcript. Return JSON only: {\"name\": string|null}. If no name is present, return {\"name\": null}.",
      },
      { role: "user", content: safeTranscript },
    ];

    try {
      const response = await this.aiProviderService.createCompletion({
        messages,
        toolChoice: "none",
        maxTokens: Math.min(this.config.aiMaxTokens ?? 800, 60),
        temperature: this.config.aiExtractionTemperature,
        context: {
          channel: "TEXT",
          lane: "EXTRACTION_NAME",
        },
      });
      const rawContent = response.choices[0]?.message?.content ?? "";
      const content = Array.isArray(rawContent)
        ? rawContent
            .map((part) =>
              typeof part === "string" ? part : (part.text ?? ""),
            )
            .join(" ")
        : rawContent;
      const parsed = this.parseNameJson(content);
      if (!parsed) {
        return null;
      }
      const normalized = this.sanitizationService.sanitizeText(parsed);
      return normalized ? normalized : null;
    } catch (error) {
      this.loggingService.warn(
        {
          event: "ai.name_extraction_failed",
          tenantId: safeTenantId,
        },
        AiService.name,
      );
      return null;
    }
  }

  async extractAddressCandidate(
    tenantId: string,
    transcript: string,
  ): Promise<{
    address: string | null;
    confidence?: number;
    houseNumber?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null> {
    const safeTenantId = this.sanitizationService.sanitizeIdentifier(tenantId);
    const safeTranscript = this.sanitizationService.sanitizeText(transcript);
    if (!safeTenantId || !safeTranscript) {
      return null;
    }

    const messages: AiChatMessageParam[] = [
      {
        role: "system",
        content:
          "Extract the service address from the transcript. Return JSON only: {\"address\": string|null, \"houseNumber\": string|null, \"street\": string|null, \"city\": string|null, \"state\": string|null, \"zip\": string|null, \"confidence\": number|null}. Confidence must be 0-1. If no address is present, return all fields null.",
      },
      { role: "user", content: safeTranscript },
    ];

    try {
      const response = await this.aiProviderService.createCompletion({
        messages,
        toolChoice: "none",
        maxTokens: Math.min(this.config.aiMaxTokens ?? 800, 80),
        temperature: this.config.aiExtractionTemperature,
        context: {
          channel: "TEXT",
          lane: "EXTRACTION_ADDRESS",
        },
      });
      const rawContent = response.choices[0]?.message?.content ?? "";
      const content = Array.isArray(rawContent)
        ? rawContent
            .map((part) =>
              typeof part === "string" ? part : (part.text ?? ""),
            )
            .join(" ")
        : rawContent;
      const parsed = this.parseAddressJson(content);
      if (!parsed) {
        this.loggingService.warn(
          {
            event: "ai.address_extraction_failed",
            tenantId: safeTenantId,
            reason: "invalid_json",
          },
          AiService.name,
        );
        return null;
      }
      const address = parsed.address
        ? this.sanitizationService.sanitizeText(parsed.address)
        : null;
      const houseNumber = parsed.houseNumber
        ? this.sanitizationService.sanitizeText(parsed.houseNumber)
        : null;
      const street = parsed.street
        ? this.sanitizationService.sanitizeText(parsed.street)
        : null;
      const city = parsed.city
        ? this.sanitizationService.sanitizeText(parsed.city)
        : null;
      const state = parsed.state
        ? this.sanitizationService.sanitizeText(parsed.state)
        : null;
      const zip = parsed.zip
        ? this.sanitizationService.sanitizeText(parsed.zip)
        : null;
      const confidence = this.normalizeConfidence(parsed.confidence);
      return {
        address: address || null,
        ...(typeof confidence === "number" ? { confidence } : {}),
        ...(houseNumber ? { houseNumber } : {}),
        ...(street ? { street } : {}),
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
        ...(zip ? { zip } : {}),
      };
    } catch (error) {
      this.loggingService.warn(
        {
          event: "ai.address_extraction_failed",
          tenantId: safeTenantId,
        },
        AiService.name,
      );
      return null;
    }
  }

  private isFunctionToolCall(
    toolCall: AiToolCall,
  ): toolCall is AiToolCall & {
    function: { name: string; arguments?: string | null };
  } {
    return toolCall.type === "function" && typeof toolCall.function === "object";
  }

  private parseNameJson(value: string): string | null {
    if (!value) {
      return null;
    }
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    const slice = value.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice) as { name?: unknown };
      return typeof parsed.name === "string" ? parsed.name : null;
    } catch {
      return null;
    }
  }

  private parseAddressJson(value: string): {
    address: string | null;
    confidence?: number | null;
    houseNumber?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null {
    if (!value) {
      return null;
    }
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    const slice = value.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice) as {
        address?: unknown;
        confidence?: unknown;
        houseNumber?: unknown;
        street?: unknown;
        city?: unknown;
        state?: unknown;
        zip?: unknown;
      };
      const address =
        typeof parsed.address === "string" ? parsed.address : null;
      const houseNumber =
        typeof parsed.houseNumber === "string" ? parsed.houseNumber : null;
      const street =
        typeof parsed.street === "string" ? parsed.street : null;
      const city = typeof parsed.city === "string" ? parsed.city : null;
      const state = typeof parsed.state === "string" ? parsed.state : null;
      const zip = typeof parsed.zip === "string" ? parsed.zip : null;
      const confidence =
        typeof parsed.confidence === "number" ||
        typeof parsed.confidence === "string"
          ? Number(parsed.confidence)
          : null;
      return { address, confidence, houseNumber, street, city, state, zip };
    } catch {
      return null;
    }
  }

  private normalizeConfidence(
    value: number | null | undefined,
  ): number | undefined {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return undefined;
    }
    if (value >= 0 && value <= 1) {
      return value;
    }
    if (value > 1 && value <= 100) {
      return value / 100;
    }
    return undefined;
  }

  private async handleToolCall(
    tenantId: string,
    sessionId: string,
    conversationId: string,
    name: string,
    rawArgs?: string,
    model?: string,
    channel?: CommunicationChannel,
    routeContinuationCount?: number,
    currentRouteIntent?: AiRouteIntent | null,
  ) {
    try {
      this.logAiTrace("log", tenantId, "ai.tool_dispatch", {
        toolName: name,
        channel,
        model,
        routeContinuationCount,
        currentRouteIntent,
      });
      const executor = this.toolExecutorRegistry.get(name);
      if (!executor) {
        this.logAiTrace("warn", tenantId, "ai.unsupported_tool_called", {
          toolName: name,
          channel,
          model,
        });
        return {
          status: "unsupported_tool",
          toolName: name,
          rawArgs,
        };
      }
      const result = await executor.execute({
        tenantId,
        sessionId,
        conversationId,
        rawArgs,
        model,
        channel,
        routeContinuationCount,
        currentRouteIntent,
      });
      this.logAiTrace("log", tenantId, "ai.tool_result", {
        toolName: name,
        channel,
        model,
        status: result.status,
      });
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "";
      if (
        name === "route_conversation" &&
        error instanceof BadRequestException &&
        message.includes("Repeated route tool call")
      ) {
        this.logAiTrace("warn", tenantId, "ai.route_loop_guard_triggered", {
          channel,
          model,
          routeContinuationCount,
          currentRouteIntent,
        });
      }
      this.logAiTrace("warn", tenantId, "ai.tool_error", {
        toolName: name,
        channel,
        model,
        errorType: error instanceof Error ? error.name : typeof error,
      });
      if (error instanceof BadRequestException) {
        this.logAiEvent(tenantId, "ai.invalid_output", {
          model,
          reason: "tool_args_invalid",
        });
      }
      this.errorHandler.handle(error, {
        tenantId,
        toolName: name,
        stage: "tool_call",
        metadata: {
          rawArgsLength: rawArgs?.length ?? 0,
        },
      });
    }
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
          AiService.name,
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

    this.loggingService.warn(payload, AiService.name);
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
      this.loggingService.warn(payload, AiService.name);
      return;
    }

    this.loggingService.log(payload, AiService.name);
  }
}
