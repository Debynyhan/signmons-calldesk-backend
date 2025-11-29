import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";
import { LoggingService } from "../../logging/logging.service";

@Catch()
export class SanitizedExceptionFilter implements ExceptionFilter {
  constructor(private readonly loggingService: LoggingService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "An unexpected error occurred.";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = this.normalizeMessage(exception.getResponse());
    }

    const err = exception instanceof Error ? exception : undefined;
    this.loggingService.error(
      `HTTP exception at ${request?.method ?? "unknown"} ${request?.url ?? "unknown"}`,
      err,
      SanitizedExceptionFilter.name,
    );

    response.status(status).json({ statusCode: status, message });
  }

  private normalizeMessage(responseBody: unknown): string {
    if (!responseBody) {
      return "Request failed.";
    }

    if (typeof responseBody === "string") {
      return responseBody;
    }

    if (Array.isArray(responseBody) && responseBody.length > 0) {
      return String(responseBody[0]);
    }

    if (
      typeof responseBody === "object" &&
      responseBody !== null &&
      "message" in responseBody
    ) {
      const { message } = responseBody as { message?: unknown };
      if (Array.isArray(message) && message.length > 0) {
        return String(message[0]);
      }
      if (typeof message === "string") {
        return message;
      }
      if (typeof message === "number" || typeof message === "boolean") {
        return String(message);
      }
    }

    return "Request failed.";
  }
}
