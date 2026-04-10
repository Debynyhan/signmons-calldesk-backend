import { VoiceTurnSideQuestionRuntime } from "../voice-turn-side-question.runtime";

type SideQuestionPolicy = ConstructorParameters<
  typeof VoiceTurnSideQuestionRuntime
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
};

const buildPolicy = (
  overrides: Partial<SideQuestionPolicy> = {},
): SideQuestionPolicy => ({
  resolveBinaryUtterance: jest.fn().mockReturnValue(null),
  isFrustrationRequest: jest.fn().mockReturnValue(false),
  clearVoiceListeningWindow: jest.fn().mockResolvedValue(undefined),
  replyWithSideQuestionAndContinue: jest.fn().mockResolvedValue(null),
  getVoiceIssueCandidate: jest.fn().mockReturnValue(null),
  buildAskNameTwiml: jest.fn().mockReturnValue("ask-name"),
  prependPrefaceToGatherTwiml: jest
    .fn()
    .mockImplementation((preface: string, twiml: string) => `${preface} ${twiml}`),
  replyWithListeningWindow: jest.fn().mockResolvedValue("listen-reply"),
  buildAddressPromptForState: jest.fn().mockReturnValue("ask-address"),
  replyWithIssueCaptureRecovery: jest.fn().mockResolvedValue("issue-recovery"),
  continueAfterSideQuestionWithIssueRouting: jest
    .fn()
    .mockResolvedValue("side-question-routed"),
  buildSideQuestionReply: jest.fn().mockResolvedValue(null),
  updateVoiceUrgencyConfirmation: jest.fn().mockResolvedValue(null),
  buildUrgencyConfirmTwiml: jest.fn().mockReturnValue("urgency-confirm"),
  getVoiceNameCandidate: jest.fn().mockReturnValue("Taylor"),
  ...overrides,
});

const buildParams = () => ({
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  displayName: "Acme HVAC",
  normalizedSpeech: "hello",
  expectedField: null as null,
  nameReady: true,
  addressReady: true,
  nameState: defaultNameState,
  addressState: defaultAddressState,
  collectedData: null,
  currentEventId: "evt-1",
  shouldAskUrgencyConfirm: false,
  urgencyConfirmation: {
    askedAt: null,
    response: null as "YES" | "NO" | null,
    sourceEventId: null,
  },
  emergencyIssueContext: null,
});

describe("VoiceTurnSideQuestionRuntime", () => {
  it("continues when utterance is neither frustration nor side question", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnSideQuestionRuntime(policy);

    const result = await runtime.handle(buildParams());

    expect(result).toEqual({ kind: "continue" });
    expect(policy.replyWithListeningWindow).not.toHaveBeenCalled();
  });

  it("routes frustration to name prompt when name is not ready", async () => {
    const policy = buildPolicy({
      isFrustrationRequest: jest.fn().mockReturnValue(true),
    });
    const runtime = new VoiceTurnSideQuestionRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      normalizedSpeech: "you keep asking the same thing",
      nameReady: false,
      expectedField: "name",
    });

    expect(result).toEqual({ kind: "exit", value: "listen-reply" });
    expect(policy.buildAskNameTwiml).toHaveBeenCalled();
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "name",
      }),
    );
  });

  it("routes frustration to issue recovery when intake fields are ready but issue missing", async () => {
    const policy = buildPolicy({
      isFrustrationRequest: jest.fn().mockReturnValue(true),
      getVoiceIssueCandidate: jest.fn().mockReturnValue(null),
    });
    const runtime = new VoiceTurnSideQuestionRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      normalizedSpeech: "i already told you",
      nameReady: true,
      addressReady: true,
    });

    expect(result).toEqual({ kind: "exit", value: "issue-recovery" });
    expect(policy.replyWithIssueCaptureRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "frustration_missing_issue",
      }),
    );
  });

  it("handles late urgency yes/no confirmation before other side-question logic", async () => {
    const policy = buildPolicy({
      resolveBinaryUtterance: jest.fn().mockReturnValue("YES"),
    });
    const runtime = new VoiceTurnSideQuestionRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      normalizedSpeech: "yes",
      urgencyConfirmation: {
        askedAt: "2026-04-10T12:00:00.000Z",
        response: null,
        sourceEventId: "evt-prior",
      },
    });

    expect(result).toEqual({ kind: "exit", value: "side-question-routed" });
    expect(policy.updateVoiceUrgencyConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        urgencyConfirmation: expect.objectContaining({
          response: "YES",
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
        sideQuestionReply: "Thanks. We'll treat this as urgent.",
      }),
    );
  });

  it("prefaces urgency confirmation when side question exists and urgency confirmation is needed", async () => {
    const policy = buildPolicy({
      buildSideQuestionReply: jest
        .fn()
        .mockResolvedValue("The service fee is $125."),
    });
    const runtime = new VoiceTurnSideQuestionRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      normalizedSpeech: "how much does this cost",
      shouldAskUrgencyConfirm: true,
      emergencyIssueContext: "no heat",
    });

    expect(result).toEqual({ kind: "exit", value: "listen-reply" });
    expect(policy.updateVoiceUrgencyConfirmation).toHaveBeenCalled();
    expect(policy.prependPrefaceToGatherTwiml).toHaveBeenCalledWith(
      "The service fee is $125.",
      "urgency-confirm",
    );
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "confirmation",
        targetField: "urgency_confirm",
      }),
    );
  });

  it("asks urgency confirmation even without side question when planner requires it", async () => {
    const policy = buildPolicy({
      buildSideQuestionReply: jest.fn().mockResolvedValue(null),
    });
    const runtime = new VoiceTurnSideQuestionRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      shouldAskUrgencyConfirm: true,
      emergencyIssueContext: "no cooling",
    });

    expect(result).toEqual({ kind: "exit", value: "listen-reply" });
    expect(policy.updateVoiceUrgencyConfirmation).toHaveBeenCalled();
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "confirmation",
        targetField: "urgency_confirm",
        twiml: "urgency-confirm",
      }),
    );
  });
});
