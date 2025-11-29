import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { LoggingService } from "../logging/logging.service";

type AiStage =
  | "triage"
  | "tool_call"
  | "completion"
  | (string & { readonly __aiStageBrand?: never });

export interface AiErrorContext {
  tenantId?: string;
  stage: AiStage;
  toolName?: string;
  metadata?: Record<string, unknown>;
  messageLength?: number;
  openAIResponseId?: string;
}

@Injectable()
export class AiErrorHandler {
  constructor(private readonly loggingService: LoggingService) {}

  handle(error: unknown, context: AiErrorContext): never {
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : (error as { status?: number })?.status;
    const code = (error as { code?: string })?.code;
    const meta = this.formatContext(context);

    if (status === 429 || code === "insufficient_quota") {
      this.loggingService.warn(
        `Rate limited or insufficient quota reported by AI provider. Context=${meta}`,
        AiErrorHandler.name,
      );
      throw new HttpException(
        "AI is temporarily rate limited. Try again soon.",
        429,
      );
    }

    if (error instanceof BadRequestException) {
      this.loggingService.warn(
        `Rejected AI request: ${error.message}. Context=${meta}`,
        AiErrorHandler.name,
      );
      throw error;
    }

    if (error instanceof HttpException) {
      this.loggingService.error(
        `AI provider returned an error: ${error.message}. Context=${meta}`,
        error,
        AiErrorHandler.name,
      );
      throw error;
    }

    this.loggingService.error(
      `Unhandled AI error. Context=${meta}`,
      error instanceof Error ? error : undefined,
      AiErrorHandler.name,
    );
    throw new InternalServerErrorException("AI triage failed.");
  }

  private formatContext(context: AiErrorContext): string {
    const filtered = Object.entries(context).filter(
      ([, value]) => value !== undefined && value !== null,
    );
    return JSON.stringify(Object.fromEntries(filtered));
  }
}
