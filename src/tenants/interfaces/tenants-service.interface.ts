export interface TenantSettings {
  displayName?: string;
  instructions?: string;
  diagnosticFeeCents?: number;
  emergencySurchargeEnabled?: boolean;
  emergencySurchargeAmountCents?: number;
  slug?: string;
  prompt?: string;
}

export interface TenantContext {
  tenantId: string;
  name: string;
  timezone: string;
  settings: TenantSettings;
  prompt: string;
}

export interface CreateTenantInput {
  name: string;
  displayName?: string;
  instructions?: string;
  timezone?: string;
  settings?: TenantSettings;
}

export interface TenantsService {
  getTenantContext(tenantId: string): Promise<TenantContext>;
  createTenant(input: CreateTenantInput): Promise<TenantContext>;
}
