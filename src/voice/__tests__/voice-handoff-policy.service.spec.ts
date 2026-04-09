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
  it("builds default sms handoff message", () => {
    const service = new VoiceHandoffPolicyService(buildTenantsService());
    expect(service.buildSmsHandoffMessage()).toContain(
      "I'm texting you now to confirm your details.",
    );
  });

  it("builds fee-aware handoff message with emergency add-on", () => {
    const service = new VoiceHandoffPolicyService(buildTenantsService());
    const message = service.buildSmsHandoffMessageForContext({
      feePolicy: buildFeePolicy(),
      includeFees: true,
      isEmergency: true,
      callerFirstName: "Dan",
    });
    expect(message).toContain("Great, Dan");
    expect(message).toContain("service fee is $150");
    expect(message).toContain("additional $99 emergency fee");
    expect(message).toContain("approve the fees");
  });

  it("uses compliant override only when fee + texting language are present", async () => {
    const service = new VoiceHandoffPolicyService(buildTenantsService());
    const accepted = await service.resolveSmsHandoffClosingMessage({
      tenantId: "tenant-1",
      isEmergency: false,
      messageOverride:
        "The service fee is $150 and it's credited toward repairs. I'm texting you now.",
    });
    expect(accepted).toContain("I'm texting you now.");

    const fallback = await service.resolveSmsHandoffClosingMessage({
      tenantId: "tenant-1",
      isEmergency: false,
      messageOverride: "Thanks, we will call you back.",
    });
    expect(fallback).toContain("service fee is $150");
    expect(fallback).toContain("I'm texting you now");
  });
});
