import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_IDLE_MINUTES = 30;

@Injectable()
export class CallLogCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallLogCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.logger.log("Call log cleanup service initialized.");
  }

  onModuleDestroy() {
    this.logger.log("Call log cleanup service destroyed.");
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async cleanupIdleSessions() {
    const idleMinutes = Number(
      process.env.CALL_LOG_IDLE_MINUTES ?? DEFAULT_IDLE_MINUTES,
    );
    const cutoff = new Date(Date.now() - idleMinutes * 60 * 1000);
    try {
      const staleLogs = await this.prisma.callLog.findMany({
        where: {
          sessionClosedAt: null,
          createdAt: { lte: cutoff },
        },
        select: {
          tenantId: true,
          metadata: true,
        },
      });

      const sessions = new Map<
        string,
        { tenantId: string; sessionId: string }
      >();
      for (const log of staleLogs) {
        const sessionId = this.extractSessionId(log.metadata);
        if (!sessionId) {
          continue;
        }
        const key = `${log.tenantId}:${sessionId}`;
        if (!sessions.has(key)) {
          sessions.set(key, { tenantId: log.tenantId, sessionId });
        }
      }

      const now = new Date();
      let closedCount = 0;
      for (const session of sessions.values()) {
        const result = await this.prisma.callLog.updateMany({
          where: {
            tenantId: session.tenantId,
            sessionClosedAt: null,
            metadata: {
              path: ["sessionId"],
              equals: session.sessionId,
            },
          },
          data: { sessionClosedAt: now },
        });
        closedCount += result.count;
      }

      if (closedCount > 0) {
        this.logger.log(
          `Marked ${closedCount} call log entries as closed due to ${idleMinutes} minutes of inactivity.`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Failed to mark idle call logs as closed.",
        error as Error,
      );
    }
  }

  private extractSessionId(metadata: unknown): string | null {
    if (
      metadata &&
      typeof metadata === "object" &&
      "sessionId" in metadata &&
      typeof (metadata as Record<string, unknown>).sessionId === "string"
    ) {
      return (metadata as { sessionId: string }).sessionId;
    }
    return null;
  }
}
