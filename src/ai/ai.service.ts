import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";
import { AI_PROVIDER } from "./ai.constants";
import type { IAiProvider } from "./interfaces/ai-provider.interface";
import { JOB_REPOSITORY } from "../jobs/jobs.constants";
import type { IJobRepository } from "../jobs/interfaces/job-repository.interface";
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

@Injectable()
export class AiService {
  private readonly systemPrompt: string | null;

  constructor(
    @Inject(AI_PROVIDER) private readonly aiProviderService: IAiProvider,
    private readonly errorHandler: AiErrorHandler,
    private readonly loggingService: LoggingService,
    private readonly sanitizationService: SanitizationService,
    private readonly toolSelector: ToolSelectorService,
    @Inject(JOB_REPOSITORY) private readonly jobsRepository: IJobRepository,
    @Inject(TENANTS_SERVICE) private readonly tenantsService: TenantsService,
    private readonly callLogService: CallLogService,
    private readonly conversationsService: ConversationsService,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {
    try {
      const promptPath = join(
        process.cwd(),
        "src",
        "ai",
        "prompts",
        "calldeskSystemPrompt.txt",
      );
      this.systemPrompt = readFileSync(promptPath, "utf8");
    } catch (error) {
      this.loggingService.error(
        "Failed to load system prompt.",
        error instanceof Error ? error : undefined,
        AiService.name,
      );
      this.systemPrompt = null;
    }
  }

  async triage(
    tenantId: string,
    sessionId: string,
    userMessage: string,
    options?: { conversationId?: string; channel?: CommunicationChannel },
  ) {
    if (!this.systemPrompt) {
      throw new InternalServerErrorException(
        "AI is not configured on the server.",
      );
    }

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
      const conversationHistory: OpenAI.ChatCompletionMessageParam[] =
        recentMessages.map((entry) => ({
          role: entry.role,
          content: entry.content,
        }));
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: this.systemPrompt },
        { role: "system", content: tenantContextPrompt },
        ...conversationHistory,
        { role: "user", content: safeUserMessage },
      ];

      const tools = this.toolSelector.getEnabledToolsForTenant(safeTenantId);
      const response = await this.aiProviderService.createCompletion({
        messages,
        tools: tools.length ? tools : undefined,
        maxTokens: this.config.aiMaxTokens,
        temperature:
          options?.channel === CommunicationChannel.VOICE
            ? this.config.aiVoiceReplyTemperature
            : undefined,
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
          return this.handleToolCall(
            safeTenantId,
            safeSessionId,
            conversation.id,
            toolCall.function.name,
            toolCall.function.arguments ?? undefined,
            responseModel,
            options?.channel,
          );
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

      await this.callLogService.createLog({
        tenantId: safeTenantId,
        sessionId: safeSessionId,
        conversationId: conversation.id,
        transcript: userMessage,
        aiResponse: validation.reply,
        metadata: {
          sessionId: safeSessionId,
          openAIResponseId,
        },
        channel: options?.channel,
      });

      return reply;
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

    const messages: OpenAI.ChatCompletionMessageParam[] = [
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
      });
      const content = response.choices[0]?.message?.content ?? "";
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
  ): Promise<{ address: string | null; confidence?: number } | null> {
    const safeTenantId = this.sanitizationService.sanitizeIdentifier(tenantId);
    const safeTranscript = this.sanitizationService.sanitizeText(transcript);
    if (!safeTenantId || !safeTranscript) {
      return null;
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "Extract the service address from the transcript. Return JSON only: {\"address\": string|null, \"confidence\": number|null}. Confidence must be 0-1. If no address is present, return {\"address\": null, \"confidence\": null}.",
      },
      { role: "user", content: safeTranscript },
    ];

    try {
      const response = await this.aiProviderService.createCompletion({
        messages,
        toolChoice: "none",
        maxTokens: Math.min(this.config.aiMaxTokens ?? 800, 80),
        temperature: this.config.aiExtractionTemperature,
      });
      const content = response.choices[0]?.message?.content ?? "";
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
      const confidence = this.normalizeConfidence(parsed.confidence);
      return {
        address: address || null,
        ...(typeof confidence === "number" ? { confidence } : {}),
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
    toolCall: OpenAI.ChatCompletionMessageToolCall,
  ): toolCall is OpenAI.ChatCompletionMessageToolCall & {
    function: { name: string; arguments?: string | null };
  } {
    return toolCall.type === "function" && "function" in toolCall;
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
      };
      const address =
        typeof parsed.address === "string" ? parsed.address : null;
      const confidence =
        typeof parsed.confidence === "number" ||
        typeof parsed.confidence === "string"
          ? Number(parsed.confidence)
          : null;
      return { address, confidence };
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
  ) {
    if (name !== "create_job") {
      return {
        status: "unsupported_tool",
        toolName: name,
        rawArgs,
      };
    }

    if (channel === CommunicationChannel.VOICE) {
      const reply =
        "Thanks — I’ll text you to confirm details and secure the appointment.";
      const context = getRequestContext();
      this.loggingService.warn(
        {
          event: "voice.tool_blocked",
          tenantId,
          callSid: context?.callSid,
          conversationId,
          toolName: name,
        },
        AiService.name,
      );
      await this.callLogService.createLog({
        tenantId,
        sessionId,
        conversationId,
        transcript: rawArgs ?? "",
        aiResponse: reply,
        metadata: { toolName: name, blocked: "voice_sms_canonical" },
        channel,
      });
      return { status: "reply", reply };
    }

    try {
      const job = await this.jobsRepository.createJobFromToolCall({
        tenantId,
        sessionId,
        rawArgs,
      });
      await this.conversationsService.linkJobToConversation({
        tenantId,
        conversationId,
        jobId: job.id,
      });
      await this.callLogService.createLog({
        tenantId,
        sessionId,
        jobId: job.id,
        conversationId,
        transcript: rawArgs ?? "",
        aiResponse: JSON.stringify(job),
        metadata: { toolName: name, sessionId },
        channel,
      });
      await this.callLogService.clearSession(
        tenantId,
        sessionId,
        conversationId,
      );
      return {
        status: "job_created",
        job,
        message: "Job created successfully.",
      };
    } catch (error) {
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
    message: OpenAI.ChatCompletionMessage,
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
}
