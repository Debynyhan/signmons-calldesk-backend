import type { TenantFeePolicy } from "@prisma/client";
import type { TenantsService } from "../../tenants/interfaces/tenants-service.interface";
import { VoiceHandoffPolicyService } from "../voice-handoff-policy.service";

const buildFeePolicy = (
  overrides: Partial<TenantFeePolicy> = {},
): TenantFeePolicy => ({
  id: "policy-1",
  tenantId: "tenant-1",
  serviceFeeCents: 15000,
  emergencyFeeCents: 9900,
  creditWindowHours: 24,
  currency: "USD",
  effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

const buildTenantsService = (
  feePolicy: TenantFeePolicy | null = buildFeePolicy(),
): TenantsService =>
  ({
    getTenantFeePolicy: jest.fn().mockResolvedValue(feePolicy),
  }) as unknown as TenantsService;

describe("VoiceHandoffPolicyService", () => {
  describe("getTenantFeeConfig", () => {
    it("returns nulls and default window for null policy", () => {
      const service = new VoiceHandoffPolicyService(buildTenantsService());
      const config = service.getTenantFeeConfig(null);
      expect(config.serviceFee).toBeNull();
      expect(config.emergencyFee).toBeNull();
      expect(config.creditWindowHours).toBe(24);
    });

    it("extracts fees from policy", () => {
      const service = new VoiceHandoffPolicyService(buildTenantsService());
      const config = service.getTenantFeeConfig(buildFeePolicy());
      expect(config.serviceFee).toBe(150);
      expect(config.emergencyFee).toBe(99);
      expect(config.creditWindowHours).toBe(24);
    });
  });

  describe("formatFeeAmount", () => {
    it("formats integer amounts without decimals", () => {
      const service = new VoiceHandoffPolicyService(buildTenantsService());
      expect(service.formatFeeAmount(150)).toBe("$150");
    });

    it("formats fractional amounts with 2 decimals", () => {
      const service = new VoiceHandoffPolicyService(buildTenantsService());
      expect(service.formatFeeAmount(99.5)).toBe("$99.50");
    });
  });

  describe("getTenantFeePolicySafe", () => {
    it("returns null when service throws", async () => {
      const tenantsService = {
        getTenantFeePolicy: jest.fn().mockRejectedValue(new Error("db error")),
      } as unknown as TenantsService;
      const service = new VoiceHandoffPolicyService(tenantsService);
      expect(await service.getTenantFeePolicySafe("t1")).toBeNull();
    });

    it("returns policy on success", async () => {
      const service = new VoiceHandoffPolicyService(buildTenantsService());
      expect(await service.getTenantFeePolicySafe("tenant-1")).not.toBeNull();
    });
  });
});
