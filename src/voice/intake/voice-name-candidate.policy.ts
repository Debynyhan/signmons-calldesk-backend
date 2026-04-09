export type VoiceNameSanitizer = {
  sanitizeText(value: string): string;
  normalizeWhitespace(value: string): string;
};

export type VoiceNameStatePolicyInput = {
  spellPromptCount?: number | null;
  lastConfidence?: number | null;
  corrections?: number | null;
  firstNameSpelled?: string | null;
};

export type SpelledNameParts = {
  firstName: string | null;
  lastName?: string;
  letterCount: number;
  reason?: "no_letters" | "too_short" | "too_long";
};

export function normalizeNameCandidate(
  value: string,
  sanitizer: VoiceNameSanitizer,
): string {
  const cleaned = sanitizer
    .sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ");
  const stripped = stripNameFillers(cleaned);
  const normalized = sanitizer.normalizeWhitespace(stripped);
  if (!normalized) {
    return "";
  }
  return toTitleCase(normalized);
}

export function extractNameCandidateDeterministic(
  transcript: string,
  sanitizer: VoiceNameSanitizer,
): string | null {
  const cleaned = sanitizer.sanitizeText(transcript);
  if (!cleaned) {
    return null;
  }
  if (/\d/.test(transcript)) {
    return null;
  }
  const tokenPattern =
    "([A-Za-z][A-Za-z'\\-]*(?:\\s+[A-Za-z][A-Za-z'\\-]*){0,2})";
  const patterns = [
    new RegExp(`\\bmy name is\\s+${tokenPattern}`, "i"),
    new RegExp(`\\bthis is\\s+${tokenPattern}`, "i"),
    new RegExp(`\\bi am\\s+${tokenPattern}`, "i"),
    new RegExp(`\\bi'?m\\s+${tokenPattern}`, "i"),
    new RegExp(`\\bname is\\s+${tokenPattern}`, "i"),
    new RegExp(`\\bit'?s\\s+${tokenPattern}`, "i"),
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match || !match[1]) {
      continue;
    }
    const normalized = normalizeNameCandidate(match[1], sanitizer);
    if (isValidNameCandidate(normalized)) {
      return normalized;
    }
  }
  const spelled = extractSpelledNameCandidate(cleaned, sanitizer);
  if (spelled) {
    return spelled;
  }
  const direct = normalizeNameCandidate(cleaned, sanitizer);
  if (!isValidNameCandidate(direct)) {
    return null;
  }
  return isLikelyNameCandidate(direct) ? direct : null;
}

export function parseSpelledNameParts(transcript: string): SpelledNameParts {
  const cleaned = transcript.toUpperCase().replace(/[^A-Z\s]/g, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const letters: string[] = [];
  let startIndex = -1;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (/^[A-Z]$/.test(token)) {
      if (startIndex < 0) {
        startIndex = index;
      }
      letters.push(token);
    } else if (letters.length >= 3) {
      break;
    } else {
      letters.length = 0;
      startIndex = -1;
    }
    index += 1;
  }
  if (letters.length === 0) {
    const hasLongTokens = tokens.some((token) => token.length > 4);
    const shortTokens = tokens.filter(
      (token) => token.length >= 2 && token.length <= 4,
    );
    if (!hasLongTokens && shortTokens.length >= 2 && shortTokens.length <= 6) {
      const joinedShort = shortTokens.join("");
      if (joinedShort.length >= 3 && joinedShort.length <= 12) {
        const firstName = toTitleCase(joinedShort.toLowerCase());
        return {
          firstName,
          letterCount: joinedShort.length,
        };
      }
    }
    return { firstName: null, letterCount: 0, reason: "no_letters" };
  }
  if (letters.length < 3) {
    return {
      firstName: null,
      letterCount: letters.length,
      reason: "too_short",
    };
  }
  if (letters.length > 12) {
    return {
      firstName: null,
      letterCount: letters.length,
      reason: "too_long",
    };
  }
  const joined = letters.join("").toLowerCase();
  const firstName = toTitleCase(joined);
  const remainderIndex = startIndex >= 0 ? startIndex + letters.length : index;
  const remaining = tokens
    .slice(remainderIndex)
    .filter((token) => token.length > 1);
  const rawLastName = remaining[0];
  const normalizedLastName = rawLastName
    ? toTitleCase(rawLastName.toLowerCase())
    : null;
  const lastName =
    normalizedLastName && isValidLastNameToken(normalizedLastName)
      ? normalizedLastName
      : undefined;
  return { firstName, lastName, letterCount: letters.length };
}

export function isValidNameCandidate(candidate: string): boolean {
  const tokens = candidate.split(" ").filter(Boolean);
  if (tokens.length < 1 || tokens.length > 3) {
    return false;
  }
  return tokens.every((token) => /^[A-Za-z][A-Za-z'-]*$/.test(token));
}

export function isLikelyNameCandidate(candidate: string): boolean {
  const blocked = new Set([
    "hello",
    "hi",
    "hey",
    "there",
    "this",
    "that",
    "you",
    "your",
    "me",
    "my",
    "the",
    "yes",
    "yeah",
    "yep",
    "yup",
    "yah",
    "ya",
    "yuh",
    "yellow",
    "yello",
    "no",
    "nope",
    "correct",
    "incorrect",
    "right",
    "ok",
    "okay",
    "maybe",
    "sure",
    "acting",
    "act",
    "up",
    "issue",
    "problem",
    "help",
    "from",
    "buggy",
    "slow",
    "down",
    "bye",
    "goodbye",
  ]);
  return candidate
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .every((token) => !blocked.has(token));
}

export function shouldPromptForNameSpelling(
  nameState: VoiceNameStatePolicyInput,
  candidate: string | null,
  sanitizer: VoiceNameSanitizer,
): boolean {
  if (!candidate) {
    return false;
  }
  if ((nameState.spellPromptCount ?? 0) > 0) {
    return false;
  }
  const tokenCount = candidate.split(" ").filter(Boolean).length;
  const lowConfidence = (nameState.lastConfidence ?? 1) < 0.8;
  const repeatedCorrections = (nameState.corrections ?? 0) >= 2;
  const fragment = isNameFragment(candidate, sanitizer);
  if (repeatedCorrections || fragment) {
    return true;
  }
  return lowConfidence && tokenCount <= 1;
}

export function shouldRepromptForLowConfidenceName(
  nameState: VoiceNameStatePolicyInput,
  candidate: string | null,
  sanitizer: VoiceNameSanitizer,
): boolean {
  if (!candidate) {
    return false;
  }
  const promptCount = nameState.spellPromptCount ?? 0;
  if (promptCount >= 2) {
    return false;
  }
  const tokenCount = candidate.split(" ").filter(Boolean).length;
  const confidence = nameState.lastConfidence;
  const lowConfidence =
    typeof confidence === "number" && confidence >= 0 && confidence < 0.35;
  const fragment = isNameFragment(candidate, sanitizer);
  if (fragment) {
    return true;
  }
  return tokenCount <= 1 && lowConfidence && !nameState.firstNameSpelled;
}

export function buildNameClarificationPrompt(
  candidate: string | null,
  sanitizer: VoiceNameSanitizer,
): string {
  const normalizedCandidate = candidate
    ? sanitizer.normalizeWhitespace(candidate)
    : "";
  if (normalizedCandidate) {
    return `I want to make sure I got your name right. I heard ${normalizedCandidate}. Please say your full first and last name.`;
  }
  return "I want to make sure I got your name right. Please say your full first and last name.";
}

function extractSpelledNameCandidate(
  transcript: string,
  sanitizer: VoiceNameSanitizer,
): string | null {
  const parsed = parseSpelledNameParts(transcript);
  if (!parsed.firstName) {
    return null;
  }
  const candidate = parsed.lastName
    ? `${parsed.firstName} ${parsed.lastName}`
    : parsed.firstName;
  const normalized = normalizeNameCandidate(candidate, sanitizer);
  return isValidNameCandidate(normalized) ? normalized : null;
}

function isValidLastNameToken(value: string): boolean {
  return /^[A-Za-z][A-Za-z'-]*$/.test(value) && value.length >= 2;
}

function isNameFragment(
  candidate: string,
  sanitizer: VoiceNameSanitizer,
): boolean {
  const normalized = sanitizer.normalizeWhitespace(
    stripNameFillers(candidate.toLowerCase()),
  );
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  return tokens[0].length <= 2;
}

function stripNameFillers(value: string): string {
  const leadingTokens = new Set([
    "um",
    "uh",
    "erm",
    "er",
    "hey",
    "hi",
    "hello",
  ]);
  let result = value.trim();
  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    for (const token of leadingTokens) {
      if (result.startsWith(`${token} `)) {
        result = result.slice(token.length).trim();
        trimmed = true;
        break;
      }
    }
  }
  const fillers = [
    "my name is",
    "this is",
    "i am",
    "im",
    "i'm",
    "name is",
    "its",
    "it's",
  ];
  for (const filler of fillers) {
    if (result.startsWith(`${filler} `)) {
      result = result.slice(filler.length).trim();
      break;
    }
  }
  trimmed = true;
  while (trimmed) {
    trimmed = false;
    for (const token of leadingTokens) {
      if (result.startsWith(`${token} `)) {
        result = result.slice(token.length).trim();
        trimmed = true;
        break;
      }
    }
  }
  const trailingCourtesyTokens = new Set([
    "thanks",
    "thank",
    "you",
    "please",
    "sir",
    "maam",
    "mam",
  ]);
  let tokens = result.split(/\s+/).filter(Boolean);
  while (tokens.length > 1) {
    const tail = tokens[tokens.length - 1];
    if (!trailingCourtesyTokens.has(tail)) {
      break;
    }
    tokens = tokens.slice(0, -1);
  }
  result = tokens.join(" ");
  return result;
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .map((part) => {
      const [head, ...rest] = part.split(/([-'])/);
      const rebuilt = [head, ...rest]
        .map((segment) => {
          if (segment === "-" || segment === "'") {
            return segment;
          }
          if (!segment) {
            return "";
          }
          return `${segment[0].toUpperCase()}${segment.slice(1)}`;
        })
        .join("");
      return rebuilt;
    })
    .join(" ");
}
