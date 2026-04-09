import {
  isLikelyNameCandidate,
  isValidNameCandidate,
  normalizeNameCandidate,
} from "./voice-name-candidate.policy";
import {
  isIncompleteAddress,
  normalizeAddressCandidate,
} from "./voice-address-candidate.policy";

export type VoiceConfirmationOutcome =
  | "CONFIRM"
  | "REJECT"
  | "REPLACE_CANDIDATE"
  | "UNKNOWN";

export type VoiceConfirmationResolution = {
  outcome: VoiceConfirmationOutcome;
  candidate: string | null;
};

export type VoiceFieldConfirmationType = "name" | "address";

export type VoiceFieldConfirmationSanitizer = {
  sanitizeText(value: string): string;
  normalizeWhitespace(value: string): string;
};

const CONFIRM_PHRASES = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "yah",
  "ya",
  "yuh",
  "yellow",
  "yello",
  "correct",
  "that's right",
  "that is right",
  "right",
  "ok",
  "okay",
  "affirmative",
]);

const REJECT_PHRASES = new Set([
  "no",
  "nope",
  "incorrect",
  "that's wrong",
  "that is wrong",
  "not right",
  "negative",
]);

export function normalizeConfirmationUtterance(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripConfirmationPrefix(
  value: string,
  sanitizer: VoiceFieldConfirmationSanitizer,
): string {
  const cleaned = sanitizer.normalizeWhitespace(value);
  const lowered = cleaned.toLowerCase();
  const prefixes = [...CONFIRM_PHRASES, ...REJECT_PHRASES];
  for (const prefix of prefixes) {
    if (lowered === prefix) {
      return "";
    }
    if (
      lowered.startsWith(`${prefix} `) ||
      lowered.startsWith(`${prefix},`) ||
      lowered.startsWith(`${prefix}.`) ||
      lowered.startsWith(`${prefix}!`) ||
      lowered.startsWith(`${prefix}?`)
    ) {
      const remainder = cleaned.slice(prefix.length).replace(/^[\s,!.?]+/, "");
      return remainder.replace(/^(?:it's|it is|its|that is|that's)\s+/i, "");
    }
  }
  return cleaned;
}

export function extractReplacementCandidate(params: {
  utterance: string;
  fieldType: VoiceFieldConfirmationType;
  sanitizer: VoiceFieldConfirmationSanitizer;
}): string | null {
  const cleaned = params.sanitizer.sanitizeText(params.utterance);
  const stripped = stripConfirmationPrefix(cleaned, params.sanitizer);
  if (!stripped) {
    return null;
  }
  if (params.fieldType === "name") {
    const candidate = normalizeNameCandidate(stripped, params.sanitizer);
    if (
      !candidate ||
      !isValidNameCandidate(candidate) ||
      !isLikelyNameCandidate(candidate)
    ) {
      return null;
    }
    return candidate;
  }
  const candidate = params.sanitizer.normalizeWhitespace(
    normalizeAddressCandidate(stripped, params.sanitizer),
  );
  if (!candidate || isIncompleteAddress(candidate)) {
    return null;
  }
  return candidate;
}

export function resolveConfirmation(params: {
  utterance: string;
  currentCandidate: string | null;
  fieldType: VoiceFieldConfirmationType;
  sanitizer: VoiceFieldConfirmationSanitizer;
}): VoiceConfirmationResolution {
  const normalized = normalizeConfirmationUtterance(params.utterance);
  if (CONFIRM_PHRASES.has(normalized)) {
    return { outcome: "CONFIRM", candidate: null };
  }
  if (REJECT_PHRASES.has(normalized)) {
    return { outcome: "REJECT", candidate: null };
  }
  const candidate = extractReplacementCandidate({
    utterance: params.utterance,
    fieldType: params.fieldType,
    sanitizer: params.sanitizer,
  });
  if (candidate) {
    return { outcome: "REPLACE_CANDIDATE", candidate };
  }
  if (params.currentCandidate) {
    return { outcome: "UNKNOWN", candidate: null };
  }
  return { outcome: "UNKNOWN", candidate: null };
}
