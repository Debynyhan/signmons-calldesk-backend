import { VoiceTurnSideQuestionRoutingRuntime } from "../voice-turn-side-question-routing.runtime";

type RoutingPolicy = ConstructorParameters<
  typeof VoiceTurnSideQuestionRoutingRuntime
>[0];

const defaultNameState = {
  candidate: {
    value: "Taylor Smith",
    sourceEventId: "evt-1",
    createdAt: "2026-04-09T00:00:00.000Z",
  },
  confirmed: {
    value: "Taylor Smith",
    sourceEventId: "evt-1",
    createdAt: "2026-04-09T00:00:00.000Z",
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
  status: "CONFIRMED" as const,
  candidate: "123 Main St, Cleveland, OH 44113",
  confidence: 0.9,
  sourceEventId: "evt-2",
  attemptCount: 1,
  confirmed: "123 Main St, Cleveland, OH 44113",
  correctedFrom: null,
  needsLocalityCheck: false,
  localityMergeAttemptedAt: null,
  lastPromptedAt: null,
  locked: true,
  smsConfirmNeeded: false,
};

const buildPolicy = (
  overrides: Partial<RoutingPolicy> = {},
): RoutingPolicy => ({
  replyWithSideQuestionAndContinue: jest.fn().mockResolvedValue(null),
  getVoiceIssueCandidate: jest.fn().mockReturnValue(null),
  clearIssuePromptAttempts: jest.fn(),
  shouldDiscloseFees: jest.fn().mockReturnValue(true),
  getTenantFeePolicySafe: jest.fn().mockResolvedValue({ serviceFeeCents: 12500 }),
  buildSmsHandoffMessageForContext: jest.fn().mockReturnValue("sms-message"),
  isUrgencyEmergency: jest.fn().mockReturnValue(false),
  getVoiceNameCandidate: jest.fn().mockReturnValue("Taylor Smith"),
  replyWithSmsHandoff: jest.fn().mockResolvedValue("sms-handoff"),
  replyWithIssueCaptureRecovery: jest.fn().mockResolvedValue("issue-recovery"),
  replyWithTwiml: jest.fn().mockResolvedValue("fallback"),
  buildSayGatherTwiml: jest.fn().mockReturnValue("how-can-i-help"),
  ...overrides,
});

const buildParams = () => ({
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  displayName: "Acme HVAC",
  sideQuestionReply: "Sure.",
  expectedField: null as null,
  nameReady: true,
  addressReady: true,
  nameState: defaultNameState,
  addressState: defaultAddressState,
  collectedData: null,
  currentEventId: "evt-3",
});

describe("VoiceTurnSideQuestionRoutingRuntime", () => {
  it("returns immediate follow-up when side question continuation handles the turn", async () => {
    const policy = buildPolicy({
      replyWithSideQuestionAndContinue: jest.fn().mockResolvedValue("follow-up"),
    });
    const runtime = new VoiceTurnSideQuestionRoutingRuntime(policy);

    const result = await runtime.continueAfterSideQuestionWithIssueRouting(
      buildParams(),
    );

    expect(result).toBe("follow-up");
    expect(policy.replyWithIssueCaptureRecovery).not.toHaveBeenCalled();
    expect(policy.replyWithSmsHandoff).not.toHaveBeenCalled();
  });

  it("routes to sms handoff when issue already exists and intake fields are ready", async () => {
    const policy = buildPolicy({
      getVoiceIssueCandidate: jest
        .fn()
        .mockReturnValue({ value: "no heat", sourceEventId: "evt-2" }),
    });
    const runtime = new VoiceTurnSideQuestionRoutingRuntime(policy);

    const result = await runtime.continueAfterSideQuestionWithIssueRouting(
      buildParams(),
    );

    expect(result).toBe("sms-handoff");
    expect(policy.clearIssuePromptAttempts).toHaveBeenCalledWith("CA123");
    expect(policy.replyWithSmsHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "post_side_question_sms_handoff",
      }),
    );
  });

  it("falls back to issue recovery when no issue candidate exists", async () => {
    const policy = buildPolicy({
      getVoiceIssueCandidate: jest.fn().mockReturnValue(null),
    });
    const runtime = new VoiceTurnSideQuestionRoutingRuntime(policy);

    const result = await runtime.continueAfterSideQuestionWithIssueRouting(
      buildParams(),
    );

    expect(result).toBe("issue-recovery");
    expect(policy.replyWithIssueCaptureRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "missing_issue_post_side_question",
      }),
    );
  });
});
