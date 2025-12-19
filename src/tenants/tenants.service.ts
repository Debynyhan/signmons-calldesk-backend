import { randomUUID } from "crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { Tenant } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import {
  CreateTenantInput,
  TenantContext,
  TenantsService,
} from "./interfaces/tenants-service.interface";

@Injectable()
export class PrismaTenantsService implements TenantsService {
  private readonly defaultEmergencySurchargeAmount = 75;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
  ) {}

  async getTenantContext(tenantId: string): Promise<TenantContext> {
    const sanitizedId = this.sanitizationService.sanitizeIdentifier(tenantId);
    if (!sanitizedId) {
      throw new NotFoundException("Tenant not found.");
    }

    const tenant = await this.prisma.tenant.findUnique({
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
    const emergencySurchargeEnabled = Boolean(
      input.emergencySurchargeEnabled,
    );
    const emergencySurchargeAmount = this.normalizeSurchargeAmount(
      input.emergencySurchargeAmount,
    );

    if (!name) {
      throw new Error("Tenant name must include alphanumeric characters.");
    }

    const prompt = this.buildPrompt(
      tenantId,
      displayName,
      instructions,
      emergencySurchargeEnabled,
      emergencySurchargeAmount,
    );

    const tenant = await this.prisma.tenant.create({
      data: {
        id: tenantId,
        name,
        displayName,
        instructions,
        prompt,
        emergencySurchargeEnabled,
        emergencySurchargeAmount,
      },
    });

    return this.mapTenantToContext(tenant);
  }

  private mapTenantToContext(tenant: Tenant): TenantContext {
    return {
      tenantId: tenant.id,
      displayName: tenant.displayName,
      instructions: tenant.instructions ?? "",
      prompt: tenant.prompt,
      emergencySurchargeEnabled: tenant.emergencySurchargeEnabled,
      emergencySurchargeAmount: tenant.emergencySurchargeAmount,
    };
  }

  private buildPrompt(
    tenantId: string,
    displayName: string,
    instructions: string,
    emergencySurchargeEnabled: boolean,
    emergencySurchargeAmount: number,
  ) {
    const persona = [
      `You are handling calls for tenantId=${tenantId} (${displayName}).`,
      'Always greet callers warmly, introduce yourself as their dispatcher, and speak as part of the tenant\'s team (use "we" / "our").',
      "Act on the tenant's behalf end-to-end: gather details, reassure them, and upsell maintenance plans or priority service whenever it helps.",
      "Be transparent that every visit includes a $99 diagnostic/service fee which is credited toward repairs if they approve work within 24 hours.",
      emergencySurchargeEnabled
        ? `For emergency calls, disclose an additional $${emergencySurchargeAmount} emergency surcharge before booking and include it in the fee confirmation.`
        : null,
      "Summarize the plan and next steps before closing every interaction.",
    ]
      .filter(Boolean)
      .join(" ");

    const trimmedInstructions = instructions?.trim();
    return trimmedInstructions ? `${persona} ${trimmedInstructions}` : persona;
  }

  private normalizeSurchargeAmount(value?: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return this.defaultEmergencySurchargeAmount;
    }
    return Math.max(0, Math.round(value));
  }
}
