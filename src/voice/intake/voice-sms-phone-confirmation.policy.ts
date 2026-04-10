import type { Prisma } from "@prisma/client";

export function isVoiceSmsNumberConfirmation(
  normalizedUtterance: string,
): boolean {
  const directMatches = [
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
    "perfect",
    "sure",
    "sounds good",
    "that works",
    "that's fine",
    "that is fine",
    "that's good",
    "that is good",
    "works for me",
    "go ahead",
    "that's correct",
    "that is correct",
    "that's right",
    "that is right",
    "this one",
    "this number",
    "same number",
    "use this",
    "use this number",
    "that number",
    "that number works",
    "that number's fine",
    "that number is fine",
  ];
  if (directMatches.includes(normalizedUtterance)) {
    return true;
  }
  return (
    normalizedUtterance.includes("this number") ||
    normalizedUtterance.includes("same number") ||
    normalizedUtterance.includes("this one") ||
    normalizedUtterance.startsWith("use this") ||
    normalizedUtterance.includes("that works") ||
    normalizedUtterance.includes("sounds good") ||
    normalizedUtterance.includes("that number")
  );
}

export function extractVoiceSmsPhoneCandidate(
  utterance: string,
  normalizePhoneE164: (value: string) => string,
): string | null {
  const normalized = normalizePhoneE164(utterance);
  return normalized || null;
}

export function getVoiceCallerPhoneFromCollectedData(
  collectedData: Prisma.JsonValue | null | undefined,
): string | null {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  const data = collectedData as Record<string, unknown>;
  return typeof data.callerPhone === "string" ? data.callerPhone : null;
}
