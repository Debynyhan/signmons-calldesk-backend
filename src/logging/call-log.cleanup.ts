import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomUUID } from "crypto";
import {
  CommunicationChannel,
  CommunicationDirection,
  CommunicationProvider,
  CommunicationStatus,
  Prisma,
} from "@prisma/client";
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
      const staleLogs = await this.prisma.communicationContent.findMany({
        where: {
          createdAt: { lte: cutoff },
          payload: {
            path: ["type"],
            equals: "message",
          },
        },
        select: {
          tenantId: true,
          payload: true,
          createdAt: true,
        },
      });

      const sessions = new Map<
        string,
        { tenantId: string; sessionId: string; lastMessageAt: Date }
      >();
      for (const log of staleLogs) {
        const sessionId = this.extractSessionId(log.payload);
        if (!sessionId) {
          continue;
        }
        const key = `${log.tenantId}:${sessionId}`;
        const existing = sessions.get(key);
        if (!existing || existing.lastMessageAt < log.createdAt) {
          sessions.set(key, {
            tenantId: log.tenantId,
            sessionId,
            lastMessageAt: log.createdAt,
          });
        }
      }

      let closedCount = 0;
      for (const session of sessions.values()) {
        const closed = await this.prisma.communicationContent.findFirst({
          where: {
            tenantId: session.tenantId,
            payload: {
              path: ["sessionId"],
              equals: session.sessionId,
            },
            AND: [
              {
                payload: {
                  path: ["type"],
                  equals: "session_closed",
                },
              },
            ],
            createdAt: { gt: session.lastMessageAt },
          },
          select: { id: true },
        });

        if (closed) {
          continue;
        }

        await this.createSessionClosedMarker(
          session.tenantId,
          session.sessionId,
        );
        closedCount += 1;
      }

      if (closedCount > 0) {
        this.logger.log(
          `Closed ${closedCount} idle sessions after ${idleMinutes} minutes of inactivity.`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Failed to mark idle call logs as closed.",
        error as Error,
      );
    }
  }

  private extractSessionId(payload: Prisma.JsonValue): string | null {
    if (
      payload &&
      typeof payload === "object" &&
      "sessionId" in payload &&
      typeof (payload as Record<string, unknown>).sessionId === "string"
    ) {
      return (payload as { sessionId: string }).sessionId;
    }
    return null;
  }

  private async createSessionClosedMarker(
    tenantId: string,
    sessionId: string,
  ): Promise<void> {
    const eventId = randomUUID();
    const contentId = randomUUID();
    await this.prisma.communicationEvent.create({
      data: {
        id: eventId,
        tenantId,
        channel: CommunicationChannel.WEBCHAT,
        direction: CommunicationDirection.OUTBOUND,
        provider: CommunicationProvider.OTHER,
        status: CommunicationStatus.SENT,
        content: {
          create: {
            id: contentId,
            tenantId,
            payload: {
              sessionId,
              type: "session_closed",
            },
          },
        },
      },
    });
  }
}
