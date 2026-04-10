import { VoiceTurnAddressConfirmedRuntime } from "../voice-turn-address-confirmed.runtime";

type AddressConfirmedPolicy = ConstructorParameters<
  typeof VoiceTurnAddressConfirmedRuntime
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
  overrides: Partial<AddressConfirmedPolicy> = {},
): AddressConfirmedPolicy => ({
  updateVoiceAddressState: jest.fn().mockResolvedValue(undefined),
  clearVoiceListeningWindow: jest.fn().mockResolvedValue(undefined),
  getVoiceIssueCandidate: jest.fn().mockReturnValue({ value: "no heat" }),
  continueAfterSideQuestionWithIssueRouting: jest
    .fn()
    .mockResolvedValue("issue-routing"),
  buildSayGatherTwiml: jest
    .fn()
    .mockImplementation((message: string) => message),
  replyWithTwiml: jest.fn().mockResolvedValue("issue-prompt"),
  log: jest.fn(),
  ...overrides,
});

const buildParams = () => ({
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  displayName: "Acme HVAC",
  currentEventId: "evt-3",
  addressState: defaultAddressState,
  nameState: defaultNameState,
  nameReady: true,
  collectedData: null,
  strategy: undefined,
  timingCollector: { aiMs: 0, aiCalls: 0 },
});

describe("VoiceTurnAddressConfirmedRuntime", () => {
  it("locks and confirms address before routing when issue already exists", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnAddressConfirmedRuntime(policy);

    const result =
      await runtime.handleAddressConfirmedContinuation(buildParams());

    expect(result).toBe("issue-routing");
    expect(policy.updateVoiceAddressState).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmation: expect.objectContaining({
          field: "address",
          value: "123 Main St, Cleveland, OH 44113",
          channel: "VOICE",
        }),
        addressState: expect.objectContaining({
          locked: true,
        }),
      }),
    );
    expect(policy.clearVoiceListeningWindow).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
    expect(
      policy.continueAfterSideQuestionWithIssueRouting,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        sideQuestionReply: "Perfect, thanks for confirming that.",
        addressReady: true,
        expectedField: null,
      }),
    );
    expect(policy.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.field_confirmed",
        field: "address",
      }),
    );
  });

  it("prompts for issue when no issue candidate is available", async () => {
    const policy = buildPolicy({
      getVoiceIssueCandidate: jest.fn().mockReturnValue(null),
    });
    const runtime = new VoiceTurnAddressConfirmedRuntime(policy);

    const result =
      await runtime.handleAddressConfirmedContinuation(buildParams());

    expect(result).toBe("issue-prompt");
    expect(
      policy.continueAfterSideQuestionWithIssueRouting,
    ).not.toHaveBeenCalled();
    expect(policy.replyWithTwiml).toHaveBeenCalledWith(
      undefined,
      "Perfect, thanks for confirming that. Now tell me what's been going on with the system.",
    );
  });

  it("does not update address state again when already locked", async () => {
    const policy = buildPolicy({
      getVoiceIssueCandidate: jest.fn().mockReturnValue(null),
    });
    const runtime = new VoiceTurnAddressConfirmedRuntime(policy);

    await runtime.handleAddressConfirmedContinuation({
      ...buildParams(),
      addressState: {
        ...defaultAddressState,
        locked: true,
      },
    });

    expect(policy.updateVoiceAddressState).not.toHaveBeenCalled();
    expect(policy.clearVoiceListeningWindow).toHaveBeenCalledTimes(1);
  });
});
