import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, TenantFeePolicy } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { DEFAULT_FEE_POLICY, normalizeFeePolicyFromSettings } from "./fee-policy";
import { TenantFeeSettingsUpdate } from "./interfaces/tenants-service.interface";

@Injectable()
export class TenantFeePolicySynchronizerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
  ) {}

  async sync(tenantId: string): Promise<TenantFeePolicy | null> {
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

  async updateSettings(
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

    return this.sync(sanitizedId);
  }

  private isJsonObject(
    value: Prisma.JsonValue | undefined,
  ): value is Prisma.JsonObject {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }
}
