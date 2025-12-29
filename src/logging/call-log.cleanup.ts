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
      const staleConversations = await this.prisma.conversation.findMany({
        where: {
          status: "ONGOING",
          updatedAt: { lte: cutoff },
        },
        select: {
          id: true,
          tenantId: true,
        },
      });

      const now = new Date();
      let closedCount = 0;
      for (const conversation of staleConversations) {
        await this.prisma.conversation.update({
          where: {
            id_tenantId: {
              id: conversation.id,
              tenantId: conversation.tenantId,
            },
          },
          data: {
            status: "ABANDONED",
            endedAt: now,
          },
        });
        closedCount += 1;
      }

      if (closedCount > 0) {
        this.logger.log(
          `Marked ${closedCount} conversations as abandoned after ${idleMinutes} minutes of inactivity.`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Failed to mark idle conversations as abandoned.",
        error as Error,
      );
    }
  }
}
