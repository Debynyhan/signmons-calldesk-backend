import { JobsService } from "../jobs.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import type { PrismaService } from "../../prisma/prisma.service";

describe("JobsService", () => {
  const tenantId = "tenant-1";
  const sessionId = "session-1";
  const rawArgs = JSON.stringify({
    customerName: "Alice",
    phone: "1234567890",
    issueCategory: "HEATING",
    urgency: "STANDARD",
  });

  const jobRecord = {
    id: "job-1",
    tenantId,
    status: "CREATED",
    urgency: "STANDARD",
    description: null,
    preferredWindowLabel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    customer: {
      fullName: "Alice",
      phone: "1234567890",
    },
    propertyAddress: {
      formattedAddress: "Unknown address",
    },
    serviceCategory: {
      name: "HEATING",
    },
  };

  let prisma: {
    communicationContent: { findMany: jest.Mock };
    job: { findUnique: jest.Mock; create: jest.Mock };
    customer: { upsert: jest.Mock };
    serviceCategory: { findFirst: jest.Mock; create: jest.Mock };
    propertyAddress: { create: jest.Mock };
  };
  let service: JobsService;

  beforeEach(() => {
    prisma = {
      communicationContent: {
        findMany: jest.fn(),
      },
      job: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      customer: {
        upsert: jest.fn(),
      },
      serviceCategory: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      propertyAddress: {
        create: jest.fn(),
      },
    };

    service = new JobsService(
      prisma as unknown as PrismaService,
      new SanitizationService(),
    );
  });

  it("returns existing job when a session already created one", async () => {
    prisma.communicationContent.findMany.mockResolvedValue([
      { payload: { jobId: jobRecord.id } },
    ] as never);
    prisma.job.findUnique.mockResolvedValue(jobRecord as never);

    const result = await service.createJobFromToolCall({
      tenantId,
      sessionId,
      rawArgs,
    });

    expect(result.id).toBe(jobRecord.id);
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("creates a new job when no existing session job is found", async () => {
    prisma.communicationContent.findMany.mockResolvedValue([]);
    prisma.customer.upsert.mockResolvedValue({ id: "cust-1" } as never);
    prisma.serviceCategory.findFirst.mockResolvedValue(null as never);
    prisma.serviceCategory.create.mockResolvedValue({ id: "svc-1" } as never);
    prisma.propertyAddress.create.mockResolvedValue({ id: "addr-1" } as never);
    prisma.job.create.mockResolvedValue(jobRecord as never);

    const result = await service.createJobFromToolCall({
      tenantId,
      sessionId,
      rawArgs,
    });

    expect(result.id).toBe(jobRecord.id);
    expect(prisma.job.create).toHaveBeenCalled();
  });
});
