import { VoiceTurnAddressCompletenessRuntime } from "../voice-turn-address-completeness.runtime";

type AddressCompletenessPolicy = ConstructorParameters<
  typeof VoiceTurnAddressCompletenessRuntime
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
  candidate: "123 Main St",
  confidence: 0.8,
  sourceEventId: "evt-2",
  attemptCount: 1,
  confirmed: null,
  correctedFrom: null,
  needsLocalityCheck: false,
  localityMergeAttemptedAt: null,
  lastPromptedAt: null,
  locked: false,
  smsConfirmNeeded: false,
  needsLocality: true,
  houseNumber: "123",
  street: "Main St",
  city: null,
  state: null,
  zip: null,
};

const buildPolicy = (
  overrides: Partial<AddressCompletenessPolicy> = {},
): AddressCompletenessPolicy => ({
  handleMissingLocalityPrompt: jest.fn().mockResolvedValue("missing-locality"),
  replyWithAddressPromptWindow: jest.fn().mockResolvedValue("address-prompt"),
  ...overrides,
});

const buildParams = () => ({
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  displayName: "Acme HVAC",
  currentEventId: "evt-2",
  addressState: defaultAddressState,
  candidateForCompleteness: defaultAddressState.candidate,
  nameState: defaultNameState,
  collectedData: null,
  strategy: undefined,
  timingCollector: { aiMs: 0, aiCalls: 0 },
});

describe("VoiceTurnAddressCompletenessRuntime", () => {
  it("routes missing locality to locality prompt", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressCompletenessRuntime(policy);

    const result = await runtime.routeAddressCompleteness(buildParams());

    expect(result).toBe("missing-locality");
    expect(policy.handleMissingLocalityPrompt).toHaveBeenCalled();
  });

  it("routes missing street/number to address prompt", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressCompletenessRuntime(policy);

    const result = await runtime.routeAddressCompleteness({
      ...buildParams(),
      addressState: {
        ...defaultAddressState,
        houseNumber: null,
        city: "Cleveland",
        state: "OH",
        zip: "44113",
        needsLocality: false,
      },
      candidateForCompleteness: "Main St, Cleveland OH 44113",
    });

    expect(result).toBe("address-prompt");
    expect(policy.replyWithAddressPromptWindow).toHaveBeenCalled();
  });

  it("returns null when address is complete", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressCompletenessRuntime(policy);

    const result = await runtime.routeAddressCompleteness({
      ...buildParams(),
      addressState: {
        ...defaultAddressState,
        city: "Cleveland",
        state: "OH",
        zip: "44113",
        needsLocality: false,
      },
      candidateForCompleteness: "123 Main St, Cleveland OH 44113",
    });

    expect(result).toBeNull();
  });
});
