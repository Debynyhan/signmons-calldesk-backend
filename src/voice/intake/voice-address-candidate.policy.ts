export type VoiceAddressSanitizer = {
  sanitizeText(value: string): string;
  normalizeWhitespace(value: string): string;
};

export type VoiceAddressStateSnapshot = {
  candidate: string | null;
  confirmed?: string | null;
  houseNumber?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  status?: string;
  locked?: boolean;
  attemptCount?: number;
  confidence?: number;
  sourceEventId?: string | null;
  needsLocality?: boolean;
  smsConfirmNeeded?: boolean;
};

export type VoiceAddressParts = {
  houseNumber?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

const STREET_SUFFIX_REGEX =
  /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|pl|place|cir|circle)\b/i;

const STREET_SUFFIXES = new Set([
  "st",
  "street",
  "ave",
  "avenue",
  "rd",
  "road",
  "dr",
  "drive",
  "blvd",
  "boulevard",
  "ln",
  "lane",
  "ct",
  "court",
  "way",
  "pkwy",
  "parkway",
  "pl",
  "place",
  "cir",
  "circle",
]);

const CONFIRMATION_WORDS = new Set([
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
  "right",
  "ok",
  "okay",
  "affirmative",
  "no",
  "nope",
  "negative",
]);

const US_STATE_TOKENS = new Set([
  "al",
  "ak",
  "az",
  "ar",
  "ca",
  "co",
  "ct",
  "de",
  "fl",
  "ga",
  "hi",
  "id",
  "il",
  "in",
  "ia",
  "ks",
  "ky",
  "la",
  "me",
  "md",
  "ma",
  "mi",
  "mn",
  "ms",
  "mo",
  "mt",
  "ne",
  "nv",
  "nh",
  "nj",
  "nm",
  "ny",
  "nc",
  "nd",
  "oh",
  "ok",
  "or",
  "pa",
  "ri",
  "sc",
  "sd",
  "tn",
  "tx",
  "ut",
  "vt",
  "va",
  "wa",
  "wv",
  "wi",
  "wy",
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "newhampshire",
  "newjersey",
  "newmexico",
  "newyork",
  "northcarolina",
  "northdakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhodeisland",
  "southcarolina",
  "southdakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "westvirginia",
  "wisconsin",
  "wyoming",
]);

export function isLikelyAddressCandidate(candidate: string): boolean {
  if (!candidate) {
    return false;
  }
  const normalized = candidate.toLowerCase();
  const hasStreetSuffix = STREET_SUFFIX_REGEX.test(normalized);
  const hasZip = /\b\d{5}(?:-\d{4})?\b/.test(normalized);
  const hasDigit = /\d/.test(normalized);
  if (hasZip) {
    return true;
  }
  if (hasDigit && hasStreetSuffix) {
    return true;
  }
  if (!hasDigit && hasStreetSuffix) {
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.length >= 2;
  }
  return false;
}

export function isLikelyHouseNumberOnly(value: string): boolean {
  if (!value) {
    return false;
  }
  const compact = value.replace(/\s+/g, "");
  return /^[0-9]{1,6}[A-Za-z]?$/.test(compact);
}

export function isLikelyStreetOnly(value: string): boolean {
  if (!value) {
    return false;
  }
  if (/\d/.test(value)) {
    return false;
  }
  return STREET_SUFFIX_REGEX.test(value);
}

export function normalizeAddressCandidate(
  value: string,
  sanitizer: VoiceAddressSanitizer,
): string {
  const cleaned = sanitizer.sanitizeText(value);
  return sanitizer.normalizeWhitespace(cleaned);
}

export function stripAddressLeadIn(
  value: string,
  sanitizer: VoiceAddressSanitizer,
): string {
  if (!value) {
    return "";
  }
  const trimmed = sanitizer.normalizeWhitespace(value);
  const withoutAddressPrefix = trimmed.replace(
    /^(?:my\s+address\s+is|the\s+address\s+is|address\s+is|service\s+address\s+is)\s+/i,
    "",
  );
  return withoutAddressPrefix.replace(/^(?:it is|it's)\s+/i, "").trim();
}

export function isEquivalentAddressCandidate(
  leftValue: string,
  rightValue: string,
  sanitizer: VoiceAddressSanitizer,
): boolean {
  const normalize = (value: string) =>
    normalizeAddressCandidate(value, sanitizer)
      .toLowerCase()
      .replace(/[\s,.-]+/g, " ")
      .trim();
  const left = normalize(leftValue);
  const right = normalize(rightValue);
  return Boolean(left && right && left === right);
}

export function normalizeAddressComponent(
  value: string | null | undefined,
  sanitizer: VoiceAddressSanitizer,
): string | null {
  if (!value) {
    return null;
  }
  const cleaned = sanitizer.sanitizeText(value);
  const normalized = sanitizer.normalizeWhitespace(cleaned);
  return normalized || null;
}

export function compactAddressParts(
  parts: VoiceAddressParts,
): VoiceAddressParts {
  const compact: VoiceAddressParts = {};
  if (parts.houseNumber) {
    compact.houseNumber = parts.houseNumber;
  }
  if (parts.street) {
    compact.street = parts.street;
  }
  if (parts.city) {
    compact.city = parts.city;
  }
  if (parts.state) {
    compact.state = parts.state;
  }
  if (parts.zip) {
    compact.zip = parts.zip;
  }
  return compact;
}

export function mergeAddressParts(
  current: VoiceAddressStateSnapshot,
  extracted: VoiceAddressParts,
): VoiceAddressParts {
  return {
    houseNumber: extracted.houseNumber ?? current.houseNumber ?? null,
    street: extracted.street ?? current.street ?? null,
    city: extracted.city ?? current.city ?? null,
    state: extracted.state ?? current.state ?? null,
    zip: extracted.zip ?? current.zip ?? null,
  };
}

export function buildAddressCandidateFromParts(
  parts: VoiceAddressParts,
): string | null {
  const line1 = [parts.houseNumber, parts.street].filter(Boolean).join(" ");
  const locality = [parts.city, parts.state, parts.zip]
    .filter(Boolean)
    .join(" ");
  const combined = [line1, locality].filter(Boolean).join(", ");
  return combined || null;
}

export function extractAddressPartsFromCandidate(
  candidate: string,
  sanitizer: VoiceAddressSanitizer,
): VoiceAddressParts {
  const normalized = normalizeAddressCandidate(candidate, sanitizer);
  if (!normalized) {
    return {};
  }
  const tokens = normalized.replace(/,/g, " , ").split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return {};
  }
  const normalizedTokens = tokens.map((token) =>
    stripLocalityToken(token.toLowerCase()),
  );
  let zipIndex = normalizedTokens.findIndex((token) =>
    /^\d{5}(?:-\d{4})?$/.test(token),
  );
  if (zipIndex === 0 && tokens.length === 1) {
    zipIndex = -1;
  }
  const zip = zipIndex >= 0 ? tokens[zipIndex] : null;
  let stateIndex = -1;
  if (zipIndex > 0 && isStateToken(normalizedTokens[zipIndex - 1])) {
    stateIndex = zipIndex - 1;
  } else {
    stateIndex = normalizedTokens.findIndex((token) => isStateToken(token));
  }
  const stateToken = stateIndex >= 0 ? normalizedTokens[stateIndex] : null;
  const state = stateToken ? normalizeStateToken(stateToken) : null;
  const commaIndex = tokens.indexOf(",");
  const houseIndex = normalizedTokens.findIndex(
    (token, index) => /\d/.test(token) && index !== zipIndex,
  );
  const houseNumber = houseIndex >= 0 ? tokens[houseIndex] : null;

  let streetTokens: string[] = [];
  if (houseIndex >= 0) {
    const stopCandidates = [commaIndex, stateIndex, zipIndex].filter(
      (index) => index >= 0,
    );
    const stopIndex = stopCandidates.length
      ? Math.min(...stopCandidates)
      : tokens.length;
    if (houseIndex + 1 < stopIndex) {
      streetTokens = tokens.slice(houseIndex + 1, stopIndex);
    }
  }
  if (!streetTokens.length) {
    const suffixIndex = tokens.findIndex((token) =>
      STREET_SUFFIXES.has(token.toLowerCase()),
    );
    if (suffixIndex >= 0) {
      streetTokens = tokens.slice(0, suffixIndex + 1);
    }
  }
  const street = streetTokens.length ? streetTokens.join(" ") : null;

  let cityTokens: string[] = [];
  if (commaIndex >= 0) {
    const endCandidates = [stateIndex, zipIndex].filter((index) => index >= 0);
    const endIndex = endCandidates.length
      ? Math.min(...endCandidates)
      : tokens.length;
    if (commaIndex + 1 < endIndex) {
      cityTokens = tokens.slice(commaIndex + 1, endIndex);
    }
  } else if (streetTokens.length) {
    const startIndex = streetTokens.length + (houseIndex >= 0 ? 1 : 0);
    const endCandidates = [stateIndex, zipIndex].filter((index) => index >= 0);
    const endIndex = endCandidates.length
      ? Math.min(...endCandidates)
      : tokens.length;
    if (startIndex < endIndex) {
      cityTokens = tokens.slice(startIndex, endIndex);
    }
  }
  const city = cityTokens.length ? cityTokens.join(" ") : null;

  return {
    ...(houseNumber ? { houseNumber } : {}),
    ...(street ? { street } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(zip ? { zip } : {}),
  };
}

export function hasStructuredAddressParts(
  addressState: VoiceAddressStateSnapshot,
): boolean {
  return Boolean(
    addressState.houseNumber ||
    addressState.street ||
    addressState.city ||
    addressState.state ||
    addressState.zip,
  );
}

export function getAddressMissingParts(
  addressState: VoiceAddressStateSnapshot,
): {
  houseNumber: boolean;
  street: boolean;
  locality: boolean;
} {
  const hasZip = Boolean(addressState.zip);
  const hasCityAndState = Boolean(addressState.city && addressState.state);
  return {
    houseNumber: !addressState.houseNumber,
    street: !addressState.street,
    locality: !(hasZip || hasCityAndState),
  };
}

export function parseLocalityParts(
  value: string,
  sanitizer: VoiceAddressSanitizer,
): { city: string | null; state: string | null; zip: string | null } {
  const cleaned = normalizeAddressComponent(value, sanitizer);
  if (!cleaned) {
    return { city: null, state: null, zip: null };
  }
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const normalizedTokens = tokens.map((token) =>
    stripLocalityToken(token.toLowerCase()),
  );
  const zipIndex = normalizedTokens.findIndex((token) =>
    /^\d{5}(?:-\d{4})?$/.test(token),
  );
  const stateIndex = normalizedTokens.findIndex((token) => isStateToken(token));
  const zip = zipIndex >= 0 ? tokens[zipIndex] : null;
  const stateToken = stateIndex >= 0 ? normalizedTokens[stateIndex] : null;
  const state = stateToken ? normalizeStateToken(stateToken) : null;
  const cityTokens = tokens.filter(
    (_token, index) => index !== zipIndex && index !== stateIndex,
  );
  const city = cityTokens.length ? cityTokens.join(" ") : null;
  return { city, state, zip };
}

export function extractAddressLocalityCorrection(
  value: string,
  sanitizer: VoiceAddressSanitizer,
): {
  city?: string | null;
  state?: string | null;
  zip?: string | null;
} | null {
  const normalized = normalizeAddressCandidate(value, sanitizer);
  if (!normalized) {
    return null;
  }
  const stripped = stripAddressLeadIn(normalized, sanitizer);
  const lowered = stripped.toLowerCase();
  const hasStreetSuffix = STREET_SUFFIX_REGEX.test(lowered);
  const hasHouseAndTail = /^\d+\s+\S+/.test(stripped);
  if (hasStreetSuffix || hasHouseAndTail) {
    return null;
  }
  if (
    /^(yes|yeah|yep|yup|yah|ya|yuh|yellow|yello|correct|that's right|that is right|right|ok|okay|affirmative|no|nope|negative)$/i.test(
      stripped,
    )
  ) {
    return null;
  }
  const parsed = parseLocalityParts(stripped, sanitizer);
  const cityToken = parsed.city?.trim().toLowerCase() ?? "";
  const city =
    cityToken && !CONFIRMATION_WORDS.has(cityToken) ? parsed.city : null;
  const hasSignal = Boolean(
    parsed.zip || parsed.state || (city && parsed.state),
  );
  if (!hasSignal) {
    return null;
  }
  return {
    ...(city ? { city } : {}),
    ...(parsed.state ? { state: parsed.state } : {}),
    ...(parsed.zip ? { zip: parsed.zip } : {}),
  };
}

export function normalizeStateToken(token: string): string {
  if (!token) {
    return "";
  }
  const cleaned = token.replace(/\s+/g, "");
  if (cleaned.length === 2) {
    return cleaned.toUpperCase();
  }
  return toTitleCase(cleaned.toLowerCase());
}

export function isIncompleteAddress(candidate: string): boolean {
  const normalized = candidate.replace(/\s+/g, " ").trim();
  if (normalized.length < 6) {
    return true;
  }
  const hasDigit = /\d/.test(normalized);
  const hasAlpha = /[A-Za-z]/.test(normalized);
  if (!hasDigit) {
    return true;
  }
  if (!hasAlpha) {
    return true;
  }
  if (/^\d+$/.test(normalized) || /^[A-Za-z\s]+$/.test(normalized)) {
    return true;
  }
  if (!/^\d+\s+\S+/.test(normalized)) {
    return true;
  }
  if (/\s[A-Za-z]\s*$/.test(normalized)) {
    return true;
  }
  if (/\.\.\.|\u2026/.test(normalized)) {
    return true;
  }
  const abbrevMatch = normalized.match(
    /\s([A-Za-z]{1,2})\s+(st|rd|dr|ave|blvd|ln|ct)\s*$/i,
  );
  if (abbrevMatch && abbrevMatch[1].length <= 2) {
    return true;
  }
  return false;
}

export function isMissingLocality(candidate: string): boolean {
  const normalized = candidate.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const tokens = normalized
    .split(" ")
    .filter(Boolean)
    .map((token) => stripLocalityToken(token));
  const zipIndex = findZipTokenIndex(tokens);
  if (zipIndex >= 0) {
    return false;
  }
  const stateIndex = findStateTokenIndex(tokens);
  if (stateIndex === null || stateIndex < 0) {
    return true;
  }
  const cityTokens = tokens.slice(Math.max(0, stateIndex - 3), stateIndex);
  return !cityTokens.some((token) => isCityToken(token));
}

export function findZipTokenIndex(tokens: string[]): number {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (/^\d{5}(?:-\d{4})?$/.test(tokens[i])) {
      return i;
    }
  }
  return -1;
}

export function findStateTokenIndex(tokens: string[]): number | null {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (isStateToken(tokens[i])) {
      return i;
    }
  }
  return null;
}

export function isStateToken(token: string): boolean {
  return US_STATE_TOKENS.has(token.replace(/\s+/g, ""));
}

export function isCityToken(token: string): boolean {
  if (!token || /^\d+$/.test(token)) {
    return false;
  }
  return !STREET_SUFFIXES.has(token);
}

export function stripLocalityToken(token: string): string {
  return token.replace(/[^a-z0-9-]/gi, "");
}

export function mergeAddressWithLocality(
  candidate: string,
  locality: string,
): string {
  const normalized = locality.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return candidate;
  }
  const lowerCandidate = candidate.toLowerCase();
  const lowerLocality = normalized.toLowerCase();
  if (lowerCandidate.includes(lowerLocality)) {
    return candidate;
  }
  return `${candidate} ${normalized}`.replace(/\s+/g, " ").trim();
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
