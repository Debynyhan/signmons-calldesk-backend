import { VoiceTurnHandoffRuntime } from "../voice-turn-handoff.runtime";

type HandoffPolicy = ConstructorParameters<typeof VoiceTurnHandoffRuntime>[0];

const buildPolicy = (
  overrides: Partial<HandoffPolicy> = {},
): HandoffPolicy => ({
  clearIssuePromptAttempts: jest.fn(),
  prepareSmsHandoff: jest.fn().mockResolvedValue({
    kind: "ready_to_close",
    resolvedSmsPhone: null,
    collectedData: null,
  }),
  replyWithListeningWindow: jest.fn().mockResolvedValue("listening"),
  buildSayGatherTwiml: jest
    .fn()
    .mockImplementation((message: string) => message),
  buildAskSmsNumberTwiml: jest.fn().mockReturnValue("ask-sms"),
  sendVoiceHandoffIntakeLink: jest.fn().mockResolvedValue(undefined),
  isUrgencyEmergency: jest.fn().mockReturnValue(false),
  resolveSmsHandoffClosingMessage: jest.fn().mockResolvedValue("closing-msg"),
  buildClosingTwiml: jest
    .fn()
    .mockImplementation(
      (displayName: string, message: string) => `${displayName}::${message}`,
    ),
  applyCsrStrategy: jest
    .fn()
    .mockImplementation((_, message: string) => message),
  replyWithTwiml: jest.fn().mockResolvedValue("twiml"),
  buildNoHandoffTwiml: jest.fn().mockReturnValue("no-handoff"),
  log: jest.fn(),
  warn: jest.fn(),
  ...overrides,
});

describe("VoiceTurnHandoffRuntime", () => {
  it("detects human fallback messages", () => {
    const runtime = new VoiceTurnHandoffRuntime(buildPolicy());

    expect(runtime.isHumanFallbackMessage("We'll follow up shortly.")).toBe(
      true,
    );
    expect(
      runtime.isHumanFallbackMessage("Thanks. We'll follow up shortly."),
    ).toBe(true);
    expect(runtime.isHumanFallbackMessage("We're dispatching now.")).toBe(
      false,
    );
  });

  it("prompts ANI confirmation when sms handoff requests confirmation", async () => {
    const policy = buildPolicy({
      prepareSmsHandoff: jest.fn().mockResolvedValue({
        kind: "prompt_confirm_ani",
        sourceEventId: "evt-1",
        fallbackPhone: "+12165551234",
      }),
    });
    const runtime = new VoiceTurnHandoffRuntime(policy);

    const result = await runtime.replyWithSmsHandoff({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      displayName: "Acme HVAC",
      reason: "triage_close",
    });

    expect(result).toBe("listening");
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "sms_phone",
        sourceEventId: "evt-1",
      }),
    );
    expect(policy.buildSayGatherTwiml).toHaveBeenCalledWith(
      expect.stringContaining("1234"),
    );
  });

  it("asks caller for sms number when no ani fallback is available", async () => {
    const policy = buildPolicy({
      prepareSmsHandoff: jest.fn().mockResolvedValue({
        kind: "prompt_ask_sms_phone",
        sourceEventId: "evt-2",
      }),
    });
    const runtime = new VoiceTurnHandoffRuntime(policy);

    const result = await runtime.replyWithSmsHandoff({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      displayName: "Acme HVAC",
      reason: "triage_close",
    });

    expect(result).toBe("listening");
    expect(policy.buildAskSmsNumberTwiml).toHaveBeenCalledTimes(1);
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "sms_phone",
        sourceEventId: "evt-2",
        twiml: "ask-sms",
      }),
    );
  });

  it("sends intake link and closes call when handoff is ready", async () => {
    const policy = buildPolicy({
      prepareSmsHandoff: jest.fn().mockResolvedValue({
        kind: "ready_to_close",
        resolvedSmsPhone: "+12165550000",
        collectedData: null,
      }),
      isUrgencyEmergency: jest.fn().mockReturnValue(true),
    });
    const runtime = new VoiceTurnHandoffRuntime(policy);

    const result = await runtime.replyWithSmsHandoff({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      displayName: "Acme HVAC",
      reason: "triage_close",
    });

    expect(result).toBe("twiml");
    expect(policy.sendVoiceHandoffIntakeLink).toHaveBeenCalledWith(
      expect.objectContaining({
        toPhone: "+12165550000",
        isEmergency: true,
      }),
    );
    expect(policy.resolveSmsHandoffClosingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
      }),
    );
    expect(policy.replyWithTwiml).toHaveBeenCalledWith(
      undefined,
      "Acme HVAC::closing-msg",
    );
    expect(policy.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.outcome",
        outcome: "sms_handoff",
      }),
    );
  });

  it("continues closing when sms link send fails", async () => {
    const policy = buildPolicy({
      prepareSmsHandoff: jest.fn().mockResolvedValue({
        kind: "ready_to_close",
        resolvedSmsPhone: "+12165550000",
        collectedData: null,
      }),
      sendVoiceHandoffIntakeLink: jest
        .fn()
        .mockRejectedValue(new Error("twilio blocked")),
    });
    const runtime = new VoiceTurnHandoffRuntime(policy);

    const result = await runtime.replyWithSmsHandoff({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      displayName: "Acme HVAC",
      reason: "triage_close",
    });

    expect(result).toBe("twiml");
    expect(policy.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.sms_intake_link_send_failed",
      }),
    );
  });

  it("routes human and no-handoff closing paths", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnHandoffRuntime(policy);

    const human = await runtime.replyWithHumanFallback({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      displayName: "Acme HVAC",
      reason: "human_transfer",
    });
    const noHandoff = await runtime.replyWithNoHandoff({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      reason: "tenant_not_found",
    });

    expect(human).toBe("twiml");
    expect(noHandoff).toBe("twiml");
    expect(policy.buildClosingTwiml).toHaveBeenCalledWith(
      "Acme HVAC",
      "We'll follow up shortly.",
    );
    expect(policy.replyWithTwiml).toHaveBeenCalledWith(undefined, "no-handoff");
  });

  it("asks booking confirmation using confirmation target", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnHandoffRuntime(policy);

    const result = await runtime.replyWithBookingOffer({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      sourceEventId: "evt-3",
      message: "Great.",
    });

    expect(result).toBe("listening");
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "confirmation",
        targetField: "booking",
        sourceEventId: "evt-3",
      }),
    );
    expect(policy.buildSayGatherTwiml).toHaveBeenCalledWith(
      expect.stringContaining("Would you like to book a visit?"),
    );
  });
});
