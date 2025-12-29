import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type {
  Customer,
  Job as PrismaJob,
  JobUrgency,
  PreferredWindowLabel,
  PropertyAddress,
  ServiceCategory,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { CreateJobPayloadDto } from "./dto/create-job-payload.dto";
import {
  CreateJobFromToolCallRequest,
  CreateJobPayload,
  IJobRepository,
  JobRecord,
} from "./interfaces/job-repository.interface";

const DEFAULT_BASE_PRICE_CENTS = 0;
const DEFAULT_EMERGENCY_SURCHARGE_CENTS = 0;
const DEFAULT_DURATION_MINUTES = 60;

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
    const urgency = this.normalizeUrgency(sanitizedPayload.urgency);
    const categoryName = this.normalizeIssueCategory(
      sanitizedPayload.issueCategory,
    );

    const customer = await this.getOrCreateCustomer(
      tenantId,
      sanitizedPayload.customerName,
      sanitizedPayload.phone,
    );
    const propertyAddress = await this.getOrCreatePropertyAddress(
      tenantId,
      customer,
      sanitizedPayload.address,
      request.sessionId,
    );
    const serviceCategory = await this.getOrCreateServiceCategory(
      tenantId,
      categoryName,
    );
    const preferredWindowLabel = this.toPreferredWindowLabel(
      sanitizedPayload.preferredTime,
    );

    const pricingSnapshot: Prisma.InputJsonValue = {
      basePriceCents: serviceCategory.basePriceCents,
      emergencySurchargeCents: serviceCategory.emergencySurchargeCents,
      estimatedDurationMinutes: serviceCategory.estimatedDurationMinutes,
    };
    const policySnapshot: Prisma.InputJsonValue = {
      preferredWindowLabel: preferredWindowLabel ?? null,
      preferredTime: sanitizedPayload.preferredTime ?? null,
    };

    const job = await this.prisma.job.create({
      data: {
        tenantId,
        customerId: customer.id,
        customerTenantId: tenantId,
        propertyAddressId: propertyAddress.id,
        propertyAddressTenantId: tenantId,
        serviceCategoryId: serviceCategory.id,
        serviceCategoryTenantId: tenantId,
        status: "CREATED",
        urgency,
        description: sanitizedPayload.description,
        pricingSnapshot,
        policySnapshot,
        preferredWindowLabel,
      },
    });

    await this.updateConversationCustomer(
      tenantId,
      request.sessionId,
      customer,
    );

    return this.mapJob(job, customer, serviceCategory, sanitizedPayload);
  }

  async listJobs(tenantId: string): Promise<JobRecord[]> {
    const sanitizedTenantId = this.sanitizeTenantId(tenantId);
    const jobs = await this.prisma.job.findMany({
      where: { tenantId: sanitizedTenantId },
      orderBy: { createdAt: "desc" },
    });
    const related = await this.prisma.customer.findMany({
      where: { tenantId: sanitizedTenantId },
      select: { id: true, fullName: true },
    });
    const customers = new Map(related.map((item) => [item.id, item.fullName]));
    const categories = await this.prisma.serviceCategory.findMany({
      where: { tenantId: sanitizedTenantId },
      select: { id: true, name: true },
    });
    const serviceCategories = new Map(
      categories.map((item) => [item.id, item.name]),
    );
    return jobs.map((job) =>
      this.mapJob(
        job,
        {
          id: job.customerId,
          fullName: customers.get(job.customerId) ?? "",
        },
        {
          id: job.serviceCategoryId,
          name: serviceCategories.get(job.serviceCategoryId) ?? "GENERAL",
        },
      ),
    );
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

  private async updateConversationCustomer(
    tenantId: string,
    sessionId: string,
    customer: Customer,
  ): Promise<void> {
    await this.prisma.conversation.updateMany({
      where: {
        tenantId,
        providerConversationId: sessionId,
      },
      data: {
        customerId: customer.id,
        customerTenantId: tenantId,
      },
    });
  }

  private async getOrCreateCustomer(
    tenantId: string,
    fullName: string,
    phone: string,
  ): Promise<Customer> {
    return this.prisma.customer.upsert({
      where: {
        tenantId_phone: {
          tenantId,
          phone,
        },
      },
      update: {
        fullName,
      },
      create: {
        tenantId,
        phone,
        fullName,
        consentToText: false,
        marketingOptIn: false,
      },
    });
  }

  private async getOrCreateServiceCategory(
    tenantId: string,
    name: string,
  ): Promise<ServiceCategory> {
    const existing = await this.prisma.serviceCategory.findFirst({
      where: { tenantId, name },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.serviceCategory.create({
      data: {
        tenantId,
        name,
        basePriceCents: DEFAULT_BASE_PRICE_CENTS,
        emergencySurchargeCents: DEFAULT_EMERGENCY_SURCHARGE_CENTS,
        estimatedDurationMinutes: DEFAULT_DURATION_MINUTES,
      },
    });
  }

  private async getOrCreatePropertyAddress(
    tenantId: string,
    customer: Customer,
    address: string | undefined,
    sessionId: string,
  ): Promise<PropertyAddress> {
    const addressKey =
      address && address.trim().length
        ? this.sanitizationService.normalizeWhitespace(address)
        : `unknown-${sessionId}`;
    const googlePlaceId = this.hashAddress(addressKey);
    const formattedAddress =
      address && address.trim().length ? addressKey : "Unknown address";

    return this.prisma.propertyAddress.upsert({
      where: {
        tenantId_googlePlaceId: {
          tenantId,
          googlePlaceId,
        },
      },
      update: {
        formattedAddress,
        customerId: customer.id,
        customerTenantId: tenantId,
      },
      create: {
        tenantId,
        customerId: customer.id,
        customerTenantId: tenantId,
        googlePlaceId,
        formattedAddress,
        addressComponents: { raw: addressKey },
        latitude: 0,
        longitude: 0,
      },
    });
  }

  private normalizeIssueCategory(value: string): string {
    const trimmed = value.trim();
    return trimmed.length ? trimmed.toUpperCase() : "GENERAL";
  }

  private normalizeUrgency(value: string): JobUrgency {
    return value.toUpperCase() === "EMERGENCY" ? "EMERGENCY" : "STANDARD";
  }

  private toPreferredWindowLabel(
    value?: string,
  ): PreferredWindowLabel | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value.trim().toUpperCase();
    const labels: PreferredWindowLabel[] = [
      "ASAP",
      "MORNING",
      "AFTERNOON",
      "EVENING",
    ];
    return labels.includes(normalized as PreferredWindowLabel)
      ? (normalized as PreferredWindowLabel)
      : undefined;
  }

  private hashAddress(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 32);
  }

  private mapJob(
    job: PrismaJob,
    customer: Pick<Customer, "id" | "fullName">,
    serviceCategory: Pick<ServiceCategory, "id" | "name">,
    payload?: CreateJobPayload,
  ): JobRecord {
    return {
      id: job.id,
      tenantId: job.tenantId,
      customerId: customer.id,
      customerName: customer.fullName,
      serviceCategoryId: serviceCategory.id,
      issueCategory: serviceCategory.name,
      urgency: job.urgency,
      description: job.description ?? undefined,
      preferredTime:
        payload?.preferredTime ??
        (job.preferredWindowLabel
          ? job.preferredWindowLabel.toString()
          : undefined),
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
