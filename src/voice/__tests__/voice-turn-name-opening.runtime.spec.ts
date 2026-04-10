import { VoiceTurnNameOpeningRuntime } from "../voice-turn-name-opening.runtime";

type NameOpeningPolicy = ConstructorParameters<
  typeof VoiceTurnNameOpeningRuntime
>[0];

const defaultNameState = {
  candidate: {
    value: null,
    sourceEventId: null,
    createdAt: null,
  },
  confirmed: {
    value: null,
    sourceEventId: null,
    createdAt: null,
  },
  status: "MISSING" as const,
  attemptCount: 0,
  lastPromptedAt: null,
  lastConfidence: null,
  locked: false,
  corrections: 0,
  firstNameSpelled: null,
  spellPromptedAt: null,
  spellPromptedTurnIndex: null,
  spellPromptCount: 0,
};

const buildPolicy = (
  overrides: Partial<NameOpeningPolicy> = {},
): NameOpeningPolicy => ({
  isOpeningGreetingOnly: jest.fn().mockReturnValue(false),
  extractNameCandidateDeterministic: jest.fn().mockReturnValue(null),
  normalizeIssueCandidate: jest
    .fn()
    .mockImplementation((value: string) => value.trim().toLowerCase()),
  isLikelyIssueCandidate: jest.fn().mockReturnValue(false),
  clearIssuePromptAttempts: jest.fn(),
  updateVoiceIssueCandidate: jest.fn().mockResolvedValue(null),
  buildIssueAcknowledgement: jest.fn().mockReturnValue("your furnace issue"),
  buildSideQuestionReply: jest.fn().mockResolvedValue(null),
  replyWithBookingOffer: jest.fn().mockResolvedValue("booking-offer"),
  buildSayGatherTwiml: jest
    .fn()
    .mockImplementation((message: string) => `twiml:${message}`),
  applyCsrStrategy: jest
    .fn()
    .mockImplementation((_: unknown, message: string) => message),
  ...overrides,
});

const buildParams = () => ({
  isOpeningTurn: true,
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  currentEventId: "evt-1",
  normalizedSpeech: "hello",
  bookingIntent: false,
  nameState: defaultNameState,
  confidence: 0.8,
  strategy: undefined,
  storeProvisionalName: jest.fn().mockResolvedValue({
    ...defaultNameState,
    candidate: {
      value: "Taylor Smith",
      sourceEventId: "evt-1",
      createdAt: "2026-04-10T00:00:00.000Z",
    },
    status: "CANDIDATE" as const,
    attemptCount: 1,
  }),
  maybePromptForSpelling: jest.fn().mockResolvedValue("spell-flow"),
  replyWithNameTwiml: jest.fn().mockResolvedValue("name-flow"),
});

describe("VoiceTurnNameOpeningRuntime", () => {
  it("returns null when this is not an opening turn", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnNameOpeningRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      isOpeningTurn: false,
    });

    expect(result).toBeNull();
    expect(policy.extractNameCandidateDeterministic).not.toHaveBeenCalled();
  });

  it("prompts caller for name and issue on greeting-only opening", async () => {
    const policy = buildPolicy({
      isOpeningGreetingOnly: jest.fn().mockReturnValue(true),
    });
    const runtime = new VoiceTurnNameOpeningRuntime(policy);

    const result = await runtime.handle(buildParams());

    expect(result).toBe("name-flow");
    expect(policy.buildSayGatherTwiml).toHaveBeenCalledWith(
      expect.stringContaining("Please say your full name"),
    );
  });

  it("captures issue + opening name and forwards to spelling flow", async () => {
    const policy = buildPolicy({
      extractNameCandidateDeterministic: jest
        .fn()
        .mockReturnValue("Taylor Smith"),
      normalizeIssueCandidate: jest.fn().mockReturnValue("no heat in house"),
      isLikelyIssueCandidate: jest.fn().mockReturnValue(true),
      buildIssueAcknowledgement: jest.fn().mockReturnValue("your no heat issue"),
    });
    const runtime = new VoiceTurnNameOpeningRuntime(policy);
    const params = buildParams();

    const result = await runtime.handle({
      ...params,
      normalizedSpeech: "my name is taylor and i have no heat",
    });

    expect(result).toBe("spell-flow");
    expect(policy.updateVoiceIssueCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({
          value: "no heat in house",
        }),
      }),
    );
    expect(params.storeProvisionalName).toHaveBeenCalledWith(
      "Taylor Smith",
      expect.objectContaining({
        corrections: 0,
      }),
    );
  });

  it("routes side questions to booking offer during opening turn", async () => {
    const policy = buildPolicy({
      buildSideQuestionReply: jest
        .fn()
        .mockResolvedValue("The service fee is $125."),
    });
    const runtime = new VoiceTurnNameOpeningRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      normalizedSpeech: "how much is it",
    });

    expect(result).toBe("booking-offer");
    expect(policy.replyWithBookingOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "The service fee is $125.",
      }),
    );
  });
});
