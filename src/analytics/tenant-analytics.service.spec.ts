import { TenantAnalyticsService } from "./tenant-analytics.service";

describe("TenantAnalyticsService", () => {
  it("upserts tenant analytics when incrementing call count", async () => {
    const upsert = jest.fn();
    const prisma = {
      tenantAnalytics: {
        upsert,
      },
    };

    const service = new TenantAnalyticsService(prisma as never);
    await service.incrementCallCount("tenant-123");

    expect(upsert).toHaveBeenCalledWith({
      where: { tenantId: "tenant-123" },
      create: { tenantId: "tenant-123", callCount: 1 },
      update: { callCount: { increment: 1 } },
    });
  });
});
