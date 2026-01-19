import { randomUUID } from "crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { TenantOrganization } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import {
  CreateTenantInput,
  TenantContext,
  TenantsService,
} from "./interfaces/tenants-service.interface";

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

    return this.mapTenantToContext(tenant);
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
      "Be transparent that every visit includes a $99 diagnostic/service fee which is credited toward repairs if they approve work within 24 hours.",
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

}
