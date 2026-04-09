import { SanitizationService } from "../../../sanitization/sanitization.service";
import {
  buildNameClarificationPrompt,
  extractNameCandidateDeterministic,
  isLikelyNameCandidate,
  isValidNameCandidate,
  normalizeNameCandidate,
  parseSpelledNameParts,
  shouldPromptForNameSpelling,
  shouldRepromptForLowConfidenceName,
} from "../voice-name-candidate.policy";

describe("voice-name-candidate.policy", () => {
  const sanitizer = new SanitizationService();

  it("normalizes names by stripping fillers and courtesy tokens", () => {
    expect(
      normalizeNameCandidate(
        "hello my name is david johnson thanks",
        sanitizer,
      ),
    ).toBe("David Johnson");
  });

  it("extracts deterministic candidates from direct name statements", () => {
    expect(
      extractNameCandidateDeterministic(
        "Hi, my name is alice cooper",
        sanitizer,
      ),
    ).toBe("Alice Cooper");
  });

  it("extracts deterministic candidates from spelled names", () => {
    expect(extractNameCandidateDeterministic("D A V I D", sanitizer)).toBe(
      "David",
    );
  });

  it("parses spelled first and last names", () => {
    expect(parseSpelledNameParts("D A V I D johnson")).toEqual({
      firstName: "David",
      lastName: "Johnson",
      letterCount: 5,
    });
  });

  it("rejects blocked words as likely name candidates", () => {
    expect(isLikelyNameCandidate("Hello")).toBe(false);
    expect(isLikelyNameCandidate("David")).toBe(true);
  });

  it("validates token shape and length for name candidates", () => {
    expect(isValidNameCandidate("David")).toBe(true);
    expect(isValidNameCandidate("David Johnson")).toBe(true);
    expect(isValidNameCandidate("123 David")).toBe(false);
  });

  it("prompts for spelling when candidate is fragment or corrections are repeated", () => {
    expect(
      shouldPromptForNameSpelling(
        {
          spellPromptCount: 0,
          corrections: 2,
          lastConfidence: 0.95,
        },
        "David",
        sanitizer,
      ),
    ).toBe(true);
    expect(
      shouldPromptForNameSpelling(
        {
          spellPromptCount: 0,
          corrections: 0,
          lastConfidence: 0.5,
        },
        "A",
        sanitizer,
      ),
    ).toBe(true);
  });

  it("reprompts low-confidence single-token names with no spelled confirmation", () => {
    expect(
      shouldRepromptForLowConfidenceName(
        {
          spellPromptCount: 0,
          lastConfidence: 0.2,
          firstNameSpelled: null,
        },
        "David",
        sanitizer,
      ),
    ).toBe(true);
    expect(
      shouldRepromptForLowConfidenceName(
        {
          spellPromptCount: 2,
          lastConfidence: 0.2,
          firstNameSpelled: null,
        },
        "David",
        sanitizer,
      ),
    ).toBe(false);
  });

  it("builds clarification prompts with and without candidate", () => {
    expect(buildNameClarificationPrompt("David Johnson", sanitizer)).toContain(
      "I heard David Johnson",
    );
    expect(buildNameClarificationPrompt(null, sanitizer)).toContain(
      "Please say your full first and last name.",
    );
  });
});
