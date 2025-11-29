export interface TenantContext {
  tenantId: string;
  displayName: string;
  instructions: string;
}

export interface TenantsService {
  getTenantContext(tenantId: string): Promise<TenantContext>;
}
