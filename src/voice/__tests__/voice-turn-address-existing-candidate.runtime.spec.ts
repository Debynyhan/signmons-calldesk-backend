import { VoiceTurnAddressExistingCandidateRuntime } from "../voice-turn-address-existing-candidate.runtime";

type AddressExistingPolicy = ConstructorParameters<
  typeof VoiceTurnAddressExistingCandidateRuntime
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
  status: "CANDIDATE" as const,
  candidate: "123 Main St, Cleveland, OH 44113",
  confidence: 0.9,
  sourceEventId: "evt-2",
  attemptCount: 0,
  confirmed: null,
  correctedFrom: null,
  needsLocalityCheck: false,
  localityMergeAttemptedAt: null,
  lastPromptedAt: null,
  locked: false,
  smsConfirmNeeded: false,
  needsLocality: false,
  houseNumber: "123",
  street: "Main St",
  city: "Cleveland",
  state: "OH",
  zip: "44113",
};

const buildPolicy = (
  overrides: Partial<AddressExistingPolicy> = {},
): AddressExistingPolicy => ({
  sanitizer: {
    sanitizeText: (value: string) => value,
    normalizeWhitespace: (value: string) => value.replace(/\s+/g, " ").trim(),
  },
  updateVoiceAddressState: jest.fn().mockResolvedValue(undefined),
  replyWithAddressConfirmationWindow: jest
    .fn()
    .mockResolvedValue("address-confirmation"),
  isSoftConfirmationEligible: jest.fn().mockReturnValue(false),
  replyWithListeningWindow: jest.fn().mockResolvedValue("listening"),
  buildAddressSoftConfirmationTwiml: jest
    .fn()
    .mockReturnValue("soft-confirm"),
  resolveConfirmation: jest.fn().mockReturnValue({ outcome: "UNKNOWN" }),
  routeAddressCompleteness: jest.fn().mockResolvedValue(null),
  handleAddressConfirmedContinuation: jest
    .fn()
    .mockResolvedValue("confirmed-continuation"),
  deferAddressToSmsAuthority: jest.fn().mockResolvedValue("defer"),
  replyWithAddressPromptWindow: jest.fn().mockResolvedValue("address-prompt"),
  buildYesNoRepromptTwiml: jest.fn().mockReturnValue("yes-no"),
  ...overrides,
});

const buildParams = () => ({
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  displayName: "Acme HVAC",
  currentEventId: "evt-3",
  normalizedSpeech: "yes",
  confidence: 0.9,
  addressState: defaultAddressState,
  nameState: defaultNameState,
  nameReady: true,
  collectedData: null,
  strategy: undefined,
  timingCollector: { aiMs: 0, aiCalls: 0 },
});

describe("VoiceTurnAddressExistingCandidateRuntime", () => {
  it("returns null when no candidate exists", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressExistingCandidateRuntime(policy);

    const result = await runtime.handleAddressExistingCandidate({
      ...buildParams(),
      addressState: {
        ...defaultAddressState,
        candidate: null,
      },
    });

    expect(result).toBeNull();
  });

  it("handles locality correction and returns confirmation window", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressExistingCandidateRuntime(policy);

    const result = await runtime.handleAddressExistingCandidate({
      ...buildParams(),
      normalizedSpeech: "actually in Lakewood",
    });

    expect(result).toBe("address-confirmation");
    expect(policy.updateVoiceAddressState).toHaveBeenCalled();
    expect(policy.replyWithAddressConfirmationWindow).toHaveBeenCalled();
  });

  it("routes confirm outcomes through completeness and continuation", async () => {
    const policy = buildPolicy({
      resolveConfirmation: jest.fn().mockReturnValue({ outcome: "CONFIRM" }),
      routeAddressCompleteness: jest.fn().mockResolvedValue(null),
    });
    const runtime = new VoiceTurnAddressExistingCandidateRuntime(policy);

    const result = await runtime.handleAddressExistingCandidate(buildParams());

    expect(result).toBe("confirmed-continuation");
    expect(policy.routeAddressCompleteness).toHaveBeenCalled();
    expect(policy.handleAddressConfirmedContinuation).toHaveBeenCalled();
  });

  it("routes reject fail-closed outcomes to sms defer", async () => {
    const policy = buildPolicy({
      resolveConfirmation: jest.fn().mockReturnValue({ outcome: "REJECT" }),
    });
    const runtime = new VoiceTurnAddressExistingCandidateRuntime(policy);

    const result = await runtime.handleAddressExistingCandidate({
      ...buildParams(),
      addressState: {
        ...defaultAddressState,
        attemptCount: 1,
      },
    });

    expect(result).toBe("defer");
    expect(policy.deferAddressToSmsAuthority).toHaveBeenCalled();
  });
});
