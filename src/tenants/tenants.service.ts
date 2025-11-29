import { Injectable } from "@nestjs/common";
import {
  TenantContext,
  TenantsService,
} from "./interfaces/tenants-service.interface";
import { SanitizationService } from "../sanitization/sanitization.service";

@Injectable()
export class StaticTenantsService implements TenantsService {
  constructor(private readonly sanitizationService: SanitizationService) {}

  async getTenantContext(tenantId: string): Promise<TenantContext> {
    const sanitizedTenantId =
      this.sanitizationService.sanitizeIdentifier(tenantId);
    const displayName = "Licensed HVAC/Plumbing/Electrical contractor";
    return {
      tenantId: sanitizedTenantId,
      displayName,
      instructions: this.sanitizationService.sanitizeText(
        "Always act as a professional dispatcher for this contractor. Collect caller details, classify the issue, and follow booking procedures."
      ),
    };
  }
}
