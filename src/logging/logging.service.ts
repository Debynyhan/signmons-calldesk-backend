import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class LoggingService {
  private readonly logger = new Logger("CallDeskLogger");

  error(message: string, error?: Error, context?: string) {
    this.logger.error(message, error?.stack, context);
  }

  warn(message: unknown, context?: string) {
    this.logger.warn(message as never, context);
  }

  log(message: unknown, context?: string) {
    this.logger.log(message as never, context);
  }
}
