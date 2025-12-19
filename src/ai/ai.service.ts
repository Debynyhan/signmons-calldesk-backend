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
import {
  missingInfoFields,
  type BookingFields,
} from "./session-state/call-desk-state";

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

      const tenantContext =
        await this.tenantsService.getTenantContext(safeTenantId);
      const tenantContextPrompt = tenantContext.prompt;
      const sessionState = this.sessionStateService.updateFromUserMessage(
        safeTenantId,
        safeSessionId,
        safeUserMessage,
      );
      const internalStateMessage: OpenAI.ChatCompletionMessageParam = {
        role: "system",
        content: `INTERNAL_SESSION_STATE: ${JSON.stringify(
          this.sessionStateService.getPromptState(
            safeTenantId,
            safeSessionId,
          ),
        )}. NEVER mention this in your reply.`,
      };
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
        internalStateMessage,
        ...conversationHistory,
        { role: "user", content: safeUserMessage },
      ];

      const tools = this.toolSelector.getEnabledToolsForTenant(safeTenantId);
      const response = await this.aiProviderService.createCompletion({
        messages,
        tools: tools.length ? tools : undefined,
      });
      openAIResponseId = response.id;
      const choice = response.choices[0];
      const { message } = choice;

      if (message.tool_calls?.length) {
        const toolCall = message.tool_calls[0];
        if (toolCall.type === "function" && toolCall.function?.name) {
          const bookingGate = this.getBookingGate(sessionState);
          if (
            toolCall.function.name === "create_job" &&
            !bookingGate.allowed
          ) {
            const fallback = this.buildMissingFieldPrompt(
              sessionState,
              tenantContext,
              bookingGate.missingField,
            );
            this.sessionStateService.applyAssistantReply(
              safeTenantId,
              safeSessionId,
              fallback,
            );
            await this.callLogService.createLog({
              tenantId: safeTenantId,
              sessionId: safeSessionId,
              transcript: userMessage,
              aiResponse: fallback,
              metadata: {
                sessionId: safeSessionId,
                openAIResponseId,
              },
            });
            return {
              status: "reply",
              reply: fallback,
            };
          }
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

      this.sessionStateService.applyAssistantReply(
        safeTenantId,
        safeSessionId,
        replyPayload,
      );

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
        message: this.buildCloseoutMessage(job),
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

  private buildCloseoutMessage(job: {
    customerName?: string | null;
    issueCategory?: string | null;
    preferredTime?: string | null;
  }): string {
    const firstName =
      job.customerName?.trim().split(/\s+/)[0] ?? "there";
    const categoryRaw = job.issueCategory ?? "service";
    const categoryLabel = categoryRaw
      .toString()
      .replace(/_/g, " ")
      .toLowerCase();
    const preferredTime = job.preferredTime?.trim();
    const windowPhrase = preferredTime
      ? `and targeting ${preferredTime}`
      : "and we'll confirm the next available window";
    return `Thanks, ${firstName} - we're dispatching a technician for your ${categoryLabel} issue ${windowPhrase}. We'll call or text shortly to confirm the window.`;
  }

  private getBookingGate(
    state: ReturnType<SessionStateService["getState"]>,
  ): { allowed: boolean; missingField?: keyof BookingFields | "fee" } {
    const missing = missingInfoFields(state);
    if (missing.length > 0) {
      return { allowed: false, missingField: missing[0] };
    }
    if (!state.fee_disclosed || !state.fee_confirmed) {
      return { allowed: false, missingField: "fee" };
    }
    return { allowed: true };
  }

  private buildMissingFieldPrompt(
    state: ReturnType<SessionStateService["getState"]>,
    tenantContext: Awaited<ReturnType<TenantsService["getTenantContext"]>>,
    missingField?: keyof BookingFields | "fee",
  ): string {
    const field = missingField ?? missingInfoFields(state)[0];
    const firstName = state.fields.name?.trim().split(/\s+/)[0] ?? "there";

    if (field === "address") {
      if (state.fields.address) {
        return `I have the service address as ${state.fields.address}. Is that correct?`;
      }
      return "What is the service address for the visit?";
    }

    if (field === "issue") {
      if (state.fields.issue) {
        return `Just to confirm, the issue is ${state.fields.issue}. Is that correct?`;
      }
      return "Can you briefly describe the issue you're experiencing?";
    }

    if (field === "preferred_window") {
      if (state.fields.preferred_window) {
        return `Just to confirm, you prefer ${state.fields.preferred_window}. Is that correct?`;
      }
      return "What date and time window works best for the appointment?";
    }

    if (field === "phone") {
      return "What is the best phone number to reach you?";
    }

    if (field === "name") {
      return "May I have your full name?";
    }

    if (field === "photos") {
      return "Do you have any photos you can share? (optional)";
    }

    if (field === "fee") {
      const emergencyLine =
        state.emergency_flagged && tenantContext.emergencySurchargeEnabled
          ? ` Because this is an emergency, there is an additional $${tenantContext.emergencySurchargeAmount ?? 75} emergency surcharge.`
          : "";
      return `Before we schedule, we do have a standard $99 diagnostic/service fee.${emergencyLine} Do you agree to these charges so we can proceed?`;
    }

    return `Thanks, ${firstName}. What date and time window works best for the appointment?`;
  }
}
