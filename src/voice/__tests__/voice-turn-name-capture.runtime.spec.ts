import { VoiceTurnNameCaptureRuntime } from "../voice-turn-name-capture.runtime";

type NameCapturePolicy = ConstructorParameters<
  typeof VoiceTurnNameCaptureRuntime
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
  overrides: Partial<NameCapturePolicy> = {},
): NameCapturePolicy => ({
  normalizeIssueCandidate: jest
    .fn()
    .mockImplementation((value: string) => value.trim().toLowerCase()),
  isLikelyIssueCandidate: jest.fn().mockReturnValue(false),
  getVoiceIssueCandidate: jest.fn().mockReturnValue(null),
  updateVoiceIssueCandidate: jest.fn().mockResolvedValue(null),
  buildIssueAcknowledgement: jest.fn().mockReturnValue("your furnace issue"),
  buildSideQuestionReply: jest.fn().mockResolvedValue(null),
  replyWithBookingOffer: jest.fn().mockResolvedValue("booking-offer"),
  isLikelyAddressInputForName: jest.fn().mockReturnValue(false),
  extractNameCandidateDeterministic: jest.fn().mockReturnValue(null),
  extractNameCandidate: jest.fn().mockResolvedValue(null),
  normalizeNameCandidate: jest
    .fn()
    .mockImplementation((value: string) => value.trim()),
  isValidNameCandidate: jest.fn().mockReturnValue(true),
  isLikelyNameCandidate: jest.fn().mockReturnValue(true),
  shouldPromptForNameSpelling: jest.fn().mockReturnValue(false),
  buildAskNameTwiml: jest.fn().mockReturnValue("ask-name"),
  buildSayGatherTwiml: jest
    .fn()
    .mockImplementation((message: string) => `twiml:${message}`),
  applyCsrStrategy: jest
    .fn()
    .mockImplementation((_: unknown, message: string) => message),
  ...overrides,
});

const buildParams = () => ({
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  currentEventId: "evt-1",
  normalizedSpeech: "hello",
  expectedField: null as string | null,
  bookingIntent: false,
  nameState: defaultNameState,
  collectedData: null,
  confidence: 0.8,
  strategy: undefined,
  recordNameAttemptIfNeeded: jest.fn().mockResolvedValue(undefined),
  replyWithAddressPrompt: jest.fn().mockResolvedValue("address-prompt"),
  replyWithNameTwiml: jest.fn().mockResolvedValue("name-prompt"),
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
  promptForNameSpelling: jest.fn().mockResolvedValue("spell-prompt"),
  maybePromptForSpelling: jest.fn().mockResolvedValue("spell-flow"),
  acknowledgeNameAndMoveOn: jest.fn().mockResolvedValue("ack-flow"),
});

describe("VoiceTurnNameCaptureRuntime", () => {
  it("captures issue and asks name follow-up on first attempt", async () => {
    const policy = buildPolicy({
      isLikelyIssueCandidate: jest.fn().mockReturnValue(true),
      normalizeIssueCandidate: jest.fn().mockReturnValue("no heat"),
    });
    const runtime = new VoiceTurnNameCaptureRuntime(policy);
    const params = buildParams();

    const result = await runtime.handle({
      ...params,
      normalizedSpeech: "no heat in house",
    });

    expect(result).toBe("name-prompt");
    expect(policy.updateVoiceIssueCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({ value: "no heat" }),
      }),
    );
    expect(params.replyWithNameTwiml).toHaveBeenCalled();
  });

  it("routes side-question turns to booking offer", async () => {
    const policy = buildPolicy({
      buildSideQuestionReply: jest
        .fn()
        .mockResolvedValue("The service fee is $125."),
    });
    const runtime = new VoiceTurnNameCaptureRuntime(policy);

    const result = await runtime.handle(buildParams());

    expect(result).toBe("booking-offer");
    expect(policy.replyWithBookingOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "The service fee is $125.",
      }),
    );
  });

  it("handles validated candidate by storing and continuing spelling flow", async () => {
    const policy = buildPolicy({
      extractNameCandidateDeterministic: jest.fn().mockReturnValue("Taylor Smith"),
    });
    const runtime = new VoiceTurnNameCaptureRuntime(policy);
    const params = buildParams();

    const result = await runtime.handle(params);

    expect(result).toBe("spell-flow");
    expect(params.storeProvisionalName).toHaveBeenCalledWith(
      "Taylor Smith",
      expect.objectContaining({
        corrections: 0,
      }),
    );
    expect(params.maybePromptForSpelling).toHaveBeenCalled();
  });

  it("falls back to ask-name prompt when no signal is found", async () => {
    const policy = buildPolicy({
      isValidNameCandidate: jest.fn().mockReturnValue(false),
      isLikelyNameCandidate: jest.fn().mockReturnValue(false),
    });
    const runtime = new VoiceTurnNameCaptureRuntime(policy);
    const params = buildParams();

    const result = await runtime.handle(params);

    expect(result).toBe("name-prompt");
    expect(params.replyWithNameTwiml).toHaveBeenCalledWith("ask-name");
  });
});
