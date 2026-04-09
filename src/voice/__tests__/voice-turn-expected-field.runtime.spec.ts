import { VoiceTurnExpectedFieldRuntime } from "../voice-turn-expected-field.runtime";

type ExpectedFieldPolicy = ConstructorParameters<
  typeof VoiceTurnExpectedFieldRuntime
>[0];

const defaultPhoneState = {
  value: null,
  source: null,
  confirmed: false,
  confirmedAt: null,
  attemptCount: 0,
  lastPromptedAt: null,
};

const buildPolicy = (
  overrides: Partial<ExpectedFieldPolicy> = {},
): ExpectedFieldPolicy => ({
  getVoiceSmsHandoff: jest.fn().mockReturnValue({
    reason: "intake_complete",
    messageOverride: null,
    createdAt: "2026-04-09T00:00:00.000Z",
  }),
  getCallerPhoneFromCollectedData: jest.fn().mockReturnValue("+12165551234"),
  normalizeConfirmationUtterance: jest
    .fn()
    .mockImplementation((value: string) => value.toLowerCase()),
  isSmsNumberConfirmation: jest.fn().mockReturnValue(true),
  extractSmsPhoneCandidate: jest.fn().mockReturnValue(null),
  handleExpectedSmsPhoneField: jest.fn().mockResolvedValue({
    kind: "not_waiting",
  }),
  replyWithSmsHandoff: jest.fn().mockResolvedValue("sms-handoff"),
  replyWithListeningWindow: jest.fn().mockResolvedValue("reprompt"),
  buildAskSmsNumberTwiml: jest.fn().mockReturnValue("ask-sms"),
  replyWithHumanFallback: jest.fn().mockResolvedValue("human-fallback"),
  loggerContext: "VoiceTurnService",
  ...overrides,
});

describe("VoiceTurnExpectedFieldRuntime", () => {
  it("continues unchanged when expected field is not sms_phone", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnExpectedFieldRuntime(policy);

    const result = await runtime.handleSmsPhoneExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      displayName: "Acme HVAC",
      expectedField: "address",
      phoneState: defaultPhoneState,
      collectedData: null,
      normalizedSpeech: "hello",
      currentEventId: "evt-1",
    });

    expect(result).toEqual({ kind: "continue", expectedField: "address" });
    expect(policy.handleExpectedSmsPhoneField).not.toHaveBeenCalled();
  });

  it("clears expected field when slot service returns not_waiting", async () => {
    const policy = buildPolicy({
      handleExpectedSmsPhoneField: jest
        .fn()
        .mockResolvedValue({ kind: "not_waiting" }),
    });
    const runtime = new VoiceTurnExpectedFieldRuntime(policy);

    const result = await runtime.handleSmsPhoneExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      displayName: "Acme HVAC",
      expectedField: "sms_phone",
      phoneState: defaultPhoneState,
      collectedData: null,
      normalizedSpeech: "same number",
      currentEventId: "evt-2",
    });

    expect(result).toEqual({ kind: "continue", expectedField: null });
  });

  it("exits with sms handoff when slot service confirms handoff", async () => {
    const policy = buildPolicy({
      handleExpectedSmsPhoneField: jest.fn().mockResolvedValue({
        kind: "handoff",
        reason: "intake_complete",
        messageOverride: "custom-message",
      }),
    });
    const runtime = new VoiceTurnExpectedFieldRuntime(policy);

    const result = await runtime.handleSmsPhoneExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      displayName: "Acme HVAC",
      expectedField: "sms_phone",
      phoneState: defaultPhoneState,
      collectedData: null,
      normalizedSpeech: "yes text this number",
      currentEventId: "evt-3",
    });

    expect(result).toEqual({ kind: "exit", value: "sms-handoff" });
    expect(policy.replyWithSmsHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "intake_complete",
        messageOverride: "custom-message",
      }),
    );
  });

  it("reprompts when sms number parsing needs another attempt", async () => {
    const policy = buildPolicy({
      handleExpectedSmsPhoneField: jest.fn().mockResolvedValue({
        kind: "reprompt",
        sourceEventId: "evt-4",
      }),
    });
    const runtime = new VoiceTurnExpectedFieldRuntime(policy);

    const result = await runtime.handleSmsPhoneExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      displayName: "Acme HVAC",
      expectedField: "sms_phone",
      phoneState: defaultPhoneState,
      collectedData: null,
      normalizedSpeech: "uh",
      currentEventId: "evt-4",
    });

    expect(result).toEqual({ kind: "exit", value: "reprompt" });
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "sms_phone",
        sourceEventId: "evt-4",
        twiml: "ask-sms",
      }),
    );
  });

  it("falls back to human handoff when sms number cannot be resolved", async () => {
    const policy = buildPolicy({
      handleExpectedSmsPhoneField: jest
        .fn()
        .mockResolvedValue({ kind: "human_fallback" }),
    });
    const runtime = new VoiceTurnExpectedFieldRuntime(policy);

    const result = await runtime.handleSmsPhoneExpectedField({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      callSid: "CA123",
      displayName: "Acme HVAC",
      expectedField: "sms_phone",
      phoneState: defaultPhoneState,
      collectedData: null,
      normalizedSpeech: "i'm not sure",
      currentEventId: "evt-5",
    });

    expect(result).toEqual({ kind: "exit", value: "human-fallback" });
    expect(policy.replyWithHumanFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "sms_phone_missing",
      }),
    );
  });
});
