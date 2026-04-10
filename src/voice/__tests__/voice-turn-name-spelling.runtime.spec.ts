import { VoiceTurnNameSpellingRuntime } from "../voice-turn-name-spelling.runtime";

type NameSpellingPolicy = ConstructorParameters<
  typeof VoiceTurnNameSpellingRuntime
>[0];

const baseNameState = {
  candidate: {
    value: "David Johnson",
    sourceEventId: "evt-candidate",
    createdAt: "2026-04-10T00:00:00.000Z",
  },
  confirmed: {
    value: null,
    sourceEventId: null,
    createdAt: null,
  },
  status: "PROVISIONAL" as const,
  attemptCount: 1,
  lastPromptedAt: null,
  lastConfidence: 0.86,
  locked: false,
  corrections: 0,
  firstNameSpelled: null,
  spellPromptedAt: Date.now(),
  spellPromptedTurnIndex: 1,
  spellPromptCount: 1,
};

const buildPolicy = (
  overrides: Partial<NameSpellingPolicy> = {},
): NameSpellingPolicy => ({
  parseSpelledNameParts: jest.fn().mockReturnValue({
    firstName: null,
    lastName: null,
    letterCount: 0,
    reason: "unknown",
  }),
  extractNameCandidateDeterministic: jest.fn().mockReturnValue(null),
  normalizeNameCandidate: jest.fn().mockImplementation((value: string) => value),
  isValidNameCandidate: jest.fn().mockReturnValue(true),
  isLikelyNameCandidate: jest.fn().mockReturnValue(true),
  updateVoiceNameState: jest.fn().mockResolvedValue(undefined),
  log: jest.fn(),
  ...overrides,
});

const buildParams = () => ({
  normalizedSpeech: "D A V I D",
  nameState: { ...baseNameState },
  confidence: 0.9,
  turnIndex: 2,
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  callSid: "CA123",
  storeProvisionalName: jest.fn().mockResolvedValue({ ...baseNameState }),
  acknowledgeNameAndMoveOn: jest.fn().mockResolvedValue("ack"),
  replyWithNameTwiml: jest.fn().mockResolvedValue("spell-reprompt"),
  replyWithAddressPrompt: jest.fn().mockResolvedValue("address-prompt"),
  buildSpellNameTwiml: jest.fn().mockReturnValue("<Response>Spell</Response>"),
});

describe("VoiceTurnNameSpellingRuntime", () => {
  it("returns null when no spelling prompt is active", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnNameSpellingRuntime(policy);
    const params = buildParams();

    const result = await runtime.handle({
      ...params,
      nameState: {
        ...params.nameState,
        spellPromptedAt: null,
      },
    });

    expect(result).toBeNull();
    expect(policy.parseSpelledNameParts).not.toHaveBeenCalled();
  });

  it("parses spelled first/last name and acknowledges", async () => {
    const policy = buildPolicy({
      parseSpelledNameParts: jest.fn().mockReturnValue({
        firstName: "David",
        lastName: "Johnson",
        letterCount: 11,
      }),
    });
    const runtime = new VoiceTurnNameSpellingRuntime(policy);
    const params = buildParams();

    const result = await runtime.handle(params);

    expect(result).toBe("ack");
    expect(params.storeProvisionalName).toHaveBeenCalledWith(
      "David Johnson",
      expect.objectContaining({
        firstNameSpelled: "David",
        lastConfidence: 0.95,
        spellPromptedAt: null,
      }),
    );
    expect(params.acknowledgeNameAndMoveOn).toHaveBeenCalledWith("David Johnson");
  });

  it("uses fallback candidate on no-letters parse and acknowledges", async () => {
    const policy = buildPolicy({
      parseSpelledNameParts: jest.fn().mockReturnValue({
        firstName: null,
        lastName: null,
        letterCount: 0,
        reason: "no_letters",
      }),
      extractNameCandidateDeterministic: jest
        .fn()
        .mockReturnValue("Taylor Rivera"),
    });
    const runtime = new VoiceTurnNameSpellingRuntime(policy);
    const params = buildParams();

    const result = await runtime.handle(params);

    expect(result).toBe("ack");
    expect(params.storeProvisionalName).toHaveBeenCalledWith(
      "Taylor Rivera",
      expect.objectContaining({
        lastConfidence: 0.9,
        spellPromptedAt: null,
      }),
    );
    expect(params.acknowledgeNameAndMoveOn).toHaveBeenCalledWith("Taylor Rivera");
  });

  it("re-prompts spelling when parse fails and prompt budget remains", async () => {
    const policy = buildPolicy({
      parseSpelledNameParts: jest.fn().mockReturnValue({
        firstName: null,
        lastName: null,
        letterCount: 0,
        reason: "unknown",
      }),
    });
    const runtime = new VoiceTurnNameSpellingRuntime(policy);
    const params = buildParams();

    const result = await runtime.handle({
      ...params,
      nameState: {
        ...params.nameState,
        spellPromptCount: 0,
      },
    });

    expect(result).toBe("spell-reprompt");
    expect(policy.updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
      }),
    );
    expect(params.replyWithNameTwiml).toHaveBeenCalledWith(
      "<Response>Spell</Response>",
    );
  });

  it("clears spell prompt state and moves to address after max reprompts", async () => {
    const policy = buildPolicy();
    const runtime = new VoiceTurnNameSpellingRuntime(policy);
    const params = buildParams();

    const result = await runtime.handle({
      ...params,
      nameState: {
        ...params.nameState,
        spellPromptCount: 2,
      },
    });

    expect(result).toBe("address-prompt");
    expect(policy.updateVoiceNameState).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        nameState: expect.objectContaining({
          spellPromptedAt: null,
          spellPromptedTurnIndex: null,
          firstNameSpelled: null,
        }),
      }),
    );
    expect(params.replyWithAddressPrompt).toHaveBeenCalled();
  });
});
