import { randomUUID } from "crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { TenantOrganization } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import {
  CreateTenantInput,
  TenantContext,
  TenantSettings,
  TenantsService,
} from "./interfaces/tenants-service.interface";

@Injectable()
export class PrismaTenantsService implements TenantsService {
  private readonly defaultTimezone = "UTC";
  private readonly diagnosticFeeCents = 9900;
  private readonly emergencySurchargeAmountCents = 7500;

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
      input.displayName ?? "",
    );
    const instructions = this.sanitizationService.sanitizeText(
      input.instructions ?? "",
    );
    const timezone =
      this.sanitizationService.sanitizeText(input.timezone ?? "") ||
      this.defaultTimezone;

    if (!name) {
      throw new Error("Tenant name must include alphanumeric characters.");
    }

    const settings = this.normalizeSettings({
      ...input.settings,
      displayName: displayName || input.settings?.displayName,
      instructions: instructions || input.settings?.instructions,
      slug: name,
    });
    const prompt = this.buildPrompt(tenantId, name, settings);
    const settingsWithPrompt: TenantSettings = { ...settings, prompt };

    const tenant = await this.prisma.tenantOrganization.create({
      data: {
        id: tenantId,
        name: displayName || name,
        timezone,
        settings: this.toJson(settingsWithPrompt),
      },
    });

    return this.mapTenantToContext(tenant);
  }

  private mapTenantToContext(tenant: TenantOrganization): TenantContext {
    const settings = this.normalizeSettings(tenant.settings);
    const prompt =
      settings.prompt ?? this.buildPrompt(tenant.id, tenant.name, settings);
    return {
      tenantId: tenant.id,
      name: tenant.name,
      timezone: tenant.timezone,
      settings,
      prompt,
    };
  }

  private buildPrompt(
    tenantId: string,
    tenantName: string,
    settings: TenantSettings,
  ) {
    const displayName = settings.displayName?.trim() || tenantName;
    const diagnosticFee = this.formatCents(
      settings.diagnosticFeeCents ?? this.diagnosticFeeCents,
    );
    const emergencyEnabled = Boolean(settings.emergencySurchargeEnabled);
    const emergencyFee = this.formatCents(
      settings.emergencySurchargeAmountCents ??
        this.emergencySurchargeAmountCents,
    );
    const persona = [
      `You are handling calls for tenantId=${tenantId} (${displayName}).`,
      'Always greet callers warmly, introduce yourself as their dispatcher, and speak as part of the tenant\'s team (use "we" / "our").',
      "Act on the tenant's behalf end-to-end: gather details, reassure them, and upsell maintenance plans or priority service whenever it helps.",
      `Be transparent that every visit includes a $${diagnosticFee} diagnostic/service fee which is credited toward repairs if they approve work within 24 hours.`,
      emergencyEnabled
        ? `For emergency calls, disclose an additional $${emergencyFee} emergency surcharge before booking and include it in the fee confirmation.`
        : null,
      "Summarize the plan and next steps before closing every interaction.",
    ]
      .filter(Boolean)
      .join(" ");

    const trimmedInstructions = settings.instructions?.trim();
    return trimmedInstructions ? `${persona} ${trimmedInstructions}` : persona;
  }

  private normalizeSettings(input: unknown): TenantSettings {
    if (!input || typeof input !== "object") {
      return {};
    }
    const settings = input as TenantSettings;
    return {
      displayName: settings.displayName,
      instructions: settings.instructions,
      diagnosticFeeCents: this.normalizeCents(settings.diagnosticFeeCents),
      emergencySurchargeEnabled: settings.emergencySurchargeEnabled,
      emergencySurchargeAmountCents: this.normalizeCents(
        settings.emergencySurchargeAmountCents,
      ),
      slug: settings.slug,
      prompt: settings.prompt,
    };
  }

  private toJson(value: TenantSettings): Prisma.InputJsonValue {
    const payload: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        payload[key] = entry as Prisma.InputJsonValue;
      }
    }
    return payload;
  }

  private normalizeCents(value?: number): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }
    return Math.max(0, Math.round(value));
  }

  private formatCents(cents: number): string {
    return (cents / 100).toFixed(0);
  }
}
