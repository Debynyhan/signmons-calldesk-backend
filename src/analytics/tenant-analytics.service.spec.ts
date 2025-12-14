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

  it("increments job conversions", async () => {
    const upsert = jest.fn();
    const prisma = {
      tenantAnalytics: {
        upsert,
      },
    };
    const service = new TenantAnalyticsService(prisma as never);

    await service.incrementJobsCreated("tenant-abc");

    expect(upsert).toHaveBeenCalledWith({
      where: { tenantId: "tenant-abc" },
      create: { tenantId: "tenant-abc", jobsCreated: 1 },
      update: { jobsCreated: { increment: 1 } },
    });
  });

  it("records tool usage for new tenants", async () => {
    const create = jest.fn();
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      tenantAnalytics: {
        findUnique,
        create,
      },
    };
    const service = new TenantAnalyticsService(prisma as never);

    await service.recordToolUsage("tenant-new", "create_job");

    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId: "tenant-new" },
      select: { toolUsage: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: { tenantId: "tenant-new", toolUsage: { create_job: 1 } },
    });
  });

  it("increments tool usage counts for existing tenants", async () => {
    const update = jest.fn();
    const findUnique = jest
      .fn()
      .mockResolvedValue({ toolUsage: { create_job: 2 } });
    const prisma = {
      tenantAnalytics: {
        findUnique,
        update,
      },
    };
    const service = new TenantAnalyticsService(prisma as never);

    await service.recordToolUsage("tenant-existing", "create_job");

    expect(update).toHaveBeenCalledWith({
      where: { tenantId: "tenant-existing" },
      data: { toolUsage: { create_job: 3 } },
    });
  });

  it("records info collection duration with positive increments", async () => {
    const upsert = jest.fn();
    const prisma = {
      tenantAnalytics: {
        upsert,
      },
    };
    const service = new TenantAnalyticsService(prisma as never);

    await service.recordInfoCollectionDuration("tenant-xyz", 5000);

    expect(upsert).toHaveBeenCalledWith({
      where: { tenantId: "tenant-xyz" },
      create: {
        tenantId: "tenant-xyz",
        totalInfoCollectionMs: 5000,
        completedSessions: 1,
      },
      update: {
        totalInfoCollectionMs: { increment: 5000 },
        completedSessions: { increment: 1 },
      },
    });
  });

  it("ignores non-positive durations when recording info collection", async () => {
    const upsert = jest.fn();
    const service = new TenantAnalyticsService({
      tenantAnalytics: {
        upsert,
      },
    } as never);

    await service.recordInfoCollectionDuration("tenant-zero", -100);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          totalInfoCollectionMs: 0,
          completedSessions: 0,
        }),
        update: expect.objectContaining({
          totalInfoCollectionMs: { increment: 0 },
          completedSessions: undefined,
        }),
      }),
    );
  });
});
