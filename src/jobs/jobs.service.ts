import { BadRequestException, Injectable } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { Job as PrismaJob } from "@prisma/client";
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
    const payload = this.parsePayload(request.rawArgs);
    const sanitizedPayload = this.sanitizePayload(payload);

    const job = await this.prisma.job.create({
      data: {
        tenantId,
        customerName: sanitizedPayload.customerName,
        phone: sanitizedPayload.phone,
        address: sanitizedPayload.address,
        issueCategory: sanitizedPayload.issueCategory,
        urgency: sanitizedPayload.urgency,
        description: sanitizedPayload.description,
        preferredTime: sanitizedPayload.preferredTime,
      },
    });

    return this.mapJob(job);
  }

  async listJobs(tenantId: string): Promise<JobRecord[]> {
    const sanitizedTenantId = this.sanitizeTenantId(tenantId);
    const jobs = await this.prisma.job.findMany({
      where: { tenantId: sanitizedTenantId },
      orderBy: { createdAt: "desc" },
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

  private mapJob(job: PrismaJob): JobRecord {
    return {
      id: job.id,
      tenantId: job.tenantId,
      customerName: job.customerName,
      phone: job.phone,
      address: job.address ?? undefined,
      issueCategory: job.issueCategory,
      urgency: job.urgency,
      description: job.description ?? undefined,
      preferredTime: job.preferredTime ?? undefined,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
