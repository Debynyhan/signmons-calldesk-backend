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
  allowedTools?: string[];
}

export interface TenantsService {
  getTenantContext(tenantId: string): Promise<TenantContext>;
  createTenant(input: CreateTenantInput): Promise<TenantContext>;
}
