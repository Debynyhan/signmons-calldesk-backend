import {
  buildNameFollowUpPrompt,
  clearNameSpellPrompt,
  lockNameForAddressProgression,
  markLowConfidenceNameReprompt,
  markNameAttemptIfNeeded,
  markNameSpellPrompted,
  storeProvisionalNameCandidate,
  type VoiceNameSlotState,
} from "../voice-name-slot.reducer";

const baseState: VoiceNameSlotState = {
  candidate: {
    value: null,
    sourceEventId: null,
    createdAt: null,
  },
  confirmed: {
    value: null,
    sourceEventId: null,
    confirmedAt: null,
  },
  status: "MISSING",
  locked: false,
  attemptCount: 0,
  corrections: 0,
  lastConfidence: null,
  firstNameSpelled: null,
  spellPromptedAt: null,
  spellPromptedTurnIndex: null,
  spellPromptCount: 0,
};

describe("voice-name-slot.reducer", () => {
  it("locks name for address progression", () => {
    const next = lockNameForAddressProgression({
      state: {
        ...baseState,
        candidate: {
          value: "John Smith",
          sourceEventId: null,
          createdAt: null,
        },
      },
      sourceEventId: "evt-1",
      nowIso: "2026-04-09T12:00:00.000Z",
    });

    expect(next.locked).toBe(true);
    expect(next.status).toBe("CANDIDATE");
    expect(next.attemptCount).toBe(1);
    expect(next.candidate).toEqual({
      value: "John Smith",
      sourceEventId: "evt-1",
      createdAt: "2026-04-09T12:00:00.000Z",
    });
  });

  it("marks attempt only once", () => {
    const attempted = markNameAttemptIfNeeded(baseState);
    expect(attempted.attemptCount).toBe(1);
    expect(markNameAttemptIfNeeded(attempted)).toBe(attempted);
  });

  it("stores provisional name with options", () => {
    const next = storeProvisionalNameCandidate({
      state: baseState,
      candidate: "Sarah Connor",
      sourceEventId: "evt-2",
      createdAtIso: "2026-04-09T12:00:01.000Z",
      options: {
        corrections: 2,
        lastConfidence: 0.93,
        firstNameSpelled: "Sarah",
        spellPromptedAt: null,
        spellPromptedTurnIndex: null,
        spellPromptCount: 1,
      },
    });

    expect(next.candidate.value).toBe("Sarah Connor");
    expect(next.status).toBe("CANDIDATE");
    expect(next.attemptCount).toBe(1);
    expect(next.corrections).toBe(2);
    expect(next.lastConfidence).toBe(0.93);
    expect(next.firstNameSpelled).toBe("Sarah");
    expect(next.spellPromptCount).toBe(1);
  });

  it("handles low-confidence reprompt and spell prompt lifecycle", () => {
    const reprompted = markLowConfidenceNameReprompt({
      state: baseState,
      candidate: null,
      turnIndex: 3,
      nowMs: 1000,
    });
    expect(reprompted.locked).toBe(false);
    expect(reprompted.spellPromptCount).toBe(1);
    expect(reprompted.spellPromptedAt).toBe(1000);
    expect(reprompted.spellPromptedTurnIndex).toBe(3);

    const prompted = markNameSpellPrompted({
      state: reprompted,
      turnIndex: 4,
      nowMs: 2000,
    });
    expect(prompted.spellPromptCount).toBe(2);
    expect(prompted.spellPromptedAt).toBe(2000);
    expect(prompted.spellPromptedTurnIndex).toBe(4);

    const cleared = clearNameSpellPrompt(prompted);
    expect(cleared.spellPromptedAt).toBeNull();
    expect(cleared.spellPromptedTurnIndex).toBeNull();
  });

  it("builds issue-aware name follow-up prompt", () => {
    expect(buildNameFollowUpPrompt("no heat in the basement.")).toBe(
      "I heard no heat in the basement. What's your full name?",
    );
    expect(buildNameFollowUpPrompt(null)).toBe("What's your full name?");
  });
});
