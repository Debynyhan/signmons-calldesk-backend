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

    if (exception instanceof HttpException) {
      status = exception.getStatus();
    }

    const err = exception instanceof Error ? exception : undefined;
    this.loggingService.error(
      `HTTP exception at ${request?.method ?? "unknown"} ${request?.url ?? "unknown"}`,
      err,
      SanitizedExceptionFilter.name,
    );

    response.status(status).json({ statusCode: status, message });
  }
}
