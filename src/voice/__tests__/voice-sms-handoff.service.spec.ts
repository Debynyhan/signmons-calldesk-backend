import type { TenantFeePolicy } from "@prisma/client";
import type { ConversationsService } from "../../conversations/conversations.service";
import type { LoggingService } from "../../logging/logging.service";
import { VoiceSmsHandoffService } from "../voice-sms-handoff.service";

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

const buildVoiceHandoffPolicyService = (
  feePolicy: TenantFeePolicy | null = buildFeePolicy(),
) => ({
  getTenantFeePolicySafe: jest.fn().mockResolvedValue(feePolicy),
  getTenantFeeConfig: jest.fn().mockImplementation(
    (policy: TenantFeePolicy | null) => ({
      serviceFee: policy ? policy.serviceFeeCents / 100 : null,
      emergencyFee: policy && policy.emergencyFeeCents ? policy.emergencyFeeCents / 100 : null,
      creditWindowHours: policy?.creditWindowHours ?? 24,
    }),
  ),
  formatFeeAmount: jest.fn().mockImplementation((value: number) => {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
  }),
});

const buildConversationsService = (
  overrides: Record<string, unknown> = {},
): ConversationsService =>
  ({
    getConversationById: jest.fn().mockResolvedValue({
      id: "conversation-1",
      collectedData: {},
    }),
    getVoiceSmsPhoneState: jest.fn().mockReturnValue({
      value: null,
      source: null,
      confirmed: false,
      confirmedAt: null,
      attemptCount: 0,
      lastPromptedAt: null,
    }),
    updateVoiceSmsPhoneState: jest.fn().mockResolvedValue(null),
    updateVoiceSmsHandoff: jest.fn().mockResolvedValue(null),
    clearVoiceSmsHandoff: jest.fn().mockResolvedValue(null),
    ...overrides,
  }) as unknown as ConversationsService;

const buildLoggingService = (
  overrides: Record<string, unknown> = {},
): LoggingService =>
  ({
    log: jest.fn(),
    ...overrides,
  }) as unknown as LoggingService;

describe("VoiceSmsHandoffService", () => {
  it("prompts ANI confirmation when fallback phone is available", async () => {
    const conversationsService = buildConversationsService({
      getConversationById: jest.fn().mockResolvedValue({
        id: "conversation-1",
        collectedData: { callerPhone: "+12167448929" },
      }),
      getVoiceSmsPhoneState: jest.fn().mockReturnValue({
        value: null,
        source: null,
        confirmed: false,
        confirmedAt: null,
        attemptCount: 0,
        lastPromptedAt: null,
      }),
    });
    const loggingService = buildLoggingService();
    const service = new VoiceSmsHandoffService(conversationsService, loggingService, buildVoiceHandoffPolicyService() as never);

    const result = await service.prepare({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      reason: "handoff",
      loggerContext: "VoiceTurnService",
    });

    expect(result.kind).toBe("prompt_confirm_ani");
    if (result.kind !== "prompt_confirm_ani") {
      throw new Error("Expected prompt_confirm_ani");
    }
    expect(result.fallbackPhone).toBe("+12167448929");
    expect(conversationsService.updateVoiceSmsPhoneState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        phoneState: expect.objectContaining({
          value: "+12167448929",
          source: "twilio_ani",
          confirmed: false,
          lastPromptedAt: expect.any(String),
        }),
      }),
    );
    expect(conversationsService.updateVoiceSmsHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        handoff: expect.objectContaining({
          reason: "handoff",
          messageOverride: null,
          createdAt: expect.any(String),
        }),
      }),
    );
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_phone_ani_confirm_prompted",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        callSid: "CA123",
      }),
      "VoiceTurnService",
    );
    expect(conversationsService.clearVoiceSmsHandoff).not.toHaveBeenCalled();
  });

  it("asks for SMS phone when no fallback phone exists", async () => {
    const conversationsService = buildConversationsService({
      getConversationById: jest.fn().mockResolvedValue({
        id: "conversation-1",
        collectedData: {},
      }),
      getVoiceSmsPhoneState: jest.fn().mockReturnValue({
        value: null,
        source: null,
        confirmed: false,
        confirmedAt: null,
        attemptCount: 0,
        lastPromptedAt: null,
      }),
    });
    const loggingService = buildLoggingService();
    const service = new VoiceSmsHandoffService(conversationsService, loggingService, buildVoiceHandoffPolicyService() as never);

    const result = await service.prepare({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      reason: "handoff",
      loggerContext: "VoiceTurnService",
    });

    expect(result.kind).toBe("prompt_ask_sms_phone");
    expect(conversationsService.updateVoiceSmsHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        handoff: expect.objectContaining({
          reason: "handoff",
          messageOverride: null,
          createdAt: expect.any(String),
        }),
      }),
    );
    expect(conversationsService.updateVoiceSmsPhoneState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        phoneState: expect.objectContaining({
          lastPromptedAt: expect.any(String),
        }),
      }),
    );
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_phone_prompted",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        callSid: "CA123",
      }),
      "VoiceTurnService",
    );
    expect(conversationsService.clearVoiceSmsHandoff).not.toHaveBeenCalled();
  });

  it("marks handoff as started when SMS phone is already confirmed", async () => {
    const conversationsService = buildConversationsService({
      getVoiceSmsPhoneState: jest.fn().mockReturnValue({
        value: "+12167448929",
        source: "twilio_ani",
        confirmed: true,
        confirmedAt: "2026-01-01T00:00:00.000Z",
        attemptCount: 0,
        lastPromptedAt: null,
      }),
    });
    const loggingService = buildLoggingService();
    const service = new VoiceSmsHandoffService(conversationsService, loggingService, buildVoiceHandoffPolicyService() as never);

    const result = await service.prepare({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      reason: "handoff",
      loggerContext: "VoiceTurnService",
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: "ready_to_close",
        resolvedSmsPhone: "+12167448929",
      }),
    );
    expect(conversationsService.clearVoiceSmsHandoff).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_handoff_started",
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        callSid: "CA123",
        sms_handoff_started_at: expect.any(String),
      }),
      "VoiceTurnService",
    );
  });

  describe("SMS closing message builders", () => {
    const makeService = (feePolicy: TenantFeePolicy | null = buildFeePolicy()) =>
      new VoiceSmsHandoffService(
        buildConversationsService() as never,
        buildLoggingService() as never,
        buildVoiceHandoffPolicyService(feePolicy) as never,
      );

    it("builds default sms handoff message", () => {
      const service = makeService();
      expect(service.buildSmsHandoffMessage()).toContain(
        "I'm texting you now to confirm your details.",
      );
    });

    it("personalizes message with caller first name", () => {
      const service = makeService();
      expect(service.buildSmsHandoffMessage("Dan")).toContain("Thanks, Dan.");
    });

    it("builds fee-aware handoff message with emergency add-on", () => {
      const service = makeService();
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

    it("uses plain message when includeFees is false", () => {
      const service = makeService();
      const message = service.buildSmsHandoffMessageForContext({
        feePolicy: buildFeePolicy(),
        includeFees: false,
        isEmergency: false,
      });
      expect(message).toContain("I'm texting you now to confirm your details.");
      expect(message).not.toContain("service fee");
    });

    it("uses compliant override only when fee + texting language are present", async () => {
      const service = makeService();
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
});
