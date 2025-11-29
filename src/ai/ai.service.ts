import {
  BadRequestException,
  HttpException,
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
import type {
  CreateJobPayload,
  JobsService,
} from "../jobs/interfaces/jobs-service.interface";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type {
  TenantContext,
  TenantsService,
} from "../tenants/interfaces/tenants-service.interface";

@Injectable()
export class AiService {
  private readonly systemPrompt: string | null;
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly aiProviderService: AiProviderService,
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

    try {
      const safeTenantId = this.sanitizeIdentifier(tenantId);
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
      const status =
        error instanceof HttpException
          ? error.getStatus()
          : (error as { status?: number })?.status;
      const code = (error as { code?: string })?.code;
      if (status === 429 || code === "insufficient_quota") {
        this.logger.warn(
          `Rate limited or insufficient quota reported by OpenAI: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        throw new HttpException(
          "AI is temporarily rate limited. Try again soon.",
          429
        );
      }

      if (error instanceof BadRequestException) {
        this.logger.warn(`Rejected triage request: ${error.message}`);
        throw error;
      }

      if (error instanceof HttpException) {
        this.logger.error(
          `AI provider returned an error: ${error.message}`,
          error.stack
        );
        throw error;
      }

      this.logger.error(
        "Triage failed.",
        error instanceof Error ? error.stack : String(error)
      );
      throw new InternalServerErrorException("AI triage failed.");
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

    let args: CreateJobPayload | null = null;
    try {
      args = rawArgs ? JSON.parse(rawArgs) : null;
    } catch (error) {
      this.logger.error(
        "Failed to parse tool arguments.",
        error instanceof Error ? error.stack : String(error)
      );
      throw new BadRequestException("Invalid job creation payload.");
    }

    if (!args) {
      throw new BadRequestException("Job payload missing.");
    }

    const job = await this.jobsService.createJob({
      tenantId,
      payload: args,
    });
    return {
      status: "job_created",
      jobId: job.id,
      jobPayload: job.payload,
      message: job.message,
    };
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
