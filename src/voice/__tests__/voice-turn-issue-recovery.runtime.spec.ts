import { VoiceTurnIssueRecoveryRuntime } from "../voice-turn-issue-recovery.runtime";

type IssueRecoveryPolicy = ConstructorParameters<
  typeof VoiceTurnIssueRecoveryRuntime
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
  overrides: Partial<IssueRecoveryPolicy> = {},
): IssueRecoveryPolicy => ({
  getVoiceIssueCandidate: jest.fn().mockReturnValue(null),
  normalizeIssueCandidate: jest
    .fn()
    .mockImplementation((value: string) => value.trim().toLowerCase()),
  buildFallbackIssueCandidate: jest.fn().mockReturnValue(null),
  isLikelyIssueCandidate: jest
    .fn()
    .mockImplementation((value: string) => value.includes("heat")),
  getIssuePromptAttempts: jest.fn().mockReturnValue(0),
  setIssuePromptAttempts: jest.fn(),
  clearIssuePromptAttempts: jest.fn(),
  isLikelyQuestion: jest.fn().mockReturnValue(false),
  updateVoiceIssueCandidate: jest.fn().mockResolvedValue(null),
  shouldDiscloseFees: jest.fn().mockReturnValue(true),
  getTenantFeePolicySafe: jest.fn().mockResolvedValue({ serviceFeeCents: 12500 }),
  buildSmsHandoffMessageForContext: jest.fn().mockReturnValue("sms-message"),
  isUrgencyEmergency: jest.fn().mockReturnValue(false),
  getVoiceNameCandidate: jest.fn().mockReturnValue("Taylor Smith"),
  replyWithSmsHandoff: jest.fn().mockResolvedValue("sms-handoff"),
  log: jest.fn(),
  buildSayGatherTwiml: jest
    .fn()
    .mockImplementation((message: string) => `twiml:${message}`),
  applyCsrStrategy: jest
    .fn()
    .mockImplementation((_: unknown, message: string) => message),
  replyWithTwiml: jest.fn().mockResolvedValue("prompt-reply"),
  loggerContext: "VoiceTurnService",
  ...overrides,
});

const buildParams = () => ({
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  displayName: "Acme HVAC",
  nameState: defaultNameState,
  addressState: defaultAddressState,
  collectedData: null,
  reason: "missing_issue",
});

describe("VoiceTurnIssueRecoveryRuntime", () => {
  it("captures detected issue and routes to sms handoff", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnIssueRecoveryRuntime(policy);

    const result = await runtime.replyWithIssueCaptureRecovery({
      ...buildParams(),
      transcript: "no heat in the house",
    });

    expect(result).toBe("sms-handoff");
    expect(policy.updateVoiceIssueCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({
          value: "no heat in the house",
          sourceEventId: expect.any(String),
          createdAt: expect.any(String),
        }),
      }),
    );
    expect(policy.replyWithSmsHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "missing_issue_captured",
        messageOverride: "sms-message",
      }),
    );
    expect(policy.clearIssuePromptAttempts).toHaveBeenCalledWith("CA123");
  });

  it("defers to sms after max reprompt is reached", async () => {
    const policy = buildPolicy({
      getIssuePromptAttempts: jest.fn().mockReturnValue(1),
      isLikelyIssueCandidate: jest.fn().mockReturnValue(false),
      buildFallbackIssueCandidate: jest.fn().mockReturnValue(null),
      normalizeIssueCandidate: jest.fn().mockReturnValue(""),
    });
    const runtime = new VoiceTurnIssueRecoveryRuntime(policy);

    const result = await runtime.replyWithIssueCaptureRecovery({
      ...buildParams(),
      transcript: "um",
    });

    expect(result).toBe("sms-handoff");
    expect(policy.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice.issue_capture_deferred_to_sms",
        reason: "missing_issue",
      }),
      "VoiceTurnService",
    );
    expect(policy.replyWithSmsHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "missing_issue_deferred_to_sms",
      }),
    );
    expect(policy.updateVoiceIssueCandidate).not.toHaveBeenCalled();
  });

  it("reprompts for issue when not captured and reprompts remain", async () => {
    const policy = buildPolicy({
      getIssuePromptAttempts: jest.fn().mockReturnValue(0),
      isLikelyIssueCandidate: jest.fn().mockReturnValue(false),
      buildFallbackIssueCandidate: jest.fn().mockReturnValue(null),
      normalizeIssueCandidate: jest.fn().mockReturnValue(""),
    });
    const runtime = new VoiceTurnIssueRecoveryRuntime(policy);

    const result = await runtime.replyWithIssueCaptureRecovery({
      ...buildParams(),
      transcript: "okay",
      promptPrefix: "I hear you.",
    });

    expect(result).toBe("prompt-reply");
    expect(policy.replyWithTwiml).toHaveBeenCalledWith(
      undefined,
      expect.stringContaining("In a few words, what's the main issue"),
    );
    expect(policy.replyWithSmsHandoff).not.toHaveBeenCalled();
  });
});
