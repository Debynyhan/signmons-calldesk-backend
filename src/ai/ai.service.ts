import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";
import { CALLDESK_TOOLS } from "./tools/toolSchemas";
import { AiProviderService } from "./providers/ai-provider.service";
import { JOBS_SERVICE } from "../jobs/jobs.constants";
import type { JobsService } from "../jobs/interfaces/jobs-service.interface";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type {
  TenantContext,
  TenantsService,
} from "../tenants/interfaces/tenants-service.interface";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CreateJobPayloadDto } from "./dto/create-job-payload.dto";
import { AiErrorHandler } from "./ai-error.handler";

@Injectable()
export class AiService {
  private readonly systemPrompt: string | null;
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly aiProviderService: AiProviderService,
    private readonly errorHandler: AiErrorHandler,
    @Inject(JOBS_SERVICE) private readonly jobsService: JobsService,
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
      this.logger.error(
        "Failed to load system prompt.",
        error instanceof Error ? error.stack : String(error)
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
      safeTenantId = this.sanitizeIdentifier(tenantId);
      const safeUserMessage = this.sanitizeText(userMessage);

      if (!safeTenantId) {
        throw new BadRequestException("Invalid tenant identifier.");
      }

      if (!safeUserMessage) {
        throw new BadRequestException("Message must contain text.");
      }

      const tenantContext = await this.tenantsService.getTenantContext(
        safeTenantId
      );
      const tenantContextPrompt = this.buildTenantContextPrompt(tenantContext);
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: this.systemPrompt },
        { role: "system", content: tenantContextPrompt },
        { role: "user", content: safeUserMessage },
      ];

      const response = await this.aiProviderService.createCompletion({
        messages,
        tools: CALLDESK_TOOLS,
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
      const dto = this.transformJobPayload(rawArgs);
      const job = await this.jobsService.createJob({
        tenantId,
        payload: dto,
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

  private transformJobPayload(rawArgs?: string) {
    let args: unknown;
    try {
      args = rawArgs ? JSON.parse(rawArgs) : null;
    } catch (error) {
      throw new BadRequestException("Invalid job creation payload.");
    }

    if (!args) {
      throw new BadRequestException("Job payload missing.");
    }

    const dto = plainToInstance(CreateJobPayloadDto, args);
    const errors = validateSync(dto, { whitelist: true });
    if (errors.length) {
      throw new BadRequestException("Job payload validation failed.");
    }
    return dto;
  }

  private buildTenantContextPrompt(context: TenantContext): string {
    return `You are handling calls for tenantId=${context.tenantId} (${context.displayName}). ${context.instructions}`;
  }

  private sanitizeText(value: string): string {
    return value
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replace(/<[^>]*>/g, "")
      .trim();
  }

  private sanitizeIdentifier(value: string): string {
    return value
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .trim();
  }
}
