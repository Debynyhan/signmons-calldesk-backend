import type { TenantOrganization } from "@prisma/client";

export interface TenantContext {
  tenantId: string;
  displayName: string;
  instructions: string;
  prompt: string;
}

export interface CreateTenantInput {
  name: string;
  displayName: string;
  instructions: string;
}

export interface TenantsService {
  getTenantContext(tenantId: string): Promise<TenantContext>;
  createTenant(input: CreateTenantInput): Promise<TenantContext>;
  resolveTenantByPhone(toNumber: string): Promise<TenantOrganization | null>;
}
