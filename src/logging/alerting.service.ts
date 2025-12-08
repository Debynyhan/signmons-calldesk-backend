import { Injectable } from "@nestjs/common";
import { LoggingService } from "./logging.service";

export interface AlertPayload {
  message: string;
  context?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AlertingService {
  constructor(private readonly loggingService: LoggingService) {}

  notifyCritical(payload: AlertPayload) {
    const entry = {
      ...payload,
      timestamp: new Date().toISOString(),
      severity: "critical",
    };
    this.loggingService.warn(
      `[Alert] ${entry.message} metadata=${JSON.stringify(entry.metadata ?? {})}`,
      payload.context ?? AlertingService.name,
    );
  }
}
