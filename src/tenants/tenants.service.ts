import { randomUUID } from "crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, TenantFeePolicy, TenantOrganization } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import {
  CreateTenantInput,
  TenantContext,
  TenantsService,
  TenantFeeSettingsUpdate,
} from "./interfaces/tenants-service.interface";
import {
  DEFAULT_FEE_POLICY,
  normalizeFeePolicyFromSettings,
} from "./fee-policy";

@Injectable()
export class PrismaTenantsService implements TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
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

    const prompt = this.buildPrompt(tenantId, displayName, instructions);

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

    const normalized = normalizeFeePolicyFromSettings(
      tenant.settings,
      DEFAULT_FEE_POLICY,
    );

    const existing = await this.prisma.tenantFeePolicy.findFirst({
      where: {
        tenantId: sanitizedId,
        isActive: true,
        effectiveAt: { lte: new Date() },
      },
      orderBy: { effectiveAt: "desc" },
    });

    if (
      existing &&
      existing.serviceFeeCents === normalized.serviceFeeCents &&
      existing.emergencyFeeCents === normalized.emergencyFeeCents &&
      existing.creditWindowHours === normalized.creditWindowHours &&
      existing.currency === normalized.currency
    ) {
      return existing;
    }

    const results = await this.prisma.$transaction([
      this.prisma.tenantFeePolicy.updateMany({
        where: { tenantId: sanitizedId, isActive: true },
        data: { isActive: false },
      }),
      this.prisma.tenantFeePolicy.create({
        data: {
          tenantId: sanitizedId,
          serviceFeeCents: normalized.serviceFeeCents,
          emergencyFeeCents: normalized.emergencyFeeCents,
          creditWindowHours: normalized.creditWindowHours,
          currency: normalized.currency,
          effectiveAt: new Date(),
          isActive: true,
        },
      }),
    ]);

    const created = results[1] as TenantFeePolicy | undefined;
    return created ?? null;
  }

  async updateTenantFeeSettings(
    tenantId: string,
    updates: TenantFeeSettingsUpdate,
  ): Promise<TenantFeePolicy | null> {
    const sanitizedId = this.sanitizationService.sanitizeIdentifier(tenantId);
    if (!sanitizedId) {
      throw new NotFoundException("Tenant not found.");
    }

    const tenant = await this.prisma.tenantOrganization.findUnique({
      where: { id: sanitizedId },
      select: { id: true, settings: true },
    });

    if (!tenant) {
      throw new NotFoundException("Tenant not found.");
    }

    const feeUpdates: Prisma.JsonObject = {};
    if (typeof updates.serviceFeeCents === "number") {
      feeUpdates.serviceFeeCents = Math.max(0, Math.round(updates.serviceFeeCents));
    }
    if (typeof updates.emergencyFeeCents === "number") {
      feeUpdates.emergencyFeeCents = Math.max(
        0,
        Math.round(updates.emergencyFeeCents),
      );
    }
    if (typeof updates.creditWindowHours === "number") {
      feeUpdates.creditWindowHours = Math.max(
        1,
        Math.round(updates.creditWindowHours),
      );
    }
    if (typeof updates.currency === "string" && updates.currency.trim()) {
      feeUpdates.currency = updates.currency.trim().toUpperCase();
    }

    if (Object.keys(feeUpdates).length === 0) {
      throw new BadRequestException("No fee settings provided.");
    }

    const baseSettings: Prisma.JsonObject = this.isJsonObject(tenant.settings)
      ? tenant.settings
      : {};
    const baseFees: Prisma.JsonObject = this.isJsonObject(baseSettings.fees)
      ? baseSettings.fees
      : {};

    const nextSettings: Prisma.InputJsonValue = {
      ...baseSettings,
      fees: { ...baseFees, ...feeUpdates },
    };

    await this.prisma.tenantOrganization.update({
      where: { id: sanitizedId },
      data: { settings: nextSettings },
    });

    return this.syncTenantFeePolicy(sanitizedId);
  }

  private mapTenantToContext(tenant: TenantOrganization): TenantContext {
    const settings = this.parseSettings(tenant.settings);
    const displayName = settings.displayName ?? tenant.name;
    const instructions = settings.instructions ?? "";
    const prompt =
      settings.prompt ?? this.buildPrompt(tenant.id, displayName, instructions);
    return {
      tenantId: tenant.id,
      displayName,
      instructions,
      prompt,
    };
  }

  private buildPrompt(
    tenantId: string,
    displayName: string,
    instructions: string,
  ) {
    const persona = [
      `You are handling calls for tenantId=${tenantId} (${displayName}).`,
      'Always greet callers warmly, introduce yourself as their dispatcher, and speak as part of the tenant\'s team (use "we" / "our").',
      "Act on the tenant's behalf end-to-end: gather details, reassure them, and upsell maintenance plans or priority service whenever it helps.",
      "Be transparent that every visit includes a service fee that is credited toward repairs if they approve work within 24 hours.",
      "Summarize the plan and next steps before closing every interaction.",
    ].join(" ");

    const trimmedInstructions = instructions?.trim();
    return trimmedInstructions ? `${persona} ${trimmedInstructions}` : persona;
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

  private isJsonObject(
    value: Prisma.JsonValue | undefined,
  ): value is Prisma.JsonObject {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

}
