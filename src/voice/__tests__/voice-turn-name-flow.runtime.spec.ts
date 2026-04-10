import { VoiceTurnNameFlowRuntime } from "../voice-turn-name-flow.runtime";

type NameFlowPolicy = ConstructorParameters<typeof VoiceTurnNameFlowRuntime>[0];

const baseNameState = {
  candidate: {
    value: "David Johnson",
    sourceEventId: "evt-1",
    createdAt: "2026-04-10T00:00:00.000Z",
  },
  confirmed: {
    value: null,
    sourceEventId: null,
    createdAt: null,
  },
  status: "PROVISIONAL" as const,
  attemptCount: 0,
  lastPromptedAt: null,
  lastConfidence: 0.92,
  locked: false,
  corrections: 0,
  firstNameSpelled: null,
  spellPromptedAt: null,
  spellPromptedTurnIndex: null,
  spellPromptCount: 0,
};

const buildPolicy = (
  overrides: Partial<NameFlowPolicy> = {},
): NameFlowPolicy => ({
  updateVoiceNameState: jest.fn().mockResolvedValue(undefined),
  shouldRepromptForLowConfidenceName: jest.fn().mockReturnValue(false),
  buildNameClarificationPrompt: jest
    .fn()
    .mockReturnValue("Can you repeat your name?"),
  shouldPromptForNameSpelling: jest.fn().mockReturnValue(false),
  applyCsrStrategy: jest
    .fn()
    .mockImplementation((_, message: string) => message),
  buildSayGatherTwiml: jest
    .fn()
    .mockImplementation((message: string) => message),
  replyWithListeningWindow: jest.fn().mockResolvedValue("listen"),
  log: jest.fn(),
  ...overrides,
});

const buildSession = (policy: NameFlowPolicy) =>
  new VoiceTurnNameFlowRuntime(policy).createSession({
    tenantId: "tenant-1",
    conversationId: "conversation-1",
    callSid: "CA123",
    currentEventId: "evt-2",
    strategy: undefined,
    turnIndex: 3,
    nameState: { ...baseNameState },
    existingIssueSummary: "no heat",
    buildSpellNameTwiml: () => "<Response>Spell</Response>",
  });

describe("VoiceTurnNameFlowRuntime", () => {
  it("routes to address prompt when no low-confidence reprompt is needed", async () => {
    const policy = buildPolicy();
    const session = buildSession(policy);

    const result = await session.replyWithAddressPrompt();

    expect(result).toBe("listen");
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "address",
        timeoutSec: 8,
      }),
    );
  });

  it("routes to name clarification when low-confidence reprompt is needed", async () => {
    const policy = buildPolicy({
      shouldRepromptForLowConfidenceName: jest.fn().mockReturnValue(true),
    });
    const session = buildSession(policy);

    const result = await session.replyWithAddressPrompt();

    expect(result).toBe("listen");
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "name",
      }),
    );
  });

  it("stores provisional names and exposes updated state", async () => {
    const policy = buildPolicy();
    const session = buildSession(policy);

    await session.storeProvisionalName("Taylor Rivera");

    expect(policy.updateVoiceNameState).toHaveBeenCalled();
    expect(session.getNameState().candidate.value).toBe("Taylor Rivera");
  });

  it("prompts for spelling and replies with name listening window", async () => {
    const policy = buildPolicy();
    const session = buildSession(policy);

    const result = await session.promptForNameSpelling(
      "David Johnson",
      session.getNameState(),
    );

    expect(result).toBe("listen");
    expect(policy.replyWithListeningWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "name",
        twiml: "<Response>Spell</Response>",
      }),
    );
    expect(policy.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "nameCapture.spellPrompted",
      }),
    );
  });
});
