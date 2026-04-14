import type { TenantFeePolicy, TenantOrganization, TenantSubscription } from "@prisma/client";

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

export interface TenantFeeSettingsUpdate {
  serviceFeeCents?: number;
  emergencyFeeCents?: number;
  creditWindowHours?: number;
  currency?: string;
}

export interface TenantsService {
  getTenantContext(tenantId: string): Promise<TenantContext>;
  createTenant(input: CreateTenantInput): Promise<TenantContext>;
  getTenantById(tenantId: string): Promise<TenantOrganization | null>;
  resolveTenantByPhone(toNumber: string): Promise<TenantOrganization | null>;
  getTenantFeePolicy(tenantId: string): Promise<TenantFeePolicy | null>;
  syncTenantFeePolicy(tenantId: string): Promise<TenantFeePolicy | null>;
  updateTenantFeeSettings(
    tenantId: string,
    updates: TenantFeeSettingsUpdate,
  ): Promise<TenantFeePolicy | null>;
  getActiveTenantSubscription(tenantId: string): Promise<TenantSubscription | null>;
}
