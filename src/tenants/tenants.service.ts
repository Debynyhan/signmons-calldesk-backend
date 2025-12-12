import { randomUUID } from "crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Tenant } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { ConfigType } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import {
  CreateTenantInput,
  TenantContext,
  TenantsService,
} from "./interfaces/tenants-service.interface";
import appConfig from "../config/app.config";

@Injectable()
export class PrismaTenantsService implements TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
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

    if (!name) {
      throw new Error("Tenant name must include alphanumeric characters.");
    }

    const prompt = this.buildPrompt(tenantId, displayName, instructions);
    const requestedTools = this.sanitizeAllowedTools(input.allowedTools);
    const storedAllowedTools =
      requestedTools.length > 0 ? requestedTools : Prisma.JsonNull;

    const tenant = await this.prisma.tenant.create({
      data: {
        id: tenantId,
        name,
        displayName,
        instructions,
        prompt,
        allowedTools: storedAllowedTools,
      },
    });

    return this.mapTenantToContext(tenant);
  }

  private mapTenantToContext(tenant: Tenant): TenantContext {
    const storedAllowedTools = this.normalizeStoredAllowedTools(
      tenant.allowedTools,
    );
    const allowedTools =
      storedAllowedTools.length > 0
        ? storedAllowedTools
        : this.getDefaultTools();

    return {
      tenantId: tenant.id,
      displayName: tenant.displayName,
      instructions: tenant.instructions ?? "",
      prompt: tenant.prompt,
      allowedTools,
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
      "Before wrapping up, explicitly confirm the caller agrees to the $99 diagnostic/service fee so a technician can be dispatched.",
    ].join(" ");

    const trimmedInstructions = instructions?.trim();
    return trimmedInstructions ? `${persona} ${trimmedInstructions}` : persona;
  }

  private normalizeStoredAllowedTools(
    value: Prisma.JsonValue | undefined,
  ): string[] {
    if (!value || !Array.isArray(value)) {
      return [];
    }
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  private sanitizeAllowedTools(tools?: string[] | null): string[] {
    if (!Array.isArray(tools)) {
      return [];
    }

    const defaultMap = this.getDefaultToolMap();
    const unique = new Set<string>();

    for (const tool of tools) {
      if (typeof tool !== "string") {
        continue;
      }
      const sanitized = this.sanitizationService.sanitizeIdentifier(tool);
      if (!sanitized) {
        continue;
      }
      const canonical = defaultMap.get(sanitized.toLowerCase());
      if (canonical) {
        unique.add(canonical);
      }
    }

    return Array.from(unique);
  }

  private getDefaultTools(): string[] {
    return (this.config.enabledTools ?? [])
      .map((tool) => tool.trim())
      .filter(Boolean);
  }

  private getDefaultToolMap(): Map<string, string> {
    return new Map(
      this.getDefaultTools().map((tool) => [tool.toLowerCase(), tool]),
    );
  }
}
