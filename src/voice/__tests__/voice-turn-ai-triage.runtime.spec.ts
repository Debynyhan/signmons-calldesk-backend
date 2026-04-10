import { VoiceTurnAiTriageRuntime } from "../voice-turn-ai-triage.runtime";

type AiTriagePolicy = ConstructorParameters<typeof VoiceTurnAiTriageRuntime>[0];

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
  overrides: Partial<AiTriagePolicy> = {},
): AiTriagePolicy => ({
  getVoiceIssueCandidate: jest.fn().mockReturnValue(null),
  clearIssuePromptAttempts: jest.fn(),
  normalizeIssueCandidate: jest
    .fn()
    .mockImplementation((value: string) => value.trim().toLowerCase()),
  isLikelyIssueCandidate: jest.fn().mockReturnValue(false),
  updateVoiceIssueCandidate: jest.fn().mockResolvedValue(null),
  replyWithIssueCaptureRecovery: jest.fn().mockResolvedValue("issue-recovery"),
  isIssueRepeatComplaint: jest.fn().mockReturnValue(false),
  triage: jest
    .fn()
    .mockResolvedValue({ status: "reply", reply: "Sure, I can help." }),
  buildSmsHandoffMessage: jest.fn().mockReturnValue("We'll text you shortly."),
  shouldDiscloseFees: jest.fn().mockReturnValue(true),
  getTenantFeePolicySafe: jest.fn().mockResolvedValue({ serviceFeeCents: 12500 }),
  buildSmsHandoffMessageForContext: jest.fn().mockReturnValue("sms-message"),
  isUrgencyEmergency: jest.fn().mockReturnValue(false),
  getVoiceNameCandidate: jest.fn().mockReturnValue("Taylor Smith"),
  replyWithSmsHandoff: jest.fn().mockResolvedValue("sms-handoff"),
  normalizeConfirmationUtterance: jest
    .fn()
    .mockImplementation((value: string) => value.toLowerCase()),
  replyWithTwiml: jest.fn().mockResolvedValue("twiml-reply"),
  buildSayGatherTwiml: jest
    .fn()
    .mockImplementation((message: string) => `twiml:${message}`),
  isHumanFallbackMessage: jest.fn().mockReturnValue(false),
  replyWithHumanFallback: jest.fn().mockResolvedValue("human-fallback"),
  isLikelyQuestion: jest.fn().mockReturnValue(false),
  isBookingIntent: jest.fn().mockReturnValue(false),
  replyWithBookingOffer: jest.fn().mockResolvedValue("booking-offer"),
  logVoiceOutcome: jest.fn(),
  buildTwiml: jest.fn().mockImplementation((message: string) => `twiml:${message}`),
  replyWithNoHandoff: jest.fn().mockResolvedValue("no-handoff"),
  warn: jest.fn(),
  loggerContext: "VoiceTurnService",
  ...overrides,
});

const buildParams = () => ({
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  displayName: "Acme HVAC",
  normalizedSpeech: "no heat in the house",
  currentEventId: "evt-3",
  nameReady: true,
  addressReady: true,
  nameState: defaultNameState,
  addressState: defaultAddressState,
  collectedData: null,
  shouldPromptForIssue: false,
});

describe("VoiceTurnAiTriageRuntime", () => {
  it("asks issue recovery when issue is missing and planner requires issue prompt", async () => {
    const policy = buildPolicy({
      isLikelyIssueCandidate: jest.fn().mockReturnValue(false),
    });
    const runtime = new VoiceTurnAiTriageRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      normalizedSpeech: "okay",
      shouldPromptForIssue: true,
    });

    expect(result).toBe("issue-recovery");
    expect(policy.replyWithIssueCaptureRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "missing_issue_after_address",
      }),
    );
    expect(policy.triage).not.toHaveBeenCalled();
  });

  it("routes ai sms handoff replies to sms closure", async () => {
    const policy = buildPolicy({
      getVoiceIssueCandidate: jest
        .fn()
        .mockReturnValue({ value: "no heat", sourceEventId: "evt-1" }),
      triage: jest.fn().mockResolvedValue({
        status: "reply",
        reply: "We'll text you shortly.",
      }),
      buildSmsHandoffMessage: jest.fn().mockReturnValue("We'll text you shortly."),
    });
    const runtime = new VoiceTurnAiTriageRuntime(policy);

    const result = await runtime.handle(buildParams());

    expect(result).toBe("sms-handoff");
    expect(policy.replyWithSmsHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "ai_sms_handoff",
      }),
    );
  });

  it("routes question replies to booking offer when appropriate", async () => {
    const policy = buildPolicy({
      getVoiceIssueCandidate: jest
        .fn()
        .mockReturnValue({ value: "no heat", sourceEventId: "evt-1" }),
      isLikelyQuestion: jest.fn().mockReturnValue(true),
      isBookingIntent: jest.fn().mockReturnValue(false),
      triage: jest.fn().mockResolvedValue({
        status: "reply",
        reply: "We can definitely help with that.",
      }),
    });
    const runtime = new VoiceTurnAiTriageRuntime(policy);

    const result = await runtime.handle({
      ...buildParams(),
      normalizedSpeech: "can you help",
    });

    expect(result).toBe("booking-offer");
    expect(policy.replyWithBookingOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "We can definitely help with that.",
      }),
    );
  });

  it("falls back gracefully when triage throws", async () => {
    const policy = buildPolicy({
      triage: jest.fn().mockRejectedValue(new Error("boom")),
    });
    const runtime = new VoiceTurnAiTriageRuntime(policy);

    const result = await runtime.handle(buildParams());

    expect(result).toBe("human-fallback");
    expect(policy.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai.preview_fallback",
      }),
      "VoiceTurnService",
    );
    expect(policy.replyWithHumanFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "ai_preview_fallback",
      }),
    );
  });
});
