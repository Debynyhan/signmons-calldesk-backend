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
import type {
  TenantsService,
} from "../tenants/interfaces/tenants-service.interface";
import { AiErrorHandler } from "./ai-error.handler";
import { LoggingService } from "../logging/logging.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { ToolSelectorService } from "./tools/tool-selector.service";

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
    @Inject(TENANTS_SERVICE) private readonly tenantsService: TenantsService
  ) {
    try {
      const promptPath = join(
        process.cwd(),
        "src",
        "ai",
        "prompts",
        "calldeskSystemPrompt.txt"
      );
      this.systemPrompt = readFileSync(promptPath, "utf8");
    } catch (error) {
      this.loggingService.error(
        "Failed to load system prompt.",
        error instanceof Error ? error : undefined,
        AiService.name
      );
      this.systemPrompt = null;
    }
  }

  async triage(tenantId: string, userMessage: string) {
    if (!this.systemPrompt) {
      throw new InternalServerErrorException(
        "AI is not configured on the server."
      );
    }

    let safeTenantId: string | undefined;
    let openAIResponseId: string | undefined;
    const incomingMessageLength = userMessage?.length ?? 0;
    try {
      safeTenantId = this.sanitizationService.sanitizeIdentifier(tenantId);
      const safeUserMessage = this.sanitizationService.sanitizeText(
        userMessage
      );

      if (!safeTenantId) {
        throw new BadRequestException("Invalid tenant identifier.");
      }

      if (!safeUserMessage) {
        throw new BadRequestException("Message must contain text.");
      }

      const tenantContext = await this.tenantsService.getTenantContext(
        safeTenantId
      );
      const tenantContextPrompt = tenantContext.prompt;
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: this.systemPrompt },
        { role: "system", content: tenantContextPrompt },
        { role: "user", content: safeUserMessage },
      ];

      const tools =
        this.toolSelector.getEnabledToolsForTenant(safeTenantId);
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
          return this.handleToolCall(
            safeTenantId,
            toolCall.function.name,
            toolCall.function.arguments
          );
        }

        return {
          status: "tool_called",
          toolName: toolCall.type,
          rawArgs: toolCall.function?.arguments ?? null,
        };
      }

      return {
        status: "reply",
        reply: message.content,
      };
    } catch (error) {
      this.errorHandler.handle(error, {
        tenantId: safeTenantId ?? tenantId,
        stage: "triage",
        messageLength: incomingMessageLength,
        openAIResponseId,
      });
    }
  }

  private async handleToolCall(
    tenantId: string,
    name: string,
    rawArgs?: string
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
        rawArgs,
      });
      return {
        status: "job_created",
        jobId: job.id,
        jobPayload: job.payload,
        message: job.message,
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
