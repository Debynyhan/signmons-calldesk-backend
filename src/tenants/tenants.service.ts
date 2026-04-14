import { randomUUID } from "crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { TenantFeePolicy, TenantOrganization, TenantSubscription } from "@prisma/client";
import { SubscriptionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { TenantPromptBuilderService } from "./tenant-prompt-builder.service";
import { TenantFeePolicySynchronizerService } from "./tenant-fee-policy-synchronizer.service";
import {
  CreateTenantInput,
  TenantContext,
  TenantsService,
  TenantFeeSettingsUpdate,
} from "./interfaces/tenants-service.interface";

@Injectable()
export class PrismaTenantsService implements TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
    private readonly promptBuilder: TenantPromptBuilderService,
    private readonly feePolicySynchronizer: TenantFeePolicySynchronizerService,
  ) {}

  async getTenantContext(tenantId: string): Promise<TenantContext> {
    const sanitizedId = this.sanitizationService.sanitizeIdentifier(tenantId);
    if (!sanitizedId) {
      throw new NotFoundException("Tenant not found.");
    }

    const tenant = await this.prisma.tenantOrganization.findUnique({
      where: { id: sanitizedId },
    });

    if (!tenant) {
      throw new NotFoundException("Tenant not found.");
    }

    return this.mapTenantToContext(tenant);
  }

  async createTenant(input: CreateTenantInput): Promise<TenantContext> {
    const tenantId = randomUUID();
    const name = this.sanitizationService.sanitizeIdentifier(input.name);
    const displayName = this.sanitizationService.sanitizeText(
      input.displayName,
    );
    const instructions = this.sanitizationService.sanitizeText(
      input.instructions,
    );

    if (!name) {
      throw new Error("Tenant name must include alphanumeric characters.");
    }

    const prompt = this.promptBuilder.buildPrompt(tenantId, displayName, instructions);

    const tenant = await this.prisma.tenantOrganization.create({
      data: {
        id: tenantId,
        name,
        timezone: "UTC",
        settings: {
          displayName,
          instructions,
          prompt,
        },
        updatedAt: new Date(),
      },
    });

    await this.syncTenantFeePolicy(tenant.id);

    return this.mapTenantToContext(tenant);
  }

  async getTenantById(tenantId: string): Promise<TenantOrganization | null> {
    const sanitizedId = this.sanitizationService.sanitizeIdentifier(tenantId);
    if (!sanitizedId) {
      return null;
    }

    return this.prisma.tenantOrganization.findUnique({
      where: { id: sanitizedId },
    });
  }

  async resolveTenantByPhone(
    toNumber: string,
  ): Promise<TenantOrganization | null> {
    const normalized = this.sanitizationService.normalizePhoneE164(toNumber);
    if (!normalized) {
      return null;
    }

    return this.prisma.tenantOrganization.findFirst({
      where: { voiceNumber: normalized },
    });
  }

  async getTenantFeePolicy(
    tenantId: string,
  ): Promise<TenantFeePolicy | null> {
    const sanitizedId = this.sanitizationService.sanitizeIdentifier(tenantId);
    if (!sanitizedId) {
      return null;
    }

    return this.prisma.tenantFeePolicy.findFirst({
      where: {
        tenantId: sanitizedId,
        isActive: true,
        effectiveAt: { lte: new Date() },
      },
      orderBy: { effectiveAt: "desc" },
    });
  }

  async syncTenantFeePolicy(
    tenantId: string,
  ): Promise<TenantFeePolicy | null> {
    return this.feePolicySynchronizer.sync(tenantId);
  }

  async updateTenantFeeSettings(
    tenantId: string,
    updates: TenantFeeSettingsUpdate,
  ): Promise<TenantFeePolicy | null> {
    return this.feePolicySynchronizer.updateSettings(tenantId, updates);
  }

  async getActiveTenantSubscription(
    tenantId: string,
  ): Promise<TenantSubscription | null> {
    const sanitizedId = this.sanitizationService.sanitizeIdentifier(tenantId);
    if (!sanitizedId) {
      return null;
    }
    return this.prisma.tenantSubscription.findFirst({
      where: {
        tenantId: sanitizedId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        currentPeriodEnd: { gt: new Date() },
      },
    });
  }

  private mapTenantToContext(tenant: TenantOrganization): TenantContext {
    const settings = this.parseSettings(tenant.settings);
    const displayName = settings.displayName ?? tenant.name;
    const instructions = settings.instructions ?? "";
    const prompt =
      settings.prompt ?? this.promptBuilder.buildPrompt(tenant.id, displayName, instructions);
    return {
      tenantId: tenant.id,
      displayName,
      instructions,
      prompt,
    };
  }

  private parseSettings(value: unknown): {
    displayName?: string;
    instructions?: string;
    prompt?: string;
  } {
    if (!value || typeof value !== "object") {
      return {};
    }

    const settings = value as Record<string, unknown>;
    return {
      displayName:
        typeof settings.displayName === "string"
          ? settings.displayName
          : undefined,
      instructions:
        typeof settings.instructions === "string"
          ? settings.instructions
          : undefined,
      prompt:
        typeof settings.prompt === "string" ? settings.prompt : undefined,
    };
  }


}
