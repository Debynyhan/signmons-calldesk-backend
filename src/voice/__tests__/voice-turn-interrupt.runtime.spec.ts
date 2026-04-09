import { VoiceTurnInterruptRuntime } from "../voice-turn-interrupt.runtime";

type SlowDownPolicy = ConstructorParameters<typeof VoiceTurnInterruptRuntime>[0];
type InterruptPolicy = ConstructorParameters<
  typeof VoiceTurnInterruptRuntime
>[1];

const buildSlowDownPolicy = (
  overrides: Partial<SlowDownPolicy> = {},
): SlowDownPolicy => ({
  isSlowDownRequest: jest.fn().mockReturnValue(false),
  replyWithListeningWindow: jest.fn().mockResolvedValue("slowdown-listen"),
  buildTakeYourTimeTwiml: jest.fn().mockReturnValue("take-your-time"),
  replyWithTwiml: jest.fn().mockResolvedValue("slowdown-generic"),
  buildSayGatherTwiml: jest.fn().mockReturnValue("say-gather"),
  ...overrides,
});

const buildInterruptPolicy = (
  overrides: Partial<InterruptPolicy> = {},
): InterruptPolicy => ({
  isHangupRequest: jest.fn().mockReturnValue(false),
  clearIssuePromptAttempts: jest.fn(),
  replyWithTwiml: jest.fn().mockResolvedValue("hangup-reply"),
  buildTwiml: jest.fn().mockReturnValue("hangup-twiml"),
  isHumanTransferRequest: jest.fn().mockReturnValue(false),
  replyWithListeningWindow: jest.fn().mockResolvedValue("interrupt-listen"),
  buildCallbackOfferTwiml: jest.fn().mockReturnValue("callback-offer"),
  isSmsDifferentNumberRequest: jest.fn().mockReturnValue(false),
  updateVoiceSmsHandoff: jest.fn().mockResolvedValue(null),
  updateVoiceSmsPhoneState: jest.fn().mockResolvedValue(null),
  buildAskSmsNumberTwiml: jest.fn().mockReturnValue("ask-sms-number"),
  ...overrides,
});

describe("VoiceTurnInterruptRuntime", () => {
  it("continues when slowdown utterance is not detected", async () => {
    const slowDownPolicy = buildSlowDownPolicy();
    const interruptPolicy = buildInterruptPolicy();
    const runtime = new VoiceTurnInterruptRuntime(slowDownPolicy, interruptPolicy);

    const result = await runtime.handleSlowDown({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      currentEventId: "evt-1",
      normalizedSpeech: "my furnace is not working",
      expectedField: "name",
    });

    expect(result).toEqual({ kind: "continue" });
    expect(slowDownPolicy.replyWithListeningWindow).not.toHaveBeenCalled();
    expect(slowDownPolicy.replyWithTwiml).not.toHaveBeenCalled();
  });

  it("returns name listening-window prompt when slowdown is requested for name", async () => {
    const slowDownPolicy = buildSlowDownPolicy({
      isSlowDownRequest: jest.fn().mockReturnValue(true),
    });
    const interruptPolicy = buildInterruptPolicy();
    const runtime = new VoiceTurnInterruptRuntime(slowDownPolicy, interruptPolicy);

    const result = await runtime.handleSlowDown({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      currentEventId: "evt-2",
      normalizedSpeech: "please slow down",
      expectedField: "name",
    });

    expect(result).toEqual({ kind: "exit", value: "slowdown-listen" });
    expect(slowDownPolicy.buildTakeYourTimeTwiml).toHaveBeenCalledWith(
      "name",
      undefined,
    );
    expect(slowDownPolicy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        field: "name",
        sourceEventId: "evt-2",
      }),
    );
  });

  it("uses generic gather reply when slowdown is requested outside core fields", async () => {
    const slowDownPolicy = buildSlowDownPolicy({
      isSlowDownRequest: jest.fn().mockReturnValue(true),
    });
    const interruptPolicy = buildInterruptPolicy();
    const runtime = new VoiceTurnInterruptRuntime(slowDownPolicy, interruptPolicy);

    const result = await runtime.handleSlowDown({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      currentEventId: "evt-3",
      normalizedSpeech: "say that again",
      expectedField: "booking",
    });

    expect(result).toEqual({ kind: "exit", value: "slowdown-generic" });
    expect(slowDownPolicy.buildSayGatherTwiml).toHaveBeenCalledWith(
      "Sure—take your time. How can I help?",
    );
    expect(slowDownPolicy.replyWithTwiml).toHaveBeenCalledWith(
      undefined,
      "say-gather",
    );
  });

  it("hangs up politely when caller requests to end the call", async () => {
    const slowDownPolicy = buildSlowDownPolicy();
    const interruptPolicy = buildInterruptPolicy({
      isHangupRequest: jest.fn().mockReturnValue(true),
    });
    const runtime = new VoiceTurnInterruptRuntime(slowDownPolicy, interruptPolicy);

    const result = await runtime.handleInterrupts({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      currentEventId: "evt-4",
      normalizedSpeech: "goodbye",
      phoneState: {
        value: null,
        source: null,
        confirmed: false,
        confirmedAt: null,
        attemptCount: 0,
        lastPromptedAt: null,
      },
    });

    expect(result).toEqual({ kind: "exit", value: "hangup-reply" });
    expect(interruptPolicy.clearIssuePromptAttempts).toHaveBeenCalledWith("CA123");
    expect(interruptPolicy.buildTwiml).toHaveBeenCalledWith(
      "No problem. If you need anything later, call us back.",
    );
    expect(interruptPolicy.replyWithTwiml).toHaveBeenCalledWith(
      undefined,
      "hangup-twiml",
    );
  });

  it("routes to callback offer when human transfer is requested", async () => {
    const slowDownPolicy = buildSlowDownPolicy();
    const interruptPolicy = buildInterruptPolicy({
      isHumanTransferRequest: jest.fn().mockReturnValue(true),
    });
    const runtime = new VoiceTurnInterruptRuntime(slowDownPolicy, interruptPolicy);

    const result = await runtime.handleInterrupts({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      currentEventId: "evt-5",
      normalizedSpeech: "can I talk to a person",
      phoneState: {
        value: null,
        source: null,
        confirmed: false,
        confirmedAt: null,
        attemptCount: 0,
        lastPromptedAt: null,
      },
    });

    expect(result).toEqual({ kind: "exit", value: "interrupt-listen" });
    expect(interruptPolicy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        field: "confirmation",
        targetField: "callback",
        sourceEventId: "evt-5",
        twiml: "callback-offer",
      }),
    );
  });

  it("resets sms phone state and asks for new number when caller changes sms target", async () => {
    const slowDownPolicy = buildSlowDownPolicy();
    const interruptPolicy = buildInterruptPolicy({
      isSmsDifferentNumberRequest: jest.fn().mockReturnValue(true),
    });
    const runtime = new VoiceTurnInterruptRuntime(slowDownPolicy, interruptPolicy);

    const result = await runtime.handleInterrupts({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      currentEventId: "evt-6",
      normalizedSpeech: "text another number",
      phoneState: {
        value: "+12165551234",
        source: "user_spoken",
        confirmed: true,
        confirmedAt: "2026-04-09T16:20:00.000Z",
        attemptCount: 1,
        lastPromptedAt: "2026-04-09T16:21:00.000Z",
      },
    });

    expect(result).toEqual({ kind: "exit", value: "interrupt-listen" });
    expect(interruptPolicy.updateVoiceSmsHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        handoff: expect.objectContaining({
          reason: "sms_number_change_requested",
          messageOverride: null,
          createdAt: expect.any(String),
        }),
      }),
    );
    expect(interruptPolicy.updateVoiceSmsPhoneState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        phoneState: expect.objectContaining({
          value: "+12165551234",
          source: "user_spoken",
          confirmed: false,
          confirmedAt: null,
          attemptCount: 0,
          lastPromptedAt: expect.any(String),
        }),
      }),
    );
    expect(interruptPolicy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "sms_phone",
        sourceEventId: "evt-6",
        twiml: "ask-sms-number",
      }),
    );
  });

  it("continues when no interrupt is matched", async () => {
    const slowDownPolicy = buildSlowDownPolicy();
    const interruptPolicy = buildInterruptPolicy();
    const runtime = new VoiceTurnInterruptRuntime(slowDownPolicy, interruptPolicy);

    const result = await runtime.handleInterrupts({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      currentEventId: "evt-7",
      normalizedSpeech: "the issue is no cooling",
      phoneState: {
        value: null,
        source: null,
        confirmed: false,
        confirmedAt: null,
        attemptCount: 0,
        lastPromptedAt: null,
      },
    });

    expect(result).toEqual({ kind: "continue" });
    expect(interruptPolicy.replyWithTwiml).not.toHaveBeenCalled();
    expect(interruptPolicy.replyWithListeningWindow).not.toHaveBeenCalled();
    expect(interruptPolicy.updateVoiceSmsHandoff).not.toHaveBeenCalled();
  });
});
