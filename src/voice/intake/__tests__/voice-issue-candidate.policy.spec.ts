import {
  buildVoiceFallbackIssueCandidate,
  buildVoiceIssueAcknowledgement,
  isLikelyVoiceIssueCandidate,
  isVoiceComfortRiskRelevant,
  isVoiceIssueRepeatComplaint,
  normalizeVoiceIssueCandidate,
} from "../voice-issue-candidate.policy";

const sanitizer = {
  sanitizeText: (value: string) => value,
  normalizeWhitespace: (value: string) => value.replace(/\s+/g, " ").trim(),
};

describe("voice-issue-candidate.policy", () => {
  it("normalizes common stt issue variants", () => {
    expect(normalizeVoiceIssueCandidate("no eet in my house", sanitizer)).toBe(
      "no heat in my house",
    );
    expect(
      normalizeVoiceIssueCandidate("unit is blowing colde air", sanitizer),
    ).toBe("unit is blowing cold air");
  });

  it("builds fallback issue candidate only for useful non-question content", () => {
    const result = buildVoiceFallbackIssueCandidate(
      "the furnace stopped working last night",
      {
        normalizeIssueCandidate: (value) => normalizeVoiceIssueCandidate(value, sanitizer),
        isLikelyQuestion: () => false,
        resolveBinaryUtterance: () => null,
      },
    );
    expect(result).toBe("the furnace stopped working last night");
  });

  it("filters fallback when utterance is question/binary/too short", () => {
    expect(
      buildVoiceFallbackIssueCandidate("can you help me", {
        normalizeIssueCandidate: (value) =>
          normalizeVoiceIssueCandidate(value, sanitizer),
        isLikelyQuestion: () => true,
        resolveBinaryUtterance: () => null,
      }),
    ).toBeNull();
    expect(
      buildVoiceFallbackIssueCandidate("yes", {
        normalizeIssueCandidate: (value) =>
          normalizeVoiceIssueCandidate(value, sanitizer),
        isLikelyQuestion: () => false,
        resolveBinaryUtterance: () => "YES",
      }),
    ).toBeNull();
  });

  it("builds issue acknowledgement summary", () => {
    const summary = buildVoiceIssueAcknowledgement(
      "My furnace stopped working and is blowing cold air. Can you help?",
      {
        normalizeIssueCandidate: (value) =>
          normalizeVoiceIssueCandidate(value, sanitizer),
        normalizeWhitespace: sanitizer.normalizeWhitespace,
      },
    );
    expect(summary).toContain("your furnace");
  });

  it("detects likely issue and comfort risk relevance", () => {
    const normalizeIssue = (value: string) =>
      normalizeVoiceIssueCandidate(value, sanitizer);
    expect(isLikelyVoiceIssueCandidate("no heat in the house", normalizeIssue)).toBe(
      true,
    );
    expect(isVoiceComfortRiskRelevant("no cooling from AC", normalizeIssue)).toBe(
      true,
    );
  });

  it("detects issue-repeat complaints", () => {
    expect(isVoiceIssueRepeatComplaint("you keep asking me that already")).toBe(
      true,
    );
    expect(isVoiceIssueRepeatComplaint("the unit is noisy")).toBe(false);
  });
});
