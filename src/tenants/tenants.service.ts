import { Injectable } from "@nestjs/common";
import {
  TenantContext,
  TenantsService,
} from "./interfaces/tenants-service.interface";
import { SanitizationService } from "../sanitization/sanitization.service";

@Injectable()
export class StaticTenantsService implements TenantsService {
  constructor(private readonly sanitizationService: SanitizationService) {}

  getTenantContext(tenantId: string): Promise<TenantContext> {
    const sanitizedTenantId =
      this.sanitizationService.sanitizeIdentifier(tenantId);
    const displayName = "Licensed HVAC/Plumbing/Electrical contractor";
    const instructions = this.sanitizationService.sanitizeText(
      "Always act as a professional dispatcher for this contractor. Collect caller details, classify the issue, and follow booking procedures.",
    );
    const context: TenantContext = {
      tenantId: sanitizedTenantId,
      displayName,
      instructions,
      prompt: this.buildPrompt(sanitizedTenantId, displayName, instructions),
    };
    return Promise.resolve(context);
  }

  private buildPrompt(
    tenantId: string,
    displayName: string,
    instructions: string,
  ): string {
    return `You are handling calls for tenantId=${tenantId} (${displayName}). ${instructions}`;
  }
}
