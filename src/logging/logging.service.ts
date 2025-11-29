import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class LoggingService {
  private readonly logger = new Logger("CallDeskLogger");

  error(message: string, error?: Error, context?: string) {
    this.logger.error(message, error?.stack, context);
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, context);
  }

  log(message: string, context?: string) {
    this.logger.log(message, context);
  }
}
