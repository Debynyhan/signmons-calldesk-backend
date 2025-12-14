import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

type ToolUsageMap = Record<string, number>;

@Injectable()
export class TenantAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async incrementCallCount(tenantId: string): Promise<void> {
    await this.prisma.tenantAnalytics.upsert({
      where: { tenantId },
      create: { tenantId, callCount: 1 },
      update: {
        callCount: {
          increment: 1,
        },
      },
    });
  }

  async incrementJobsCreated(tenantId: string): Promise<void> {
    await this.prisma.tenantAnalytics.upsert({
      where: { tenantId },
      create: { tenantId, jobsCreated: 1 },
      update: {
        jobsCreated: {
          increment: 1,
        },
      },
    });
  }

  async recordToolUsage(tenantId: string, toolName: string): Promise<void> {
    const sanitizedTool = toolName?.trim() || "unknown_tool";
    const existing = await this.prisma.tenantAnalytics.findUnique({
      where: { tenantId },
      select: { toolUsage: true },
    });

    const usageMap: ToolUsageMap = this.normalizeToolUsage(
      existing?.toolUsage,
    );
    usageMap[sanitizedTool] = (usageMap[sanitizedTool] ?? 0) + 1;

    if (existing) {
      await this.prisma.tenantAnalytics.update({
        where: { tenantId },
        data: { toolUsage: usageMap },
      });
    } else {
      await this.prisma.tenantAnalytics.create({
        data: { tenantId, toolUsage: usageMap },
      });
    }
  }

  async recordInfoCollectionDuration(
    tenantId: string,
    durationMs: number,
  ): Promise<void> {
    const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    await this.prisma.tenantAnalytics.upsert({
      where: { tenantId },
      create: {
        tenantId,
        totalInfoCollectionMs: safeDuration,
        completedSessions: safeDuration > 0 ? 1 : 0,
      },
      update: {
        totalInfoCollectionMs: {
          increment: safeDuration,
        },
        completedSessions: safeDuration > 0 ? { increment: 1 } : undefined,
      },
    });
  }

  async getAnalyticsSnapshot(tenantId: string) {
    const analytics = await this.prisma.tenantAnalytics.findUnique({
      where: { tenantId },
    });
    const toolUsage = this.normalizeToolUsage(analytics?.toolUsage);
    const totalMs =
      analytics?.totalInfoCollectionMs !== undefined
        ? Number(analytics.totalInfoCollectionMs)
        : 0;
    const sessions = analytics?.completedSessions ?? 0;
    const averageInfoCollectionMs =
      sessions > 0 ? Math.round(totalMs / sessions) : 0;

    return {
      callCount: analytics?.callCount ?? 0,
      jobsCreated: analytics?.jobsCreated ?? 0,
      toolUsage,
      averageInfoCollectionMs,
    };
  }

  private normalizeToolUsage(value: unknown): ToolUsageMap {
    if (!value || typeof value !== "object") {
      return {};
    }
    const map: ToolUsageMap = {};
    for (const [key, count] of Object.entries(value as ToolUsageMap)) {
      if (typeof count === "number" && count >= 0) {
        map[key] = count;
      }
    }
    return map;
  }
}
