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
import {
  validateAssistantTurn,
  type ToolCallPayload,
} from "./session-state/call-desk-validator";
import {
  detectDistress,
  detectPricingQuestion,
  getMissingAddressParts,
  getIssueLabel,
  isCompleteAddress,
  getSafeFirstName,
} from "./session-state/state-helpers";

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
      if (detectPricingQuestion(safeUserMessage)) {
        const pricingReply = this.buildPricingQuestionReply(
          sessionState,
          tenantContext,
        );
        this.sessionStateService.applyAssistantReply(
          safeTenantId,
          safeSessionId,
          pricingReply,
        );
        await this.callLogService.createLog({
          tenantId: safeTenantId,
          sessionId: safeSessionId,
          transcript: userMessage,
          aiResponse: pricingReply,
          metadata: {
            sessionId: safeSessionId,
            openAIResponseId,
          },
        });
        return {
          status: "reply",
          reply: pricingReply,
        };
      }
      const questionIntent = this.detectQuestionIntent(safeUserMessage);
      if (questionIntent) {
        const interruptReply = this.buildQuestionInterruptReply(
          sessionState,
          tenantContext,
          questionIntent,
        );
        if (interruptReply) {
          this.sessionStateService.applyAssistantReply(
            safeTenantId,
            safeSessionId,
            interruptReply,
          );
          await this.callLogService.createLog({
            tenantId: safeTenantId,
            sessionId: safeSessionId,
            transcript: userMessage,
            aiResponse: interruptReply,
            metadata: {
              sessionId: safeSessionId,
              openAIResponseId,
            },
          });
          return {
            status: "reply",
            reply: interruptReply,
          };
        }
      }
      const bookingGate = this.getBookingGate(sessionState);
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
        toolChoice: bookingGate.allowed ? "auto" : "none",
      });
      openAIResponseId = response.id;
      const choice = response.choices[0];
      const { message } = choice;

      if (message.tool_calls?.length) {
        const toolCall = message.tool_calls[0];
        if (toolCall.type === "function" && toolCall.function?.name) {
          if (
            toolCall.function.name === "create_job" &&
            !bookingGate.allowed
          ) {
            const shouldMarkUrgency = this.shouldMarkUrgencyAcknowledged(
              sessionState,
            );
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
            if (shouldMarkUrgency) {
              this.sessionStateService.updateState(
                safeTenantId,
                safeSessionId,
                { urgency_acknowledged: true },
              );
            }
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
      const sanitizedReply = this.sanitizeAssistantReply(replyPayload);
      const previewState = this.sessionStateService.previewAssistantUpdate(
        sessionState,
        sanitizedReply,
      );
      const validation = validateAssistantTurn({
        prevState: sessionState,
        nextState: previewState,
        assistantText: sanitizedReply,
        toolCalls: this.extractToolCalls(message),
      });
      if (!validation.ok) {
        const normalizedField = this.normalizeMissingField(
          validation.missingField,
        );
        if (
          this.shouldRetryForToolCall(validation) &&
          validation.correctiveSystemMessage
        ) {
          const retryResult = await this.retryToolCallResponse(
            messages,
            tools,
            validation.correctiveSystemMessage,
            safeTenantId,
            safeSessionId,
          );
          if (retryResult) {
            return retryResult;
          }
        }
        const useCorrection = Boolean(
          !normalizedField &&
            validation.correctiveSystemMessage &&
            !this.isInternalCorrection(validation.correctiveSystemMessage),
        );
        const correction = useCorrection
          ? validation.correctiveSystemMessage
          : undefined;
        const shouldMarkUrgency = this.shouldMarkUrgencyAcknowledged(
          sessionState,
        );
        const fallback =
          correction ??
          this.buildMissingFieldPrompt(
            sessionState,
            tenantContext,
            normalizedField,
          );
        this.sessionStateService.applyAssistantReply(
          safeTenantId,
          safeSessionId,
          fallback,
        );
        if (shouldMarkUrgency) {
          this.sessionStateService.updateState(
            safeTenantId,
            safeSessionId,
            { urgency_acknowledged: true },
          );
        }
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

      const reply = {
        status: "reply" as const,
        reply: sanitizedReply,
      };

      this.sessionStateService.applyAssistantReply(
        safeTenantId,
        safeSessionId,
        sanitizedReply,
      );

      await this.callLogService.createLog({
        tenantId: safeTenantId,
        sessionId: safeSessionId,
        transcript: userMessage,
        aiResponse: sanitizedReply,
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
    if (state.step !== "BOOKING") {
      const missing = missingInfoFields(state);
      return {
        allowed: false,
        missingField: missing.length ? missing[0] : "fee",
      };
    }
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
    const safeFirstName = getSafeFirstName(state.fields.name);
    const firstName = safeFirstName ?? "there";
    const urgencyPrefix = this.buildUrgencyStatement(state, firstName);
    const acknowledgement = this.buildAcknowledgement(state, field);

    if (field === "address") {
      if (state.fields.address) {
        if (isCompleteAddress(state.fields.address)) {
          const question = urgencyPrefix
            ? `Can you confirm the service address is ${state.fields.address}?`
            : `I have the service address as ${state.fields.address}. Is that correct?`;
          return this.composePromptLine(
            urgencyPrefix,
            acknowledgement,
            question,
          );
        }
        const missingParts = getMissingAddressParts(state.fields.address);
        const nextPart = missingParts[0];
        if (nextPart === "city") {
          const question = "What city is the service address in?";
          return this.composePromptLine(
            urgencyPrefix,
            acknowledgement,
            question,
          );
        }
        if (nextPart === "state") {
          const question = "What state is the service address in?";
          return this.composePromptLine(
            urgencyPrefix,
            acknowledgement,
            question,
          );
        }
        if (nextPart === "zip") {
          const question = "What is the ZIP code for the service address?";
          return this.composePromptLine(
            urgencyPrefix,
            acknowledgement,
            question,
          );
        }
      }
      const question =
        "What is the full service address (street, city, state, and ZIP)?";
      return this.composePromptLine(
        urgencyPrefix,
        acknowledgement,
        question,
      );
    }

    if (field === "issue") {
      if (state.fields.issue) {
        const question = urgencyPrefix
          ? `Can you confirm the issue is ${state.fields.issue}?`
          : `Just to confirm, the issue is ${state.fields.issue}. Is that correct?`;
        return this.composePromptLine(
          urgencyPrefix,
          acknowledgement,
          question,
        );
      }
      const question = "Can you briefly describe the issue you're experiencing?";
      return this.composePromptLine(
        urgencyPrefix,
        acknowledgement,
        question,
      );
    }

    if (field === "preferred_window") {
      if (state.fields.preferred_window) {
        const question = urgencyPrefix
          ? `Do you prefer ${state.fields.preferred_window}?`
          : `Just to confirm, you prefer ${state.fields.preferred_window}. Is that correct?`;
        return this.composePromptLine(
          urgencyPrefix,
          acknowledgement,
          question,
        );
      }
      const question = "What date and time window works best for the appointment?";
      return this.composePromptLine(
        urgencyPrefix,
        acknowledgement,
        question,
      );
    }

    if (field === "phone") {
      const question = "What is the best phone number to reach you?";
      return this.composePromptLine(
        urgencyPrefix,
        acknowledgement,
        question,
      );
    }

    if (field === "name") {
      if (state.fields.name) {
        const question = "What is your last name?";
        if (urgencyPrefix) {
          return this.composePromptLine(
            urgencyPrefix,
            acknowledgement,
            question,
          );
        }
        if (safeFirstName && !state.empathy_used) {
          return `I'm sorry you're dealing with that, ${safeFirstName} - we'll take care of it. ${question}`;
        }
        return `Thanks${safeFirstName ? `, ${safeFirstName}` : ""}. ${question}`;
      }
      const question = "May I have your full name?";
      return this.composePromptLine(
        urgencyPrefix,
        acknowledgement,
        question,
      );
    }

    if (field === "photos") {
      const question = "Do you have any photos you can share? (optional)";
      return this.composePromptLine(
        urgencyPrefix,
        acknowledgement,
        question,
      );
    }

    if (field === "fee") {
      const emergencyLine =
        state.emergency_flagged && tenantContext.emergencySurchargeEnabled
          ? ` Because this is an emergency, there is an additional $${tenantContext.emergencySurchargeAmount ?? 75} emergency surcharge.`
          : "";
      const question = urgencyPrefix
        ? `Do you agree to the $99 diagnostic/service fee${emergencyLine} so we can proceed?`
        : `Before we schedule, we do have a standard $99 diagnostic/service fee.${emergencyLine} Do you agree to these charges so we can proceed?`;
      return this.composePromptLine(
        urgencyPrefix,
        acknowledgement,
        question,
      );
    }

    if (detectDistress(state.fields.issue ?? "")) {
      const question = "What date and time window works best for the appointment?";
      if (urgencyPrefix) {
        return this.composePromptLine(
          urgencyPrefix,
          acknowledgement,
          question,
        );
      }
      return `I'm sorry you're dealing with this, ${firstName}. ${question}`;
    }
    const question = "What date and time window works best for the appointment?";
    return this.composePromptLine(
      urgencyPrefix,
      acknowledgement,
      question,
    );
  }

  private buildAcknowledgement(
    state: ReturnType<SessionStateService["getState"]>,
    missingField?: keyof BookingFields | "fee",
  ): string | null {
    const lastCaptured = state.last_captured_field ?? null;
    if (!lastCaptured || lastCaptured === missingField) {
      return null;
    }
    switch (lastCaptured) {
      case "phone":
        return "Thanks - I have your phone number";
      case "name": {
        const safeFirstName = getSafeFirstName(state.fields.name);
        return safeFirstName
          ? `Thanks, ${safeFirstName}`
          : "Thanks - I have your name";
      }
      case "address":
        return "Thanks - I have your service address";
      case "issue":
        return "Got it - I have the issue details";
      case "preferred_window":
        return "Great - I have your preferred time window";
      default:
        return null;
    }
  }

  private composePromptLine(
    urgencyPrefix: string | null,
    acknowledgement: string | null,
    question: string,
  ): string {
    if (urgencyPrefix) {
      if (acknowledgement && acknowledgement !== "Got it - I have the issue details") {
        const lowerQuestion =
          question.charAt(0).toLowerCase() + question.slice(1);
        return `${urgencyPrefix} ${acknowledgement}; ${lowerQuestion}`;
      }
      return `${urgencyPrefix} ${question}`;
    }
    if (acknowledgement) {
      return `${acknowledgement}. ${question}`;
    }
    return question;
  }

  private buildMissingFieldQuestion(
    state: ReturnType<SessionStateService["getState"]>,
    missingField?: keyof BookingFields,
  ): string {
    const field = missingField ?? missingInfoFields(state)[0];

    if (field === "address") {
      const addressValue = state.fields.address?.trim();
      if (addressValue) {
        if (isCompleteAddress(addressValue)) {
          return `I have the service address as ${addressValue}. Is that correct?`;
        }
        const missingParts = getMissingAddressParts(addressValue);
        if (missingParts.length > 1) {
          const partsLabel = missingParts
            .map((part) => part.toUpperCase())
            .join(", ");
          return `Thanks - I have the street address as ${addressValue}. What ${partsLabel} should I use?`;
        }
        const nextPart = missingParts[0];
        if (nextPart === "city") {
          return `Thanks - I have the street address as ${addressValue}. What city is it in?`;
        }
        if (nextPart === "state") {
          return `Got it for ${addressValue}. What state is the service address in?`;
        }
        if (nextPart === "zip") {
          return `Thanks - I have ${addressValue}. What is the ZIP code?`;
        }
      }
      return "What is the full service address (street, city, state, and ZIP)?";
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
      if (state.fields.name) {
        return "What is your last name?";
      }
      return "May I have your full name?";
    }

    if (field === "photos") {
      return "Do you have any photos you can share? (optional)";
    }

    return "What date and time window works best for the appointment?";
  }

  private buildPricingQuestionReply(
    state: ReturnType<SessionStateService["getState"]>,
    tenantContext: Awaited<ReturnType<TenantsService["getTenantContext"]>>,
  ): string {
    const emergencyLine =
      state.emergency_flagged && tenantContext.emergencySurchargeEnabled
        ? ` Because this is an emergency, there is an additional $${tenantContext.emergencySurchargeAmount ?? 75} emergency surcharge.`
        : "";
    const pricingSentence = `We do have a standard $99 diagnostic/service fee.${emergencyLine}`;
    const nextQuestion = this.buildMissingFieldQuestion(
      state,
      missingInfoFields(state)[0],
    );
    return `${pricingSentence} ${nextQuestion}`;
  }

  private shouldMarkUrgencyAcknowledged(
    state: ReturnType<SessionStateService["getState"]>,
  ): boolean {
    return Boolean(state.urgency && !state.urgency_acknowledged);
  }

  private detectQuestionIntent(
    message: string,
  ):
    | "schedule"
    | "next_steps"
    | "service_area"
    | "emergency_policy"
    | "service_hours"
    | "texting"
    | "emergency_eta"
    | null {
    const text = message.toLowerCase();
    if (
      /\b(earliest|soonest|how soon|when can|when will|availability|time window|what time)\b/.test(
        text,
      )
    ) {
      return "schedule";
    }
    if (
      /\b(what happens next|what's next|next steps|what do you need from me)\b/.test(
        text,
      )
    ) {
      return "next_steps";
    }
    if (
      /\b(do you (service|serve|cover)|service area|in my area)\b/.test(text)
    ) {
      return "service_area";
    }
    if (
      /\b(is this an emergency|why (is|is it) an emergency|why emergency)\b/.test(
        text,
      )
    ) {
      return "emergency_policy";
    }
    if (
      /\b(hours|open|close|closing|service hours|business hours|operating hours)\b/.test(
        text,
      )
    ) {
      return "service_hours";
    }
    if (
      /\b(text|sms|texting|message|call or text)\b/.test(text)
    ) {
      return "texting";
    }
    if (
      /\b(within an hour|eta|how long|how fast|response time|arrival time)\b/.test(
        text,
      )
    ) {
      return "emergency_eta";
    }
    return null;
  }

  private buildQuestionInterruptReply(
    state: ReturnType<SessionStateService["getState"]>,
    tenantContext: Awaited<ReturnType<TenantsService["getTenantContext"]>>,
    intent:
      | "schedule"
      | "next_steps"
      | "service_area"
      | "emergency_policy"
      | "service_hours"
      | "texting"
      | "emergency_eta",
  ): string | null {
    const missingInfo = missingInfoFields(state);
    const needsFee = !state.fee_disclosed || !state.fee_confirmed;
    const nextQuestion = missingInfo.length
      ? this.buildMissingFieldQuestion(state, missingInfo[0])
      : needsFee
        ? this.buildMissingFieldPrompt(state, tenantContext, "fee")
        : null;
    let answerSentence = "";
    switch (intent) {
      case "schedule":
        answerSentence =
          "We can prioritize and confirm the earliest available window once we have your details.";
        break;
      case "next_steps":
        answerSentence =
          "I'll gather a few details and then schedule the visit and confirm the window.";
        break;
      case "service_area":
        answerSentence =
          "We service the local area and can confirm once I have your address.";
        break;
      case "emergency_policy":
        answerSentence =
          "Based on what you described, we treat this as an emergency so we can get help out quickly.";
        break;
      case "service_hours":
        answerSentence =
          "We can get you taken care of and confirm the service hours once we have your details.";
        break;
      case "texting":
        answerSentence =
          "We can call or text updates to confirm the appointment once we have your details.";
        break;
      case "emergency_eta":
        answerSentence =
          "For emergencies, we aim to dispatch a technician within about an hour when possible, and we will confirm the exact ETA.";
        break;
      default:
        return null;
    }

    if (!nextQuestion) {
      return answerSentence;
    }
    return `${answerSentence} ${nextQuestion}`;
  }

  private normalizeMissingField(
    missingField?: keyof BookingFields | "fee_disclosure" | "fee_confirmation",
  ): keyof BookingFields | "fee" | undefined {
    if (!missingField) {
      return undefined;
    }
    if (missingField === "fee_disclosure" || missingField === "fee_confirmation") {
      return "fee";
    }
    return missingField;
  }

  private extractToolCalls(
    message: OpenAI.ChatCompletionMessage,
  ): ToolCallPayload[] | undefined {
    if (!message.tool_calls?.length) {
      return undefined;
    }
    return message.tool_calls
      .filter((call) => call.type === "function" && call.function?.name)
      .map((call) => ({
        name: call.function?.name ?? "unknown",
        arguments: call.function?.arguments,
      }));
  }

  private sanitizeAssistantReply(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
      return trimmed;
    }
    const parts =
      trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [trimmed];
    let limited = parts.slice(0, 2).join(" ").trim();
    const questionIndex = limited.indexOf("?");
    if (questionIndex !== -1) {
      const nextQuestion = limited.indexOf("?", questionIndex + 1);
      if (nextQuestion !== -1) {
        limited = limited.slice(0, nextQuestion + 1).trim();
      }
    }
    return limited;
  }

  private isInternalCorrection(message: string): boolean {
    return /\b(rewrite|you must|do not|ask for|stay in|follow|call the create_job|move forward)\b/i.test(
      message,
    );
  }

  private shouldRetryForToolCall(
    validation: ReturnType<typeof validateAssistantTurn>,
  ): boolean {
    return Boolean(
      validation.reason &&
        validation.reason.toLowerCase().includes("tool call"),
    );
  }

  private async retryToolCallResponse(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: OpenAI.ChatCompletionTool[] | undefined,
    correctiveSystemMessage: string,
    tenantId: string,
    sessionId: string,
  ): Promise<
    | {
        status: "reply";
        reply: string;
      }
    | ReturnType<AiService["handleToolCall"]>
    | null
  > {
    const retryMessages: OpenAI.ChatCompletionMessageParam[] = [
      ...messages,
      { role: "system", content: correctiveSystemMessage },
    ];
    const retryResponse = await this.aiProviderService.createCompletion({
      messages: retryMessages,
      tools: tools?.length ? tools : undefined,
      toolChoice: "auto",
    });
    const retryChoice = retryResponse.choices[0];
    const retryMessage = retryChoice.message;
    if (retryMessage.tool_calls?.length) {
      const toolCall = retryMessage.tool_calls[0];
      if (toolCall.type === "function" && toolCall.function?.name) {
        return this.handleToolCall(
          tenantId,
          sessionId,
          toolCall.function.name,
          toolCall.function.arguments,
        );
      }
    }
    return null;
  }

  private buildUrgencyStatement(
    state: ReturnType<SessionStateService["getState"]>,
    firstName: string,
  ): string | null {
    if (!state.urgency || state.urgency_acknowledged) {
      return null;
    }
    const safeFirstName = getSafeFirstName(state.fields.name);
    const nameSuffix = safeFirstName ? `, ${safeFirstName}` : "";
    const issueLabel = getIssueLabel(state.fields.issue, state.category);
    const issueSnippet =
      issueLabel === "issue" ? "the issue" : `your ${issueLabel}`;
    const empathyLead = state.empathy_used
      ? "We"
      : `I'm sorry to hear about ${issueSnippet}${nameSuffix} - we`;
    switch (state.urgency) {
      case "EMERGENCY":
        return `${empathyLead} will treat this as an emergency and get you taken care of.`;
      case "HIGH_PRIORITY":
        return `${empathyLead} will treat this as a high priority and get you taken care of.`;
      case "STANDARD":
        return `${empathyLead} will treat this as a standard request and get you taken care of.`;
      default:
        return null;
    }
  }
}
