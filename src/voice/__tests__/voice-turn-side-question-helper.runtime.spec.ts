import { VoiceTurnSideQuestionHelperRuntime } from "../voice-turn-side-question-helper.runtime";

type HelperPolicy = ConstructorParameters<
  typeof VoiceTurnSideQuestionHelperRuntime
>[0];

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

const buildPolicy = (overrides: Partial<HelperPolicy> = {}): HelperPolicy => ({
  normalizeWhitespace: jest
    .fn()
    .mockImplementation((value: string) => value.replace(/\s+/g, " ").trim()),
  stripConfirmationPrefix: jest
    .fn()
    .mockImplementation((value: string) => value),
  isLikelyQuestion: jest.fn().mockReturnValue(true),
  getTenantFeePolicySafe: jest.fn().mockResolvedValue({
    serviceFeeCents: 12500,
    emergencyFeeCents: 0,
    creditWindowHours: 24,
  }),
  getTenantFeeConfig: jest.fn().mockReturnValue({
    serviceFee: 125,
    emergencyFee: null,
    creditWindowHours: 24,
  }),
  formatFeeAmount: jest.fn().mockImplementation((value: number) => `$${value}`),
  getTenantDisplayNameById: jest.fn().mockResolvedValue("Acme HVAC"),
  buildAskNameTwiml: jest.fn().mockReturnValue("ask-name"),
  prependPrefaceToGatherTwiml: jest
    .fn()
    .mockImplementation((preface: string, twiml: string) => `${preface} ${twiml}`),
  replyWithListeningWindow: jest.fn().mockResolvedValue("listen-reply"),
  buildAddressPromptForState: jest.fn().mockReturnValue("ask-address"),
  buildAskSmsNumberTwiml: jest.fn().mockReturnValue("ask-sms"),
  buildBookingPromptTwiml: jest.fn().mockReturnValue("ask-booking"),
  buildCallbackOfferTwiml: jest.fn().mockReturnValue("ask-callback"),
  ...overrides,
});

describe("VoiceTurnSideQuestionHelperRuntime", () => {
  it("returns fee explanation for fee questions", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnSideQuestionHelperRuntime(policy);

    const reply = await runtime.buildSideQuestionReply(
      "tenant-1",
      "How much is the service fee?",
    );

    expect(reply).toContain("The service fee is $125");
    expect(policy.getTenantFeePolicySafe).toHaveBeenCalledWith("tenant-1");
  });

  it("returns dispatcher response for identity questions", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnSideQuestionHelperRuntime(policy);

    const reply = await runtime.buildSideQuestionReply(
      "tenant-1",
      "Who am I speaking with?",
    );

    expect(reply).toBe("You're speaking with the dispatcher at Acme HVAC.");
    expect(policy.getTenantDisplayNameById).toHaveBeenCalledWith("tenant-1");
  });

  it("returns null for non-questions", async () => {
    const policy = buildPolicy({
      isLikelyQuestion: jest.fn().mockReturnValue(false),
    });
    const runtime = new VoiceTurnSideQuestionHelperRuntime(policy);

    const reply = await runtime.buildSideQuestionReply(
      "tenant-1",
      "the heater is not working",
    );

    expect(reply).toBeNull();
  });

  it("routes side-question preface to booking follow-up", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnSideQuestionHelperRuntime(policy);

    const result = await runtime.replyWithSideQuestionAndContinue({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      sideQuestionReply: "Yes, we can help.",
      expectedField: "booking",
      nameReady: true,
      addressReady: true,
      addressState: defaultAddressState,
      currentEventId: "evt-1",
    });

    expect(result).toBe("listen-reply");
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "confirmation",
        targetField: "booking",
      }),
    );
  });

  it("routes side-question preface to name when name is not ready", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnSideQuestionHelperRuntime(policy);

    const result = await runtime.replyWithSideQuestionAndContinue({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      sideQuestionReply: "Sure.",
      expectedField: "name",
      nameReady: false,
      addressReady: false,
      addressState: defaultAddressState,
      currentEventId: "evt-2",
    });

    expect(result).toBe("listen-reply");
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "name",
      }),
    );
  });
});
