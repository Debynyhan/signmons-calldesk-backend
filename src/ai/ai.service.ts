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

const isFunctionToolCall = (
  toolCall: OpenAI.ChatCompletionMessageToolCall,
): toolCall is OpenAI.ChatCompletionMessageFunctionToolCall =>
  toolCall.type === "function";

type TriageContext = {
  channel?: "VOICE" | "SMS" | "WEBCHAT";
  metadata?: Record<string, unknown>;
};

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
    context?: TriageContext,
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
      });
      openAIResponseId = response.id;
      const choice = response.choices[0];
      const { message } = choice;

      if (message.tool_calls?.length) {
        const toolCall = message.tool_calls[0];
        if (isFunctionToolCall(toolCall) && toolCall.function?.name) {
          return this.handleToolCall(
            safeTenantId,
            safeSessionId,
            toolCall.function.name,
            toolCall.function.arguments,
            context,
          );
        }

        const rawArgs = isFunctionToolCall(toolCall)
          ? (toolCall.function?.arguments ?? null)
          : null;

        return {
          status: "tool_called",
          toolName: toolCall.type,
          rawArgs,
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

      const logMetadata = {
        ...(context?.metadata ?? {}),
        channel: context?.channel,
        openAIResponseId,
      };

      await this.callLogService.createLog({
        tenantId: safeTenantId,
        sessionId: safeSessionId,
        transcript: userMessage,
        aiResponse: replyPayload,
        metadata: logMetadata,
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
    context?: TriageContext,
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
        metadata: {
          ...(context?.metadata ?? {}),
          channel: context?.channel,
          toolName: name,
        },
      });
      await this.callLogService.clearSession(tenantId, sessionId);
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
}
