import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

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
}
