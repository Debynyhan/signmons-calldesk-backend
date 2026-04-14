import { Inject, Injectable } from "@nestjs/common";
import type { TenantFeePolicy } from "@prisma/client";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";

@Injectable()
export class VoiceHandoffPolicyService {
  constructor(
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
  ) {}

  async getTenantFeePolicySafe(tenantId: string): Promise<TenantFeePolicy | null> {
    try {
      return await this.tenantsService.getTenantFeePolicy(tenantId);
    } catch {
      return null;
    }
  }

  getTenantFeeConfig(policy: TenantFeePolicy | null): {
    serviceFee: number | null;
    emergencyFee: number | null;
    creditWindowHours: number;
  } {
    if (!policy) {
      return {
        serviceFee: null,
        emergencyFee: null,
        creditWindowHours: 24,
      };
    }
    const creditWindowHours =
      typeof policy.creditWindowHours === "number" && policy.creditWindowHours > 0
        ? policy.creditWindowHours
        : 24;
    const emergencyFee =
      typeof policy.emergencyFeeCents === "number" && policy.emergencyFeeCents > 0
        ? policy.emergencyFeeCents / 100
        : null;
    return {
      serviceFee: policy.serviceFeeCents / 100,
      emergencyFee,
      creditWindowHours,
    };
  }

  formatFeeAmount(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
  }

  async getTenantDisplayNameSafe(tenantId: string): Promise<string | null> {
    try {
      const tenant = await this.tenantsService.getTenantContext(tenantId);
      return tenant.displayName;
    } catch {
      return null;
    }
  }

}
