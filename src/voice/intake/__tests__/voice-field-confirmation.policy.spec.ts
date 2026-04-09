import { SanitizationService } from "../../../sanitization/sanitization.service";
import {
  extractReplacementCandidate,
  normalizeConfirmationUtterance,
  resolveConfirmation,
  stripConfirmationPrefix,
} from "../voice-field-confirmation.policy";

describe("voice-field-confirmation.policy", () => {
  const sanitizer = new SanitizationService();

  it("normalizes confirmation utterance", () => {
    expect(normalizeConfirmationUtterance(" YES!! ")).toBe("yes");
    expect(normalizeConfirmationUtterance("That's right.")).toBe(
      "that's right",
    );
  });

  it("strips confirmation prefix and keeps replacement payload", () => {
    expect(stripConfirmationPrefix("yes it's John Smith", sanitizer)).toBe(
      "John Smith",
    );
    expect(stripConfirmationPrefix("no", sanitizer)).toBe("");
    expect(stripConfirmationPrefix("maybe", sanitizer)).toBe("maybe");
  });

  it("extracts replacement candidate for name and address", () => {
    expect(
      extractReplacementCandidate({
        utterance: "yes, my name is Sarah Connor",
        fieldType: "name",
        sanitizer,
      }),
    ).toBe("Sarah Connor");
    expect(
      extractReplacementCandidate({
        utterance: "no 123 Main St Cleveland OH 44114",
        fieldType: "address",
        sanitizer,
      }),
    ).toBe("123 Main St Cleveland OH 44114");
  });

  it("rejects invalid replacement candidates", () => {
    expect(
      extractReplacementCandidate({
        utterance: "yes issue",
        fieldType: "name",
        sanitizer,
      }),
    ).toBeNull();
    expect(
      extractReplacementCandidate({
        utterance: "no 123",
        fieldType: "address",
        sanitizer,
      }),
    ).toBeNull();
  });

  it("resolves confirm/reject/replace/unknown outcomes", () => {
    expect(
      resolveConfirmation({
        utterance: "yes",
        currentCandidate: "John Smith",
        fieldType: "name",
        sanitizer,
      }),
    ).toEqual({ outcome: "CONFIRM", candidate: null });

    expect(
      resolveConfirmation({
        utterance: "nope",
        currentCandidate: "John Smith",
        fieldType: "name",
        sanitizer,
      }),
    ).toEqual({ outcome: "REJECT", candidate: null });

    expect(
      resolveConfirmation({
        utterance: "yes, Sarah Connor",
        currentCandidate: "John Smith",
        fieldType: "name",
        sanitizer,
      }),
    ).toEqual({ outcome: "REPLACE_CANDIDATE", candidate: "Sarah Connor" });

    expect(
      resolveConfirmation({
        utterance: "maybe",
        currentCandidate: "John Smith",
        fieldType: "name",
        sanitizer,
      }),
    ).toEqual({ outcome: "UNKNOWN", candidate: null });
  });
});
