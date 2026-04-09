export function isLikelyQuestion(transcript: string): boolean {
  if (!transcript) {
    return false;
  }
  if (transcript.trim().endsWith("?")) {
    return true;
  }
  return /^(who|what|when|where|why|how|can|do|does|is|are|will)\b/i.test(
    transcript.trim(),
  );
}

export function isBookingIntent(normalizedTranscript: string): boolean {
  return /\b(book|schedule|appointment|visit|dispatch|send someone|send a tech|come out|come over|set up)\b/.test(
    normalizedTranscript,
  );
}

export function isSlowDownRequest(normalizedTranscript: string): boolean {
  if (
    /\b(hold on|hang on|wait|one sec|one second|just a sec|give me a sec)\b/.test(
      normalizedTranscript,
    )
  ) {
    return true;
  }
  if (/\btoo fast\b/.test(normalizedTranscript)) {
    return true;
  }
  return /\bslow\b.*\bdown\b/.test(normalizedTranscript);
}

export function isFrustrationRequest(normalizedTranscript: string): boolean {
  if (isSlowDownRequest(normalizedTranscript)) {
    return false;
  }
  return /\b(human|agent|representative|supervisor|manager|person|operator|buggy|repeating|not listening|ridiculous|frustrated|annoying|robotic|already told|told you already|said that already)\b/.test(
    normalizedTranscript,
  );
}

export function isHumanTransferRequest(normalizedTranscript: string): boolean {
  if (
    /\b(human|agent|representative|supervisor|manager|operator)\b/.test(
      normalizedTranscript,
    )
  ) {
    return true;
  }
  return /\b(?:talk|speak)\s+to\s+(?:a|an|the)?\s*(?:human|agent|representative|supervisor|manager|person|someone|operator)\b/.test(
    normalizedTranscript,
  );
}

export function isSmsDifferentNumberRequest(
  normalizedTranscript: string,
): boolean {
  if (!normalizedTranscript) {
    return false;
  }
  return /\b(different number|another number|use another number|new number|text (?:me )?at another number|text a different number)\b/.test(
    normalizedTranscript,
  );
}

export function isHangupRequest(normalizedTranscript: string): boolean {
  return /\b(bye|goodbye|hang up|hangup|stop calling|no thanks|no thank you|cancel|never mind|nevermind|that'?s all)\b/.test(
    normalizedTranscript,
  );
}

export function isAffirmativeUtterance(normalizedTranscript: string): boolean {
  return [
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
    "sure",
    "please",
    "go ahead",
    "perfect",
    "that's perfect",
    "that is perfect",
  ].includes(normalizedTranscript);
}

export function isNegativeUtterance(normalizedTranscript: string): boolean {
  return [
    "no",
    "nope",
    "incorrect",
    "that's wrong",
    "that is wrong",
    "not right",
    "negative",
    "not now",
  ].includes(normalizedTranscript);
}

export function resolveBinaryUtterance(
  normalizedTranscript: string,
): "YES" | "NO" | null {
  if (isAffirmativeUtterance(normalizedTranscript)) {
    return "YES";
  }
  if (isNegativeUtterance(normalizedTranscript)) {
    return "NO";
  }
  if (!normalizedTranscript) {
    return null;
  }
  if (
    /\b(not an emergency|not emergency|non emergency|this is not an emergency)\b/.test(
      normalizedTranscript,
    )
  ) {
    return "NO";
  }
  if (
    /\b(no (?:elderly|kids?|children)|no one (?:is )?at risk|nobody (?:is )?at risk|not at risk|no urgent concerns?|nothing urgent|no risk)\b/.test(
      normalizedTranscript,
    )
  ) {
    return "NO";
  }
  if (
    /^(yes|yeah|yep|yup|yah|ya|yuh|yellow|yello|correct|right|affirmative|sure|ok|okay)\b/.test(
      normalizedTranscript,
    )
  ) {
    return "YES";
  }
  if (/^(no|nope|negative)\b/.test(normalizedTranscript)) {
    if (
      /\b(no heat|no ac|no air|no cooling|no water|no power|not working|won't turn on)\b/.test(
        normalizedTranscript,
      )
    ) {
      return null;
    }
    return "NO";
  }
  return null;
}

export function isDuplicateTranscript(
  collectedData: unknown,
  transcript: string,
  now: Date,
): boolean {
  if (!collectedData || typeof collectedData !== "object") {
    return false;
  }
  const data = collectedData as Record<string, unknown>;
  const lastTranscript =
    typeof data.lastTranscript === "string" ? data.lastTranscript : null;
  const lastTranscriptAt =
    typeof data.lastTranscriptAt === "string" ? data.lastTranscriptAt : null;
  if (!lastTranscript || !lastTranscriptAt) {
    return false;
  }
  const lastTime = Date.parse(lastTranscriptAt);
  if (Number.isNaN(lastTime)) {
    return false;
  }
  const withinWindow = now.getTime() - lastTime <= 4000;
  if (!withinWindow) {
    return false;
  }
  const normalizedCurrent = normalizeTranscriptForDuplicateCheck(transcript);
  const normalizedLast = normalizeTranscriptForDuplicateCheck(lastTranscript);
  if (!normalizedCurrent || !normalizedLast) {
    return false;
  }
  return normalizedLast === normalizedCurrent;
}

function normalizeTranscriptForDuplicateCheck(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
