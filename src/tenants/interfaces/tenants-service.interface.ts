export interface TenantContext {
  tenantId: string;
  displayName: string;
  instructions: string;
  prompt: string;
  emergencySurchargeEnabled?: boolean;
  emergencySurchargeAmount?: number;
}

export interface CreateTenantInput {
  name: string;
  displayName: string;
  instructions: string;
  emergencySurchargeEnabled?: boolean;
  emergencySurchargeAmount?: number;
}

export interface TenantsService {
  getTenantContext(tenantId: string): Promise<TenantContext>;
  createTenant(input: CreateTenantInput): Promise<TenantContext>;
}
