import { randomUUID } from "crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { Prisma } from "@prisma/client";
import { JobStatus, JobUrgency, PreferredWindowLabel } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { CreateJobPayloadDto } from "./dto/create-job-payload.dto";
import {
  CreateJobFromToolCallRequest,
  CreateJobPayload,
  IJobRepository,
  JobRecord,
} from "./interfaces/job-repository.interface";

@Injectable()
export class JobsService implements IJobRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
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
    const payload = this.parsePayload(request.rawArgs);
    const sanitizedPayload = this.sanitizePayload(payload);

    const customer = await this.prisma.customer.upsert({
      where: {
        tenantId_phone: {
          tenantId,
          phone: sanitizedPayload.phone,
        },
      },
      update: {
        fullName: sanitizedPayload.customerName,
        updatedAt: new Date(),
      },
      create: {
        id: randomUUID(),
        tenantId,
        phone: sanitizedPayload.phone,
        fullName: sanitizedPayload.customerName,
        updatedAt: new Date(),
      },
    });

    const serviceCategory = await this.findOrCreateServiceCategory(
      tenantId,
      sanitizedPayload.issueCategory,
    );

    const propertyAddress = await this.prisma.propertyAddress.create({
      data: {
        id: randomUUID(),
        tenantId,
        customerId: customer.id,
        customerTenantId: tenantId,
        googlePlaceId: randomUUID(),
        formattedAddress: sanitizedPayload.address ?? "Unknown address",
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
        urgency: this.mapUrgency(sanitizedPayload.urgency),
        description: sanitizedPayload.description ?? null,
        preferredWindowLabel: this.mapPreferredWindow(
          sanitizedPayload.preferredTime,
        ),
        pricingSnapshot: {},
        policySnapshot: {},
      },
      include: {
        Customer: true,
        PropertyAddress: true,
        ServiceCategory: true,
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
        Customer: true,
        PropertyAddress: true,
        ServiceCategory: true,
      },
    });
    return jobs.map((job) => this.mapJob(job));
  }

  private parsePayload(rawArgs?: string): CreateJobPayload {
    let args: unknown;
    try {
      args = rawArgs ? JSON.parse(rawArgs) : null;
    } catch {
      throw new BadRequestException("Invalid job creation payload.");
    }

    if (!args) {
      throw new BadRequestException("Job payload missing.");
    }

    const dto = plainToInstance(CreateJobPayloadDto, args);
    const errors = validateSync(dto, { whitelist: true });
    if (errors.length) {
      throw new BadRequestException("Job payload validation failed.");
    }

    return dto;
  }

  private sanitizeTenantId(tenantId: string): string {
    const sanitized = this.sanitizationService.sanitizeIdentifier(tenantId);
    if (!sanitized) {
      throw new BadRequestException("Invalid tenant identifier.");
    }
    return sanitized;
  }

  private sanitizePayload(payload: CreateJobPayload): CreateJobPayload {
    return {
      ...payload,
      customerName: this.sanitizationService.sanitizeText(payload.customerName),
      phone: this.sanitizationService.normalizeWhitespace(payload.phone),
      address: payload.address
        ? this.sanitizationService.sanitizeText(payload.address)
        : undefined,
      description: payload.description
        ? this.sanitizationService.sanitizeText(payload.description)
        : undefined,
      preferredTime: payload.preferredTime
        ? this.sanitizationService.normalizeWhitespace(payload.preferredTime)
        : undefined,
    };
  }

  private mapJob(
    job: Prisma.JobGetPayload<{
      include: {
        Customer: true;
        PropertyAddress: true;
        ServiceCategory: true;
      };
    }>,
  ): JobRecord {
    return {
      id: job.id,
      tenantId: job.tenantId,
      customerName: job.Customer.fullName,
      phone: job.Customer.phone,
      address: job.PropertyAddress.formattedAddress,
      issueCategory: job.ServiceCategory.name,
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
        Customer: true;
        PropertyAddress: true;
        ServiceCategory: true;
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
        Customer: true,
        PropertyAddress: true,
        ServiceCategory: true,
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

  private mapUrgency(value: string): JobUrgency {
    return value === "EMERGENCY" ? JobUrgency.EMERGENCY : JobUrgency.STANDARD;
  }

  private mapPreferredWindow(
    value?: string,
  ): PreferredWindowLabel | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value.trim().toUpperCase();
    if (normalized in PreferredWindowLabel) {
      return PreferredWindowLabel[normalized as keyof typeof PreferredWindowLabel];
    }
    return undefined;
  }
}
