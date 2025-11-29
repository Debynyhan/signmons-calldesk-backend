import { Injectable } from "@nestjs/common";
import {
  TenantContext,
  TenantsService,
} from "./interfaces/tenants-service.interface";

@Injectable()
export class StaticTenantsService implements TenantsService {
  async getTenantContext(tenantId: string): Promise<TenantContext> {
    const displayName = "Licensed HVAC/Plumbing/Electrical contractor";
    return {
      tenantId,
      displayName,
      instructions:
        "Always act as a professional dispatcher for this contractor. Collect caller details, classify the issue, and follow booking procedures.",
    };
  }
}
