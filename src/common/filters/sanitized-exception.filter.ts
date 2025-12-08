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
        `HTTP exception diagnostic (${location}): ${JSON.stringify(diagnostic)}`,
        context,
      );
    }

    this.loggingService.error(`HTTP exception at ${location}`, err, context);

    response.status(status).json({ statusCode: status, message });
  }
}
