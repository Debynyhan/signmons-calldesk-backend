type IssueTextSanitizer = {
  sanitizeText: (value: string) => string;
  normalizeWhitespace: (value: string) => string;
};

type IssueFallbackPolicy = {
  normalizeIssueCandidate: (value: string) => string;
  isLikelyQuestion: (value: string) => boolean;
  resolveBinaryUtterance: (value: string) => "YES" | "NO" | null;
};

export function normalizeVoiceHvacIssueLexicon(
  value: string,
  normalizeWhitespace: (value: string) => string,
): string {
  if (!value) {
    return "";
  }
  let normalized = value;
  const hasHvacContext =
    /\b(cold|heat|heating|hvac|furnace|ac|air|cool|blower|thermostat|unit)\b/i.test(
      normalized,
    );
  if (hasHvacContext) {
    normalized = normalized
      .replace(/\bmy friend\b/gi, "my furnace")
      .replace(/\bfriend\b/gi, "furnace")
      .replace(/\bgoing cold air\b/gi, "blowing cold air")
      .replace(/\bgoing out\b/gi, "blowing out");
  }
  return normalizeWhitespace(normalized);
}

export function normalizeVoiceIssueCandidate(
  value: string,
  sanitizer: IssueTextSanitizer,
): string {
  const cleaned = sanitizer.sanitizeText(value);
  const normalized = sanitizer.normalizeWhitespace(cleaned);
  if (!normalized) {
    return "";
  }
  const canonicalized = normalized
    .replace(/\bno[\s,.-]*(?:eat|eet|8|eight)\b/gi, "no heat")
    .replace(/\bblowing\s+(?:code|coal|colde)\b/gi, "blowing cold")
    .replace(/\bno[\s,.-]*(?:a[\s.-]*c|ace)\b/gi, "no ac");
  return normalizeVoiceHvacIssueLexicon(
    canonicalized,
    sanitizer.normalizeWhitespace,
  );
}

export function buildVoiceFallbackIssueCandidate(
  value: string,
  policy: IssueFallbackPolicy,
): string | null {
  const normalized = policy.normalizeIssueCandidate(value);
  if (!normalized) {
    return null;
  }
  if (policy.isLikelyQuestion(normalized)) {
    return null;
  }
  if (policy.resolveBinaryUtterance(normalized)) {
    return null;
  }
  const phrase = normalized.toLowerCase();
  const words = phrase.split(/\s+/).filter(Boolean);
  if (words.length < 4) {
    return null;
  }
  if (
    !/\b(no|not|wont|won't|stopped|stop|broken|issue|problem|leak|noise|smell|emergency|working|heat|cool|ac|furnace|unit|system|water|power|air)\b/.test(
      phrase,
    )
  ) {
    return null;
  }
  return normalized;
}

export function isVoiceComfortRiskRelevant(
  value: string,
  normalizeIssueCandidate: (value: string) => string,
): boolean {
  const normalized = normalizeIssueCandidate(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  return /\b(furnace|heat|heating|no heat|cold air|blowing cold|no cool(?:ing)?|no ac|ac|air conditioning|cooling|hvac)\b/.test(
    normalized,
  );
}

export function buildVoiceIssueAcknowledgement(
  value: string,
  params: {
    normalizeIssueCandidate: (value: string) => string;
    normalizeWhitespace: (value: string) => string;
  },
): string | null {
  const normalized = params.normalizeIssueCandidate(value);
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase();
  const keywords = [
    "furnace",
    "heat",
    "heating",
    "cold",
    "ac",
    "air conditioning",
    "cooling",
    "no heat",
    "no hot",
    "leak",
    "leaking",
    "water",
    "burst",
    "clog",
    "drain",
    "electrical",
    "power",
    "spark",
    "smell",
    "smoke",
    "gas",
    "broken",
    "not working",
    "stopped working",
    "went out",
    "went down",
    "blizzard",
  ];
  let startIndex = -1;
  for (const keyword of keywords) {
    const idx = lower.indexOf(keyword);
    if (idx >= 0 && (startIndex < 0 || idx < startIndex)) {
      startIndex = idx;
    }
  }
  const slice = startIndex >= 0 ? normalized.slice(startIndex) : normalized;
  let summary = params.normalizeWhitespace(slice);
  const lowerSummary = summary.toLowerCase();
  const stopCandidates = [
    summary.search(/[.?!]/),
    lowerSummary.indexOf(" i was wondering"),
    lowerSummary.indexOf(" can you"),
    lowerSummary.indexOf(" could you"),
    lowerSummary.indexOf(" do you"),
    lowerSummary.indexOf(" would you"),
  ].filter((index) => index > 0);
  if (stopCandidates.length) {
    summary = summary.slice(0, Math.min(...stopCandidates));
  }
  summary = summary.replace(/[.?!]+$/, "");
  summary = summary.replace(/^my\s+/i, "your ");
  const lowerSummaryFinal = summary.toLowerCase();
  if (
    !lowerSummaryFinal.startsWith("your ") &&
    (lowerSummaryFinal.startsWith("furnace") ||
      lowerSummaryFinal.startsWith("ac") ||
      lowerSummaryFinal.startsWith("air conditioning") ||
      lowerSummaryFinal.startsWith("heating") ||
      lowerSummaryFinal.startsWith("cooling"))
  ) {
    summary = `your ${summary}`;
  }
  if (!summary) {
    return null;
  }
  const words = summary.split(/\s+/).filter(Boolean);
  const fillerWords = new Set([
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "it",
    "its",
    "it's",
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "here",
    "there",
    "when",
    "while",
    "she",
    "he",
    "they",
    "we",
    "doing",
    "going",
    "getting",
    "just",
    "so",
    "that",
    "this",
    "i",
    "my",
    "me",
    "you",
    "your",
  ]);
  const fillerCount = words.filter((w) =>
    fillerWords.has(w.toLowerCase()),
  ).length;
  const fillerRatio = words.length > 0 ? fillerCount / words.length : 0;
  if (fillerRatio > 0.55 && words.length > 4) {
    const lowerValue = value.toLowerCase();
    if (
      /\b(furnace|heat|heating|no heat|blowing cold|cold air)\b/.test(
        lowerValue,
      )
    ) {
      return "your furnace issue";
    }
    if (/\b(ac|air conditioning|cooling|no cool)\b/.test(lowerValue)) {
      return "your AC issue";
    }
    if (/\b(leak|leaking|water|burst|pipe)\b/.test(lowerValue)) {
      return "your plumbing issue";
    }
    if (/\b(electrical|power|spark|outlet|breaker)\b/.test(lowerValue)) {
      return "your electrical issue";
    }
    if (/\b(drain|clog|toilet|sewer)\b/.test(lowerValue)) {
      return "your drain issue";
    }
    if (/\b(gas|smell|smoke|carbon)\b/.test(lowerValue)) {
      return "your gas or smell concern";
    }
    return "your service request";
  }
  return summary;
}

export function isLikelyVoiceIssueCandidate(
  value: string,
  normalizeIssueCandidate: (value: string) => string,
): boolean {
  const normalized = normalizeIssueCandidate(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.length < 6) {
    return false;
  }
  if (
    /\b(furnace|heater|heat|heating|cold|air conditioning|cooling|no heat|no hot|no[\s,.-]*(?:eat|eet|8|eight)|leak|leaking|water|burst|clog|drain|electrical|power|spark|smell|smoke|gas|broken|not working|stopped working|went out|went down|blizzard|acting up|issue|problem|hvac|no ac|short cycling|cycle on and off|not heating|not cooling)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    /\b(need|send|dispatch|book|schedule|someone|technician|tech)\b.*\b(come|come out|check|look|repair|fix|service|help)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    /\b(won'?t (?:turn on|start)|not (?:coming on|turning on|working)|blowing (?:cold|hot) air|no airflow|making (?:a )?(?:loud )?noise|water (?:on|around) (?:the )?(?:unit|furnace|system|floor)|smell(?:ing)? gas)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    /\b(thermostat|pilot|compressor|blower|fan|hot water|frozen|ice)\b/.test(
      normalized,
    ) &&
    /\b(no|not|won'?t|stopped|broken|issue|problem|acting up)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  return /\bac\b/.test(normalized);
}

export function isVoiceIssueRepeatComplaint(value: string): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return /(i told you|already told you|i already said|you asked (me )?already|you keep asking|you keep repeating|stop asking|asked that already|you asked this already|you already asked)/.test(
    normalized,
  );
}
