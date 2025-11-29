export interface TenantContext {
  tenantId: string;
  displayName: string;
  instructions: string;
  prompt: string;
}

export interface TenantsService {
  getTenantContext(tenantId: string): Promise<TenantContext>;
}
