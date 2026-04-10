import { VoiceTurnAddressExtractionRuntime } from "../voice-turn-address-extraction.runtime";

type AddressExtractionPolicy = ConstructorParameters<
  typeof VoiceTurnAddressExtractionRuntime
>[0];

const defaultNameState = {
  candidate: {
    value: "Taylor Smith",
    sourceEventId: "evt-1",
    createdAt: "2026-04-10T00:00:00.000Z",
  },
  confirmed: {
    value: "Taylor Smith",
    sourceEventId: "evt-1",
    createdAt: "2026-04-10T00:00:00.000Z",
  },
  status: "CONFIRMED" as const,
  attemptCount: 1,
  lastPromptedAt: null,
  lastConfidence: null,
  locked: true,
  corrections: 0,
  firstNameSpelled: null,
  spellPromptedAt: null,
  spellPromptedTurnIndex: null,
  spellPromptCount: 0,
};

const defaultAddressState = {
  status: "MISSING" as const,
  candidate: null,
  confidence: null,
  sourceEventId: null,
  attemptCount: 0,
  confirmed: null,
  correctedFrom: null,
  needsLocalityCheck: false,
  localityMergeAttemptedAt: null,
  lastPromptedAt: null,
  locked: false,
  smsConfirmNeeded: false,
  houseNumber: null,
  street: null,
  city: null,
  state: null,
  zip: null,
};

const buildPolicy = (
  overrides: Partial<AddressExtractionPolicy> = {},
): AddressExtractionPolicy => ({
  sanitizer: {
    sanitizeText: (value: string) => value,
    normalizeWhitespace: (value: string) => value.replace(/\s+/g, " ").trim(),
  },
  voiceAddressMinConfidence: 0.7,
  extractAddressCandidate: jest.fn().mockResolvedValue(null),
  updateVoiceAddressState: jest.fn().mockResolvedValue(undefined),
  deferAddressToSmsAuthority: jest.fn().mockResolvedValue("defer"),
  replyWithAddressPromptWindow: jest.fn().mockResolvedValue("address-prompt"),
  handleMissingLocalityPrompt: jest.fn().mockResolvedValue("missing-locality"),
  replyWithAddressConfirmationWindow: jest
    .fn()
    .mockResolvedValue("address-confirmation"),
  ...overrides,
});

const buildParams = () => ({
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  displayName: "Acme HVAC",
  currentEventId: "evt-2",
  normalizedSpeech: "hello",
  addressState: defaultAddressState,
  nameState: defaultNameState,
  collectedData: null,
  strategy: undefined,
  timingCollector: { aiMs: 0, aiCalls: 0 },
});

describe("VoiceTurnAddressExtractionRuntime", () => {
  it("reprompts for address when candidate is missing and retries remain", async () => {
    const policy = buildPolicy({
      extractAddressCandidate: jest.fn().mockResolvedValue(null),
    });
    const runtime = new VoiceTurnAddressExtractionRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      normalizedSpeech: "uh",
    });

    expect(result).toBe("address-prompt");
    expect(policy.replyWithAddressPromptWindow).toHaveBeenCalled();
    expect(policy.deferAddressToSmsAuthority).not.toHaveBeenCalled();
  });

  it("fails closed to sms defer when retries are exhausted", async () => {
    const policy = buildPolicy({
      extractAddressCandidate: jest.fn().mockResolvedValue(null),
    });
    const runtime = new VoiceTurnAddressExtractionRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      normalizedSpeech: "okay",
      addressState: {
        ...defaultAddressState,
        attemptCount: 1,
      },
    });

    expect(result).toBe("defer");
    expect(policy.deferAddressToSmsAuthority).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: "CA123",
      }),
    );
  });

  it("routes to locality prompt when address lacks locality", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressExtractionRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      normalizedSpeech: "123 Main Street",
    });

    expect(result).toBe("missing-locality");
    expect(policy.handleMissingLocalityPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.stringContaining("123 Main"),
      }),
    );
  });

  it("routes to confirmation when complete address is captured", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressExtractionRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      normalizedSpeech: "123 Main St, Cleveland, OH 44113",
    });

    expect(result).toBe("address-confirmation");
    expect(policy.replyWithAddressConfirmationWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.stringContaining("123 Main"),
      }),
    );
  });
});
