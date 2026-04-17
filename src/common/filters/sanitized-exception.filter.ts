import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";
import { LoggingService } from "../../logging/logging.service";

const GENERIC_ERROR_MESSAGE =
  "Request could not be completed. Please try again later.";

const ALLOWED_DIAGNOSTIC_KEYS = new Set(["statusCode", "error", "message"]);
const MAX_DIAGNOSTIC_STRING_LENGTH = 500;

function redactDiagnostic(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object") {
    return {
      message:
        typeof raw === "string"
          ? raw.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)
          : "[non-object]",
    };
  }
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_DIAGNOSTIC_KEYS) {
    const val = (raw as Record<string, unknown>)[key];
    if (val !== undefined) {
      out[key] =
        typeof val === "string"
          ? val.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)
          : val;
    }
  }
  return out;
}

@Catch()
export class SanitizedExceptionFilter implements ExceptionFilter {
  constructor(private readonly loggingService: LoggingService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    const message = GENERIC_ERROR_MESSAGE;

    let diagnostic: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      diagnostic = exception.getResponse();
    }

    const err = exception instanceof Error ? exception : undefined;
    const location = `${request?.method ?? "unknown"} ${request?.url ?? "unknown"}`;
    const context = SanitizedExceptionFilter.name;

    if (diagnostic) {
      this.loggingService.warn(
        `HTTP exception diagnostic (${location}): ${JSON.stringify(redactDiagnostic(diagnostic))}`,
        context,
      );
    }

    this.loggingService.error(`HTTP exception at ${location}`, err, context);

    response.status(status).json({ statusCode: status, message });
  }
}
