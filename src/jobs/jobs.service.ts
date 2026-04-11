import { randomUUID } from "crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { JobStatus, PaymentStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { CreateJobPayloadValidatorService } from "./create-job-payload-validator.service";
import {
  CreateJobFromToolCallRequest,
  IJobRepository,
  JobRecord,
} from "./interfaces/job-repository.interface";

@Injectable()
export class JobsService implements IJobRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
    private readonly payloadValidator: CreateJobPayloadValidatorService,
  ) {}

  async createJobFromToolCall(
    request: CreateJobFromToolCallRequest,
  ): Promise<JobRecord> {
    const tenantId = this.sanitizeTenantId(request.tenantId);
    const existingJob = await this.findExistingJobForSession(
      tenantId,
      request.sessionId,
    );
    if (existingJob) {
      return this.mapJob(existingJob);
    }
    const {
      payload: normalizedPayload,
      mappedUrgency,
      mappedPreferredWindow,
    } = this.payloadValidator.parseAndNormalize(request.rawArgs);

    const customer = await this.prisma.customer.upsert({
      where: {
        tenantId_phone: {
          tenantId,
          phone: normalizedPayload.phone,
        },
      },
      update: {
        fullName: normalizedPayload.customerName,
        updatedAt: new Date(),
      },
      create: {
        id: randomUUID(),
        tenantId,
        phone: normalizedPayload.phone,
        fullName: normalizedPayload.customerName,
        updatedAt: new Date(),
      },
    });

    const serviceCategory = await this.findOrCreateServiceCategory(
      tenantId,
      normalizedPayload.issueCategory,
    );

    const propertyAddress = await this.prisma.propertyAddress.create({
      data: {
        id: randomUUID(),
        tenantId,
        customerId: customer.id,
        customerTenantId: tenantId,
        googlePlaceId: randomUUID(),
        formattedAddress: normalizedPayload.address ?? "Unknown address",
        addressComponents: {},
        latitude: 0,
        longitude: 0,
        updatedAt: new Date(),
      },
    });

    const job = await this.prisma.job.create({
      data: {
        id: randomUUID(),
        tenantId,
        customerId: customer.id,
        customerTenantId: tenantId,
        propertyAddressId: propertyAddress.id,
        propertyAddressTenantId: tenantId,
        serviceCategoryId: serviceCategory.id,
        serviceCategoryTenantId: tenantId,
        status: JobStatus.CREATED,
        urgency: mappedUrgency,
        description: normalizedPayload.description ?? null,
        preferredWindowLabel: mappedPreferredWindow ?? null,
        pricingSnapshot: {},
        policySnapshot: {},
      },
      include: {
        customer: true,
        propertyAddress: true,
        serviceCategory: true,
      },
    });

    return this.mapJob(job);
  }

  async listJobs(tenantId: string): Promise<JobRecord[]> {
    const sanitizedTenantId = this.sanitizeTenantId(tenantId);
    const jobs = await this.prisma.job.findMany({
      where: { tenantId: sanitizedTenantId },
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        propertyAddress: true,
        serviceCategory: true,
      },
    });
    return jobs.map((job) => this.mapJob(job));
  }

  async acceptJobAfterPayment(request: {
    tenantId: string;
    jobId: string;
    paymentIntentId?: string;
  }): Promise<JobRecord> {
    const tenantId = this.sanitizeTenantId(request.tenantId);
    const jobId = this.sanitizeJobId(request.jobId);
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        customer: true,
        propertyAddress: true,
        serviceCategory: true,
      },
    });

    if (!job || job.tenantId !== tenantId) {
      throw new BadRequestException("Job not found.");
    }

    if (job.status === JobStatus.ACCEPTED) {
      return this.mapJob(job);
    }

    const payment = await this.prisma.payment.findFirst({
      where: {
        tenantId,
        jobId,
        ...(request.paymentIntentId
          ? { stripePaymentIntentId: request.paymentIntentId }
          : {}),
      },
    });

    if (!payment) {
      throw new BadRequestException("Payment not found for job.");
    }

    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new BadRequestException("Payment has not succeeded.");
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.ACCEPTED,
        updatedAt: new Date(),
      },
      include: {
        customer: true,
        propertyAddress: true,
        serviceCategory: true,
      },
    });

    return this.mapJob(updated);
  }

  private sanitizeTenantId(tenantId: string): string {
    const sanitized = this.sanitizationService.sanitizeIdentifier(tenantId);
    if (!sanitized) {
      throw new BadRequestException("Invalid tenant identifier.");
    }
    return sanitized;
  }

  private sanitizeJobId(jobId: string): string {
    const sanitized = this.sanitizationService.sanitizeIdentifier(jobId);
    if (!sanitized) {
      throw new BadRequestException("Invalid job identifier.");
    }
    return sanitized;
  }

  private mapJob(
    job: Prisma.JobGetPayload<{
      include: {
        customer: true;
        propertyAddress: true;
        serviceCategory: true;
      };
    }>,
  ): JobRecord {
    return {
      id: job.id,
      tenantId: job.tenantId,
      customerName: job.customer.fullName,
      phone: job.customer.phone,
      address: job.propertyAddress.formattedAddress,
      issueCategory: job.serviceCategory.name,
      urgency: job.urgency,
      description: job.description ?? undefined,
      preferredTime: job.preferredWindowLabel ?? undefined,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  private async findExistingJobForSession(
    tenantId: string,
    sessionId: string,
  ): Promise<
    Prisma.JobGetPayload<{
      include: {
        customer: true;
        propertyAddress: true;
        serviceCategory: true;
      };
    }> | null
  > {
    const logs = await this.prisma.communicationContent.findMany({
      where: {
        tenantId,
        payload: {
          path: ["sessionId"],
          equals: sessionId,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { payload: true },
    });

    const jobId = logs
      .map((log) => this.extractJobId(log.payload))
      .find((value): value is string => Boolean(value));

    if (!jobId) {
      return null;
    }

    return this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        customer: true,
        propertyAddress: true,
        serviceCategory: true,
      },
    });
  }

  private extractJobId(payload: Prisma.JsonValue): string | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const record = payload as Record<string, unknown>;
    return typeof record.jobId === "string" ? record.jobId : null;
  }

  private async findOrCreateServiceCategory(
    tenantId: string,
    name: string,
  ) {
    const existing = await this.prisma.serviceCategory.findFirst({
      where: {
        tenantId,
        name,
      },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.serviceCategory.create({
      data: {
        id: randomUUID(),
        tenantId,
        name,
        updatedAt: new Date(),
      },
    });
  }

}
