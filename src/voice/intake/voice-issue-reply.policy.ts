export function capVoiceAiReply(value: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "Thanks. We'll follow up shortly.";
  }
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
}

export function shouldVoiceGatherMore(reply: string): boolean {
  return reply.trim().endsWith("?");
}

export function isVoiceIssueCollectionPrompt(
  reply: string,
  normalizeUtterance: (value: string) => string,
): boolean {
  const normalized = normalizeUtterance(reply);
  if (!normalized) {
    return false;
  }
  return /\b(main issue|brief description|short summary|describe (?:the )?issue|what(?:'s| is) (?:the )?issue|what(?:'s| is) (?:been )?going on with (?:the )?(?:system|unit)|what seems to be the issue)\b/.test(
    normalized,
  );
}

export function isVoiceIssueReconfirmationPrompt(
  reply: string,
  normalizeUtterance: (value: string) => string,
): boolean {
  const normalized = normalizeUtterance(reply);
  if (!normalized) {
    return false;
  }
  const hasIssuePhrase =
    /\b(issue|problem|heating|cooling|furnace|ac|air conditioning|no heat|no ac|cold air|leak|electrical|plumbing)\b/.test(
      normalized,
    ) &&
    /\b(sound|seem|dealing with|experiencing|having|might be)\b/.test(
      normalized,
    );
  if (!hasIssuePhrase) {
    return false;
  }
  return /\b(is that correct|is this correct|can you confirm|does that sound right|is that right|right\?)\b/.test(
    normalized,
  );
}
