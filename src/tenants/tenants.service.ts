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

    if (!name) {
      throw new Error("Tenant name must include alphanumeric characters.");
    }

    const prompt = this.buildPrompt(tenantId, displayName, instructions);

    const tenant = await this.prisma.tenant.create({
      data: {
        id: tenantId,
        name,
        displayName,
        instructions,
        prompt,
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
    };
  }

  private buildPrompt(
    tenantId: string,
    displayName: string,
    instructions: string,
  ) {
    return `You are handling calls for tenantId=${tenantId} (${displayName}). ${instructions}`;
  }
}
