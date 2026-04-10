import { VoiceTurnAddressRoutingRuntime } from "../voice-turn-address-routing.runtime";

type AddressRoutingPolicy = ConstructorParameters<
  typeof VoiceTurnAddressRoutingRuntime
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
  needsLocality: false,
  houseNumber: null,
  street: null,
  city: null,
  state: null,
  zip: null,
};

const buildPolicy = (
  overrides: Partial<AddressRoutingPolicy> = {},
): AddressRoutingPolicy => ({
  sanitizer: {
    sanitizeText: (value: string) => value,
    normalizeWhitespace: (value: string) => value.replace(/\s+/g, " ").trim(),
  },
  deferAddressToSmsAuthority: jest.fn().mockResolvedValue("defer"),
  replyWithListeningWindow: jest.fn().mockResolvedValue("listening"),
  buildSayGatherTwiml: jest
    .fn()
    .mockImplementation((message: string) => `twiml:${message}`),
  buildAddressPromptForState: jest.fn().mockReturnValue("ask-address"),
  updateVoiceAddressState: jest.fn().mockResolvedValue(undefined),
  handleMissingLocalityPrompt: jest.fn().mockResolvedValue("missing-locality"),
  replyWithAddressPromptWindow: jest.fn().mockResolvedValue("address-prompt"),
  replyWithAddressConfirmationWindow: jest
    .fn()
    .mockResolvedValue("address-confirmation"),
  routeAddressCompleteness: jest.fn().mockResolvedValue(null),
  handleAddressExistingCandidate: jest.fn().mockResolvedValue(null),
  buildSideQuestionReply: jest.fn().mockResolvedValue(null),
  ...overrides,
});

const buildParams = () => ({
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  displayName: "Acme HVAC",
  currentEventId: "evt-2",
  normalizedSpeech: "hello",
  confidence: 0.9,
  addressState: defaultAddressState,
  nameState: defaultNameState,
  nameReady: true,
  collectedData: null,
  expectedField: null as string | null,
  openingAddressPreface: null as string | null,
  strategy: undefined,
  timingCollector: { aiMs: 0, aiCalls: 0 },
});

describe("VoiceTurnAddressRoutingRuntime", () => {
  it("defer-routes immediately when address state is FAILED", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressRoutingRuntime(policy);

    const result = await runtime.handleNotReady({
      ...buildParams(),
      addressState: {
        ...defaultAddressState,
        status: "FAILED",
      },
    });

    expect(result).toBe("defer");
    expect(policy.deferAddressToSmsAuthority).toHaveBeenCalled();
  });

  it("uses opening address preface for first address ask", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressRoutingRuntime(policy);

    const result = await runtime.handleNotReady({
      ...buildParams(),
      openingAddressPreface: "Thanks, Taylor. I heard your furnace issue.",
    });

    expect(result).toBe("listening");
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "address",
      }),
    );
  });

  it("routes missing-locality continuation through locality prompt", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressRoutingRuntime(policy);

    const result = await runtime.handleNotReady({
      ...buildParams(),
      normalizedSpeech: "uh",
      addressState: {
        ...defaultAddressState,
        candidate: "123 Main St",
        needsLocality: true,
        houseNumber: "123",
        street: "Main St",
      },
    });

    expect(result).toBe("missing-locality");
    expect(policy.handleMissingLocalityPrompt).toHaveBeenCalled();
  });

  it("routes candidate-for-event through completeness check and confirmation", async () => {
    const policy = buildPolicy({
      routeAddressCompleteness: jest.fn().mockResolvedValue(null),
    });
    const runtime = new VoiceTurnAddressRoutingRuntime(policy);

    const result = await runtime.handleNotReady({
      ...buildParams(),
      addressState: {
        ...defaultAddressState,
        candidate: "123 Main St, Cleveland, OH 44113",
        sourceEventId: "evt-2",
      },
    });

    expect(result).toBe("address-confirmation");
    expect(policy.routeAddressCompleteness).toHaveBeenCalled();
    expect(policy.replyWithAddressConfirmationWindow).toHaveBeenCalled();
  });

  it("returns existing candidate handler response when present", async () => {
    const policy = buildPolicy({
      handleAddressExistingCandidate: jest.fn().mockResolvedValue(
        "existing-handled",
      ),
    });
    const runtime = new VoiceTurnAddressRoutingRuntime(policy);

    const result = await runtime.handleNotReady({
      ...buildParams(),
      addressState: {
        ...defaultAddressState,
        candidate: "123 Main St",
        sourceEventId: "evt-0",
      },
    });

    expect(result).toBe("existing-handled");
    expect(policy.handleAddressExistingCandidate).toHaveBeenCalled();
  });

  it("returns null when no pre-extraction route applies", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressRoutingRuntime(policy);

    const result = await runtime.handleNotReady(buildParams());

    expect(result).toBeNull();
  });
});
