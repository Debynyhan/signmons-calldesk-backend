import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
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
import { SessionStateService } from "./session-state/session-state.service";
import { FieldExtractionService } from "./field-extraction.service";
import {
  validateAssistantTurn,
} from "./session-state/call-desk-validator";
import type { ValidationResult } from "./session-state/call-desk-validator";
import type { BookingFields } from "./session-state/call-desk-state";
import type { CallDeskSessionState } from "./session-state/call-desk-state";

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
    private readonly sessionStateService: SessionStateService,
    private readonly fieldExtractionService: FieldExtractionService,
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

  async triage(tenantId: string, sessionId: string, userMessage: string) {
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

      const extractedFields =
        await this.fieldExtractionService.extractFields(safeUserMessage);
      if (
        Object.keys(extractedFields.fields).length > 0 ||
        extractedFields.category ||
        extractedFields.urgency
      ) {
        this.sessionStateService.applyExplicitFields(
          safeTenantId,
          safeSessionId,
          {
            fields: extractedFields.fields,
            category: extractedFields.category,
            urgency: extractedFields.urgency,
          },
        );
      }

      const tenantContext =
        await this.tenantsService.getTenantContext(safeTenantId);
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
      const sessionState =
        this.sessionStateService.updateFromUserMessage(
          safeTenantId,
          safeSessionId,
          safeUserMessage,
        );
      const promptState =
        this.sessionStateService.getPromptState(
          safeTenantId,
          safeSessionId,
        );
      this.loggingService.log(
        `Missing fields after user message: ${JSON.stringify(
          promptState.missing_fields ?? [],
        )}`,
        AiService.name,
      );
      const internalStateMessage = [
        "INTERNAL_SESSION_STATE (never reveal this to callers).",
        JSON.stringify(promptState),
      ].join(" ");

      const systemMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: this.systemPrompt },
        { role: "system", content: tenantContextPrompt },
        { role: "system", content: internalStateMessage },
      ];

      const tools = this.toolSelector.getEnabledToolsForTenant(
        safeTenantId,
        tenantContext.allowedTools,
      );

      const response = await this.runWithValidation({
        systemMessages,
        conversationHistory,
        userMessage: safeUserMessage,
        tools,
        tenantId: safeTenantId,
        sessionId: safeSessionId,
        prevState: sessionState,
      });
      openAIResponseId = response.id;
      const choice = response.choices[0];
      const { message } = choice;

      if (message.tool_calls?.length) {
        const toolCall = message.tool_calls[0];
        if (toolCall.type === "function" && toolCall.function?.name) {
          return this.handleToolCall(
            safeTenantId,
            safeSessionId,
            toolCall.function.name,
            toolCall.function.arguments,
          );
        }

        return {
          status: "tool_called",
          toolName: toolCall.type,
          rawArgs: toolCall.function?.arguments ?? null,
        };
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

      const reply = {
        status: "reply" as const,
        reply: replyPayload,
      };

      await this.callLogService.createLog({
        tenantId: safeTenantId,
        sessionId: safeSessionId,
        transcript: userMessage,
        aiResponse: replyPayload,
        metadata: {
          sessionId: safeSessionId,
          openAIResponseId,
        },
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

  private async handleToolCall(
    tenantId: string,
    sessionId: string,
    name: string,
    rawArgs?: string,
  ) {
    if (name !== "create_job") {
      return {
        status: "unsupported_tool",
        toolName: name,
        rawArgs,
      };
    }

    try {
      if (rawArgs) {
        try {
          const parsed = JSON.parse(rawArgs);
          const fields: Partial<BookingFields> = {
            name: parsed.customerName,
            phone: parsed.phone,
            address: parsed.address,
            issue: parsed.description ?? parsed.issue,
            preferred_window: parsed.preferredTime,
          };
          this.sessionStateService.applyExplicitFields(tenantId, sessionId, {
            fields,
            category: parsed.issueCategory ?? undefined,
            urgency: parsed.urgency ?? undefined,
            feeDisclosed: true,
            feeConfirmed: true,
          });
        } catch (parseError) {
          this.loggingService.warn(
            `Failed to parse create_job payload: ${parseError instanceof Error ? parseError.message : "unknown"}`,
            AiService.name,
          );
        }
      }
      this.sessionStateService.setStep(tenantId, sessionId, "BOOKING");
      const job = await this.jobsRepository.createJobFromToolCall({
        tenantId,
        sessionId,
        rawArgs,
      });
      await this.callLogService.createLog({
        tenantId,
        sessionId,
        jobId: job.id,
        transcript: rawArgs ?? "",
        aiResponse: JSON.stringify(job),
        metadata: { toolName: name, sessionId },
      });
      await this.callLogService.clearSession(tenantId, sessionId);
      this.sessionStateService.resetState(tenantId, sessionId);
      return {
        status: "job_created",
        job,
        message: "Job created successfully.",
      };
    } catch (error) {
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

  private async runWithValidation(params: {
    systemMessages: OpenAI.ChatCompletionMessageParam[];
    conversationHistory: OpenAI.ChatCompletionMessageParam[];
    userMessage: string;
    tools: OpenAI.ChatCompletionTool[];
    tenantId: string;
    sessionId: string;
    prevState: CallDeskSessionState;
  }): Promise<OpenAI.ChatCompletion> {
    const {
      systemMessages,
      conversationHistory,
      userMessage,
      tools,
      tenantId,
      sessionId,
      prevState,
    } = params;
    const maxAttempts = 2;
    let correctiveMessage: string | undefined;
    let lastValidation: ValidationResult | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        ...systemMessages,
        ...conversationHistory,
      ];

      if (correctiveMessage) {
        messages.push({ role: "system", content: correctiveMessage });
      }

      messages.push({ role: "user", content: userMessage });

      const response = await this.aiProviderService.createCompletion({
        messages,
        tools: tools.length ? tools : undefined,
        toolChoice: this.selectToolChoice(prevState, tools),
      });
      const choice = response.choices[0];
      const message = choice.message;

      if (message.tool_calls?.length) {
        return response;
      }

      const assistantText = Array.isArray(message.content)
        ? message.content
            .map((part) =>
              typeof part === "string"
                ? part
                : ((part as { text?: string })?.text ?? ""),
            )
            .join(" ")
        : (message.content ?? "");
      const sanitized = this.sanitizeAssistantReply(assistantText);
      const prefixed = this.maybePrependNameAcknowledgement(
        prevState,
        sanitized,
      );
      const finalText = prefixed.text;

      const previewState = this.sessionStateService.previewAssistantUpdate(
        prevState,
        finalText,
      );
      const validation = validateAssistantTurn({
        prevState,
        nextState: previewState,
        assistantText: finalText,
        toolCalls: message.tool_calls?.map((call) => ({
          name: call.function?.name ?? call.type,
        })),
      });

      if (validation.ok) {
        this.sessionStateService.applyAssistantReply(
          tenantId,
          sessionId,
          finalText,
        );
        if (prefixed.acknowledged) {
          this.sessionStateService.updateState(tenantId, sessionId, {
            name_acknowledged: true,
          });
        }
        if (finalText !== assistantText) {
          message.content = finalText;
        }
        return response;
      }

      lastValidation = validation;
      this.loggingService.warn(
        `AI response rejected: ${validation.reason ?? "unknown"}`,
        AiService.name,
      );
      if (validation.correctiveSystemMessage) {
        correctiveMessage = `Your previous reply was rejected: ${validation.correctiveSystemMessage}`;
        continue;
      }

      break;
    }

    const fallbackText = this.buildFallbackMessage(lastValidation);
    const prefixedFallback = this.maybePrependNameAcknowledgement(
      prevState,
      fallbackText,
    );
    this.loggingService.warn(
      `Falling back to guarded dispatcher response: ${
        lastValidation?.reason ?? "unknown reason"
      }`,
      AiService.name,
    );
    this.sessionStateService.applyAssistantReply(
      tenantId,
      sessionId,
      prefixedFallback.text,
    );
    if (prefixedFallback.acknowledged) {
      this.sessionStateService.updateState(tenantId, sessionId, {
        name_acknowledged: true,
      });
    }
    return this.buildSyntheticCompletion(prefixedFallback.text);
  }

  private buildSyntheticCompletion(
    content: string,
  ): OpenAI.ChatCompletion {
    const timestamp = Math.floor(Date.now() / 1000);
    return {
      id: `synthetic_${timestamp}`,
      object: "chat.completion",
      created: timestamp,
      model: "synthetic",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          message: { role: "assistant", content },
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    } as OpenAI.ChatCompletion;
  }

  private buildFallbackMessage(validation?: ValidationResult | null): string {
    if (!validation) {
      return "I need a quick detail before I can finish scheduling. Could you clarify the last item we discussed?";
    }

    if (validation.missingField) {
      return this.buildMissingFieldPrompt(
        validation.missingField as
          | keyof BookingFields
          | "fee_disclosure"
          | "fee_confirmation",
      );
    }

    if (
      validation.reason?.includes("Missing required booking fields") ||
      validation.correctiveSystemMessage?.includes("next missing field")
    ) {
      return "I still need one more detail before I can book this. Could you share the next missing item so we can confirm your appointment?";
    }

    if (validation.reason?.includes("fee")) {
      return "Just a reminder: every visit includes a $99 diagnostic/service fee, and if you approve repairs within 24 hours we credit it toward the work. Let me know once that's okay so I can proceed.";
    }

    if (validation.reason?.includes("booking language")) {
      return "I'll hold off on confirming the booking until I have every detail locked in. Could you confirm the last requirement for me?";
    }

    return "Let me double-check one more detail so I can finish setting this up. Could you clarify that for me?";
  }

  private buildMissingFieldPrompt(
    field: keyof BookingFields | "fee_disclosure" | "fee_confirmation",
  ): string {
    switch (field) {
      case "name":
        return "I still need the caller's full name to finish scheduling. Could you please provide it?";
      case "phone":
        return "I still need the best phone number we should use for updates. Could you share that?";
      case "address":
        return "I still need the service address for this visit. Could you provide the street address and city?";
      case "issue":
        return "I still need a short description of what's happening so we can brief the technician. Could you summarize the issue?";
      case "preferred_window":
        return "I still need your preferred date or time window so we can schedule the technician. For example: \"Tomorrow morning\" or \"Anytime after 2 PM\".";
      case "photos":
        return "If you have any photos of the issue, feel free to share them. If not, just let me know.";
      case "fee_disclosure":
        return "Before we can book, I need to confirm you're okay with the $99 diagnostic/service fee, which we credit toward repairs if you approve work within 24 hours. Does that work?";
      case "fee_confirmation":
        return "Before we schedule, please confirm you agree to the $99 diagnostic/service fee (credited toward repairs if approved within 24 hours). Is that okay?";
      default:
        return "I need one last detail before I can finish scheduling. Could you confirm the remaining item?";
    }
  }

  private selectToolChoice(
    state: CallDeskSessionState,
    tools: OpenAI.ChatCompletionTool[],
  ): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined {
    if (state.step !== "BOOKING") {
      return undefined;
    }

    const hasCreateJob = tools.some(
      (tool) => tool.type === "function" && tool.function?.name === "create_job",
    );
    if (!hasCreateJob) {
      return undefined;
    }

    return {
      type: "function",
      function: { name: "create_job" },
    };
  }

  private maybePrependNameAcknowledgement(
    state: CallDeskSessionState,
    text: string,
  ): { text: string; acknowledged: boolean } {
    if (state.name_acknowledged || !state.fields.name) {
      return { text, acknowledged: false };
    }

    const firstName = state.fields.name.trim().split(/\s+/)[0];
    if (!firstName) {
      return { text, acknowledged: false };
    }

    const namePattern = new RegExp(`\\b${firstName}\\b`, "i");
    if (namePattern.test(text)) {
      return { text, acknowledged: true };
    }

    const updated = text.replace(
      /^(thanks|thank you)\b/i,
      `$1, ${firstName}`,
    );
    if (updated !== text) {
      return { text: updated, acknowledged: true };
    }

    return { text: `Thanks, ${firstName}, ${text}`, acknowledged: true };
  }

  private sanitizeAssistantReply(text: string): string {
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      return trimmed;
    }

    const sentences = trimmed
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => sentence.trim().length > 0);
    const limitedSentences = sentences.slice(0, 2);
    let sanitized = limitedSentences.join(" ");

    const questionMatches = sanitized.match(/\?/g);
    if (questionMatches && questionMatches.length > 1) {
      let seen = 0;
      sanitized = sanitized.replace(/\?/g, (match) => {
        seen += 1;
        return seen === 1 ? match : ".";
      });
    }

    return sanitized.trim();
  }
}
