import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";
import { CALLDESK_TOOLS } from "./tools/toolSchemas";
import { AiProviderService } from "./providers/ai-provider.service";

@Injectable()
export class AiService {
  private readonly systemPrompt: string | null;
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly aiProviderService: AiProviderService) {
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

      const tenantContext = `You are handling calls for tenantId=${safeTenantId}. The business is a licensed HVAC/Plumbing/Electrical contractor. Always act as a professional dispatcher.`;
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: this.systemPrompt },
        { role: "system", content: tenantContext },
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

  private handleToolCall(name: string, rawArgs?: string) {
    if (name !== "create_job") {
      return {
        status: "unsupported_tool",
        toolName: name,
        rawArgs,
      };
    }

    let args: Record<string, any> = {};
    try {
      args = rawArgs ? JSON.parse(rawArgs) : {};
    } catch (error) {
      this.logger.error(
        "Failed to parse tool arguments.",
        error instanceof Error ? error.stack : String(error)
      );
    }

    const stubJobId = `job_${Date.now()}`;
    return {
      status: "job_created",
      jobId: stubJobId,
      jobPayload: args,
      message: "Job creation stub. Replace with persistence later.",
    };
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
