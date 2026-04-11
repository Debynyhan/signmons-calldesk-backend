import { BadRequestException } from "@nestjs/common";
import { JobsService } from "../jobs.service";
import { IssueNormalizerService } from "../issue-normalizer.service";
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
    job: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    customer: { upsert: jest.Mock };
    serviceCategory: { findFirst: jest.Mock; create: jest.Mock };
    propertyAddress: { create: jest.Mock };
    payment: { findFirst: jest.Mock };
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
        update: jest.fn(),
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
      payment: {
        findFirst: jest.fn(),
      },
    };

    const sanitizationService = new SanitizationService();
    service = new JobsService(
      prisma as unknown as PrismaService,
      sanitizationService,
      new IssueNormalizerService(sanitizationService),
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

  it("fails closed when required fields are missing", async () => {
    prisma.communicationContent.findMany.mockResolvedValue([]);

    await expect(
      service.createJobFromToolCall({
        tenantId,
        sessionId,
        rawArgs: JSON.stringify({ urgency: "STANDARD" }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("fails closed when phone is invalid", async () => {
    prisma.communicationContent.findMany.mockResolvedValue([]);

    await expect(
      service.createJobFromToolCall({
        tenantId,
        sessionId,
        rawArgs: JSON.stringify({
          customerName: "Alice",
          phone: "abc",
          issueCategory: "HEATING",
          urgency: "STANDARD",
        }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("fails closed when issueCategory is unknown", async () => {
    prisma.communicationContent.findMany.mockResolvedValue([]);

    await expect(
      service.createJobFromToolCall({
        tenantId,
        sessionId,
        rawArgs: JSON.stringify({
          customerName: "Alice",
          phone: "1234567890",
          issueCategory: "GARBAGE",
          urgency: "STANDARD",
        }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customer.upsert).not.toHaveBeenCalled();
    expect(prisma.serviceCategory.findFirst).not.toHaveBeenCalled();
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("fails closed when preferredTime is invalid", async () => {
    prisma.communicationContent.findMany.mockResolvedValue([]);

    await expect(
      service.createJobFromToolCall({
        tenantId,
        sessionId,
        rawArgs: JSON.stringify({
          customerName: "Alice",
          phone: "1234567890",
          issueCategory: "HEATING",
          urgency: "STANDARD",
          preferredTime: "sometime next week",
        }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("fails closed when unexpected fields are present", async () => {
    prisma.communicationContent.findMany.mockResolvedValue([]);

    await expect(
      service.createJobFromToolCall({
        tenantId,
        sessionId,
        rawArgs: JSON.stringify({
          customerName: "Alice",
          phone: "1234567890",
          issueCategory: "HEATING",
          urgency: "STANDARD",
          extraField: "nope",
        }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("maps known issueCategory synonyms to canonical values", async () => {
    prisma.communicationContent.findMany.mockResolvedValue([]);
    prisma.customer.upsert.mockResolvedValue({ id: "cust-1" } as never);
    prisma.serviceCategory.findFirst.mockResolvedValue({ id: "svc-1" } as never);
    prisma.propertyAddress.create.mockResolvedValue({ id: "addr-1" } as never);
    prisma.job.create.mockResolvedValue(jobRecord as never);

    await service.createJobFromToolCall({
      tenantId,
      sessionId,
      rawArgs: JSON.stringify({
        customerName: "Alice",
        phone: "1234567890",
        issueCategory: "No heat",
        urgency: "STANDARD",
      }),
    });

    expect(prisma.serviceCategory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: "HEATING",
        }),
      }),
    );
  });

  it("normalizes issueCategory case and whitespace", async () => {
    prisma.communicationContent.findMany.mockResolvedValue([]);
    prisma.customer.upsert.mockResolvedValue({ id: "cust-1" } as never);
    prisma.serviceCategory.findFirst.mockResolvedValue({ id: "svc-1" } as never);
    prisma.propertyAddress.create.mockResolvedValue({ id: "addr-1" } as never);
    prisma.job.create.mockResolvedValue(jobRecord as never);

    await service.createJobFromToolCall({
      tenantId,
      sessionId,
      rawArgs: JSON.stringify({
        customerName: "Alice",
        phone: "1234567890",
        issueCategory: "  aC   not   COOLING ",
        urgency: "STANDARD",
      }),
    });

    expect(prisma.serviceCategory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: "COOLING",
        }),
      }),
    );
  });

  it("accepts a job when payment succeeded", async () => {
    prisma.job.findUnique.mockResolvedValue(jobRecord as never);
    prisma.payment.findFirst.mockResolvedValue({
      status: "SUCCEEDED",
    } as never);
    prisma.job.update.mockResolvedValue({
      ...jobRecord,
      status: "ACCEPTED",
    } as never);

    const result = await service.acceptJobAfterPayment({
      tenantId,
      jobId: jobRecord.id,
      paymentIntentId: "pi_123",
    });

    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACCEPTED" }),
      }),
    );
    expect(result.status).toBe("ACCEPTED");
  });

  it("is idempotent when job is already accepted", async () => {
    prisma.job.findUnique.mockResolvedValue({
      ...jobRecord,
      status: "ACCEPTED",
    } as never);

    const result = await service.acceptJobAfterPayment({
      tenantId,
      jobId: jobRecord.id,
    });

    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
    expect(prisma.job.update).not.toHaveBeenCalled();
    expect(result.status).toBe("ACCEPTED");
  });

  it("rejects acceptance when payment is missing", async () => {
    prisma.job.findUnique.mockResolvedValue(jobRecord as never);
    prisma.payment.findFirst.mockResolvedValue(null as never);

    await expect(
      service.acceptJobAfterPayment({
        tenantId,
        jobId: jobRecord.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it("rejects acceptance when payment has not succeeded", async () => {
    prisma.job.findUnique.mockResolvedValue(jobRecord as never);
    prisma.payment.findFirst.mockResolvedValue({
      status: "FAILED",
    } as never);

    await expect(
      service.acceptJobAfterPayment({
        tenantId,
        jobId: jobRecord.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.job.update).not.toHaveBeenCalled();
  });
});
