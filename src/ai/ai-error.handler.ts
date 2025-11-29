import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";

export interface AiErrorContext {
  tenantId?: string;
  stage: "triage" | "tool_call" | "completion" | string;
  toolName?: string;
  metadata?: Record<string, unknown>;
  messageLength?: number;
  openAIResponseId?: string;
}

@Injectable()
export class AiErrorHandler {
  private readonly logger = new Logger(AiErrorHandler.name);

  handle(error: unknown, context: AiErrorContext): never {
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : (error as { status?: number })?.status;
    const code = (error as { code?: string })?.code;
    const meta = this.formatContext(context);

    if (status === 429 || code === "insufficient_quota") {
      this.logger.warn(
        `Rate limited or insufficient quota reported by AI provider. Context=${meta}`
      );
      throw new HttpException(
        "AI is temporarily rate limited. Try again soon.",
        429
      );
    }

    if (error instanceof BadRequestException) {
      this.logger.warn(
        `Rejected AI request: ${error.message}. Context=${meta}`
      );
      throw error;
    }

    if (error instanceof HttpException) {
      this.logger.error(
        `AI provider returned an error: ${error.message}. Context=${meta}`,
        error.stack
      );
      throw error;
    }

    this.logger.error(
      `Unhandled AI error. Context=${meta}`,
      error instanceof Error ? error.stack : String(error)
    );
    throw new InternalServerErrorException("AI triage failed.");
  }

  private formatContext(context: AiErrorContext): string {
    const filtered = Object.entries(context).filter(([, value]) =>
      value !== undefined && value !== null
    );
    return JSON.stringify(Object.fromEntries(filtered));
  }
}
