import type {
  BookingFields,
  CallDeskCategory,
  CallDeskUrgency,
} from "./call-desk-state";

const CATEGORY_MATCHERS: Array<{
  category: CallDeskCategory;
  patterns: RegExp[];
}> = [
  {
    category: "HEATING",
    patterns: [/heat/, /heater/, /furnace/, /boiler/, /no heat/],
  },
  {
    category: "COOLING",
    patterns: [/cool/, /ac /, /a\/c/, /air conditioning/, /no ac/],
  },
  {
    category: "PLUMBING",
    patterns: [/plumb/, /pipe/, /water heater/, /leak/, /sink/, /toilet/],
  },
  {
    category: "ELECTRICAL",
    patterns: [/electri/, /outlet/, /breaker/, /panel/, /sparks/],
  },
  {
    category: "DRAINS",
    patterns: [/drain/, /sewer/, /clog/, /backup/],
  },
  {
    category: "GENERAL_HANDYMAN_CONSTRUCTION",
    patterns: [/remodel/, /handyman/, /general/, /construction/, /repair job/],
  },
];

const URGENCY_EMERGENCY = [
  /emergency/,
  /urgent/,
  /asap/,
  /right away/,
  /immediately/,
  /no heat/,
  /no ac/,
  /freezing/,
  /cold in here/,
  /cold air/,
  /blowing cold air/,
  /blowing warm air/,
  /no cooling/,
  /burning up/,
  /hot in here/,
  /sweating bullets/,
  /sweating/,
  /too hot/,
  /\b(?:40|41|42|43|44|45|50|55|60)\s*degrees\b/,
  /\bfurnace\b.*\bnot (cutting|turning) on\b/,
  /\bnot (cutting|turning) on\b.*\bfurnace\b/,
  /leak/,
  /flood/,
  /sparks/,
  /burning smell/,
  /gas/,
];

const URGENCY_HIGH = [
  /high priority/,
  /high-priority/,
  /soon/,
  /today/,
  /tomorrow/,
  /whenever you can/,
];

const URGENCY_STANDARD = [/standard/, /not urgent/, /routine/];

const URGENCY_QUESTION_PATTERNS =
  /\b(is this|is it|would you say|do you consider|how urgent|urgency|priority)\b/i;

const URGENCY_STATEMENT_PATTERNS: Record<CallDeskUrgency, RegExp[]> = {
  EMERGENCY: [
    /\bwe'?ll (treat|classify|mark|handle|prioritize) (this )?as (an )?emergency\b/i,
    /\bwe will (treat|classify|mark|handle|prioritize) (this )?as (an )?emergency\b/i,
    /\bthis is (an )?emergency\b/i,
    /\b(emergency)\s+(call|situation|request)\b/i,
  ],
  HIGH_PRIORITY: [
    /\bwe'?ll (treat|classify|mark|handle|prioritize) (this )?as (a )?high priority\b/i,
    /\bwe will (treat|classify|mark|handle|prioritize) (this )?as (a )?high priority\b/i,
    /\bthis is (a )?high priority\b/i,
    /\bhigh priority\s+(request|call|situation)\b/i,
  ],
  STANDARD: [
    /\bwe'?ll (treat|classify|mark|handle) (this )?as (a )?standard\b/i,
    /\bwe will (treat|classify|mark|handle) (this )?as (a )?standard\b/i,
    /\bthis is (a )?standard\b/i,
    /\bstandard\s+(request|call|situation)\b/i,
  ],
};

const DATE_REGEX = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/;
const TIME_REGEX = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
const AFTER_TIME_REGEX =
  /\b(after|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const BEFORE_TIME_REGEX =
  /\b(before|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const BETWEEN_TIME_REGEX =
  /\b(today|tomorrow|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b.*\bbetween\b\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+\b(and|to|-)\b\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

const WINDOW_PATTERNS: Array<[RegExp, string]> = [
  [/(today|tomorrow|tonight|this weekend)/i, "$1"],
  [/morning/i, "morning"],
  [/(after\s+noon|afternoon)/i, "afternoon"],
  [/evening|night/i, "evening"],
  [/any\s*time\s*today/i, "today"],
  [/next\s+week/i, "next week"],
  [/\basap\b|\bright away|\bas soon as possible/i, "asap"],
];

const ADDRESS_REGEX = /\b\d{3,}[^\n,]*?(street|st\b|avenue|ave\b|road|rd\b|lane|ln\b|drive|dr\b|court|ct\b|way|blvd)/i;
const PHONE_REGEX =
  /(?:phone|number|call(?: me)? at|reach me at)\s*[:\-]?\s*((?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4})/i;
const LOOSE_PHONE_REGEX =
  /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}/;
const NAME_REGEX =
  /(?:my name is|this is|i am|i'm)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i;
const NAME_COLON_REGEX = /name\s*[:\-]\s*([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i;
const ADDRESS_PREFIX_REGEX =
  /(address|located at|we are at|i live at)\s*[:\-]?\s*([^.,\n]+)/i;

const STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
]);

const STATE_NAMES = new Map<string, string>([
  ["alabama", "AL"],
  ["alaska", "AK"],
  ["arizona", "AZ"],
  ["arkansas", "AR"],
  ["california", "CA"],
  ["colorado", "CO"],
  ["connecticut", "CT"],
  ["delaware", "DE"],
  ["florida", "FL"],
  ["georgia", "GA"],
  ["hawaii", "HI"],
  ["idaho", "ID"],
  ["illinois", "IL"],
  ["indiana", "IN"],
  ["iowa", "IA"],
  ["kansas", "KS"],
  ["kentucky", "KY"],
  ["louisiana", "LA"],
  ["maine", "ME"],
  ["maryland", "MD"],
  ["massachusetts", "MA"],
  ["michigan", "MI"],
  ["minnesota", "MN"],
  ["mississippi", "MS"],
  ["missouri", "MO"],
  ["montana", "MT"],
  ["nebraska", "NE"],
  ["nevada", "NV"],
  ["new hampshire", "NH"],
  ["new jersey", "NJ"],
  ["new mexico", "NM"],
  ["new york", "NY"],
  ["north carolina", "NC"],
  ["north dakota", "ND"],
  ["ohio", "OH"],
  ["oklahoma", "OK"],
  ["oregon", "OR"],
  ["pennsylvania", "PA"],
  ["rhode island", "RI"],
  ["south carolina", "SC"],
  ["south dakota", "SD"],
  ["tennessee", "TN"],
  ["texas", "TX"],
  ["utah", "UT"],
  ["vermont", "VT"],
  ["virginia", "VA"],
  ["washington", "WA"],
  ["west virginia", "WV"],
  ["wisconsin", "WI"],
  ["wyoming", "WY"],
]);

const STREET_ONLY_REGEX =
  /(\d{1,6}\s+[A-Za-z0-9.#\s]+?\b(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway)\b)/i;
const ZIP_REGEX = /\b\d{5}(?:-\d{4})?\b/;

const NAME_STOPWORDS = new Set([
  "sweating",
  "freezing",
  "cold",
  "hot",
  "burning",
  "sweaty",
  "frustrated",
  "upset",
  "angry",
  "stressed",
  "worried",
  "scared",
  "nervous",
  "pain",
  "hurting",
  "tired",
  "sick",
  "today",
  "tomorrow",
  "asap",
  "emergency",
  "urgent",
  "priority",
  "standard",
  "yes",
  "yeah",
  "yep",
  "ok",
  "okay",
  "sure",
  "address",
  "phone",
  "number",
  "time",
  "window",
]);

type AddressParts = {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
};

const STATE_NAME_PATTERN = Array.from(STATE_NAMES.keys())
  .map((name) => name.replace(/\s+/g, "\\s+"))
  .join("|");
const STATE_CODE_PATTERN = Array.from(STATE_CODES).join("|");
const STATE_TOKEN_PATTERN = new RegExp(
  `\\b(${STATE_CODE_PATTERN}|${STATE_NAME_PATTERN})\\b`,
  "i",
);
const FULL_ADDRESS_PATTERN = new RegExp(
  `(\\d{1,6}\\s+[A-Za-z0-9.#\\s]+?\\b(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway)\\b)\\s*,?\\s*([A-Za-z.'\\s]{2,40})\\s*,?\\s*(${STATE_CODE_PATTERN}|${STATE_NAME_PATTERN})\\s*,?\\s*(\\d{5}(?:-\\d{4})?)`,
  "i",
);
const CITY_STATE_PATTERN = new RegExp(
  `\\b(?:in|at|from|located\\s+in|located\\s+at)?\\s*([A-Za-z.'\\s]{2,40})\\s*,?\\s*(${STATE_CODE_PATTERN}|${STATE_NAME_PATTERN})\\b`,
  "ig",
);
const CITY_INVALID_PATTERN =
  /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway)\b/i;

type ParsedPreferredWindow =
  | { kind: "none" }
  | { kind: "asap" }
  | {
      kind: "day_part";
      day: "today" | "tomorrow";
      part: "morning" | "afternoon" | "evening";
    }
  | { kind: "anytime"; day: "today" | "tomorrow" }
  | { kind: "after"; day?: "today" | "tomorrow"; time24: string }
  | { kind: "before"; day?: "today" | "tomorrow"; time24: string }
  | {
      kind: "between";
      day?: "today" | "tomorrow" | string;
      start24: string;
      end24: string;
    }
  | { kind: "date_time"; date: string; time24?: string };

function to24h(h: number, m: number, ampm?: string): string {
  let hh = h;
  const ap = (ampm || "").toLowerCase();
  if (ap === "pm" && hh < 12) hh += 12;
  if (ap === "am" && hh === 12) hh = 0;
  const mm = Math.max(0, Math.min(59, m));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parsePreferredWindow(textRaw: string): ParsedPreferredWindow {
  const text = normalizeSpaces((textRaw || "").toLowerCase());
  if (!text) return { kind: "none" };

  if (/\b(asap|right away|as soon as possible|immediately)\b/.test(text)) {
    return { kind: "asap" };
  }

  const dateMatch = text.match(DATE_REGEX);
  if (dateMatch) {
    const mm = String(parseInt(dateMatch[1], 10)).padStart(2, "0");
    const dd = String(parseInt(dateMatch[2], 10)).padStart(2, "0");
    const yyyyRaw = dateMatch[3];
    const yyyy = yyyyRaw
      ? yyyyRaw.length === 2
        ? `20${yyyyRaw}`
        : yyyyRaw
      : "";
    const date = yyyy ? `${yyyy}-${mm}-${dd}` : `${mm}/${dd}`;

    if (/\bnoon\b/.test(text)) {
      return { kind: "date_time", date, time24: "12:00" };
    }
    if (/\bmidnight\b/.test(text)) {
      return { kind: "date_time", date, time24: "00:00" };
    }
    const timeMatch = text.match(TIME_REGEX);
    if (timeMatch) {
      return {
        kind: "date_time",
        date,
        time24: to24h(
          parseInt(timeMatch[1], 10),
          parseInt(timeMatch[2] || "0", 10),
          timeMatch[3],
        ),
      };
    }
    return { kind: "date_time", date };
  }

  const betweenMatch = text.match(BETWEEN_TIME_REGEX);
  if (betweenMatch) {
    const dayToken = betweenMatch[1];
    const startH = parseInt(betweenMatch[2], 10);
    const startM = parseInt(betweenMatch[3] || "0", 10);
    const startAp = betweenMatch[4];
    const endH = parseInt(betweenMatch[6], 10);
    const endM = parseInt(betweenMatch[7] || "0", 10);
    const endAp = betweenMatch[8] || startAp;
    if (startAp || endAp) {
      return {
        kind: "between",
        day: dayToken,
        start24: to24h(startH, startM, startAp),
        end24: to24h(endH, endM, endAp),
      };
    }
    return {
      kind: "between",
      day: dayToken,
      start24: `${String(startH).padStart(2, "0")}:${String(startM).padStart(
        2,
        "0",
      )}`,
      end24: `${String(endH).padStart(2, "0")}:${String(endM).padStart(
        2,
        "0",
      )}`,
    };
  }

  const dayMatch = text.match(/\b(today|tomorrow)\b/i);
  const afterMatch = text.match(AFTER_TIME_REGEX);
  if (afterMatch) {
    const time24 = afterMatch[4]
      ? to24h(
          parseInt(afterMatch[2], 10),
          parseInt(afterMatch[3] || "0", 10),
          afterMatch[4],
        )
      : `${String(afterMatch[2]).padStart(2, "0")}:${String(
          afterMatch[3] || "0",
        ).padStart(2, "0")}`;
    return {
      kind: "after",
      day: dayMatch?.[1] as "today" | "tomorrow",
      time24,
    };
  }

  const beforeMatch = text.match(BEFORE_TIME_REGEX);
  if (beforeMatch) {
    const time24 = beforeMatch[4]
      ? to24h(
          parseInt(beforeMatch[2], 10),
          parseInt(beforeMatch[3] || "0", 10),
          beforeMatch[4],
        )
      : `${String(beforeMatch[2]).padStart(2, "0")}:${String(
          beforeMatch[3] || "0",
        ).padStart(2, "0")}`;
    return {
      kind: "before",
      day: dayMatch?.[1] as "today" | "tomorrow",
      time24,
    };
  }

  if (/\bnoon\b/.test(text)) {
    if (/\btoday\b/.test(text)) {
      return { kind: "date_time", date: "today", time24: "12:00" };
    }
    if (/\btomorrow\b/.test(text)) {
      return { kind: "date_time", date: "tomorrow", time24: "12:00" };
    }
    return { kind: "date_time", date: "noon" };
  }

  const dayPart = text.match(
    /\b(today|tomorrow)\b.*\b(morning|afternoon|evening)\b/,
  );
  if (dayPart) {
    return {
      kind: "day_part",
      day: dayPart[1] as "today" | "tomorrow",
      part: dayPart[2] as "morning" | "afternoon" | "evening",
    };
  }

  const thisPart = text.match(/\bthis\b.*\b(morning|afternoon|evening)\b/);
  if (thisPart) {
    return {
      kind: "day_part",
      day: "today",
      part: thisPart[1] as "morning" | "afternoon" | "evening",
    };
  }

  if (/\b(any ?time|anytime)\b/.test(text)) {
    if (/\btomorrow\b/.test(text)) {
      return { kind: "anytime", day: "tomorrow" };
    }
    return { kind: "anytime", day: "today" };
  }

  for (const [pattern, label] of WINDOW_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = (match[1] ?? label).toLowerCase();
    if (value === "asap") return { kind: "asap" };
    if (value === "morning" || value === "afternoon" || value === "evening") {
      return { kind: "day_part", day: "today", part: value };
    }
    if (value === "today" || value === "tomorrow") {
      return { kind: "anytime", day: value as "today" | "tomorrow" };
    }
    return { kind: "date_time", date: value };
  }

  return { kind: "none" };
}

export function extractZip(text: string): string | null {
  const match = text.match(ZIP_REGEX);
  return match ? match[0] : null;
}

export function extractState(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [name, code] of STATE_NAMES.entries()) {
    const pattern = new RegExp(`\\b${name}\\b`);
    if (pattern.test(lower)) {
      return code;
    }
  }
  const shortMatch = lower.match(/\b([a-z]{2})\b/);
  if (shortMatch) {
    const code = shortMatch[1].toUpperCase();
    if (STATE_CODES.has(code)) {
      return code;
    }
  }
  return null;
}

export function extractStreet(text: string): string | null {
  const match = text.match(STREET_ONLY_REGEX);
  return match ? match[1].trim() : null;
}

export function isLikelyCity(text: string): boolean {
  const cleaned = text.trim();
  if (!cleaned || /\d/.test(cleaned)) {
    return false;
  }
  if (extractState(cleaned)) {
    return false;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 3;
}

export function getAddressParts(address?: string): AddressParts {
  if (!address) {
    return {};
  }
  const normalized = normalizeSpaces(address.replace(/,/g, " "));
  const fullMatch = normalized.match(FULL_ADDRESS_PATTERN);
  if (fullMatch) {
    const state = extractState(fullMatch[3]) ?? undefined;
    return {
      street: normalizeSpaces(fullMatch[1]),
      city: titleCaseWords(fullMatch[2]),
      state,
      zip: fullMatch[4],
    };
  }
  const street = extractStreet(normalized) ?? undefined;
  const zip = extractZip(normalized) ?? undefined;
  const state = extractState(normalized) ?? undefined;
  let city: string | undefined;

  if (street) {
    const streetIndex = normalized.toLowerCase().indexOf(street.toLowerCase());
    const afterStreet = streetIndex >= 0
      ? normalized.slice(streetIndex + street.length)
      : normalized;
    const stateIndex = state
      ? afterStreet.toLowerCase().indexOf(state.toLowerCase())
      : -1;
    const zipIndex = zip ? afterStreet.indexOf(zip) : -1;
    const endIndex =
      stateIndex >= 0 && zipIndex >= 0
        ? Math.min(stateIndex, zipIndex)
        : stateIndex >= 0
          ? stateIndex
          : zipIndex;
    if (endIndex > 0) {
      const candidate = normalizeSpaces(afterStreet.slice(0, endIndex));
      if (candidate.length >= 2) {
        city = candidate;
      }
    }
  }

  if (!city) {
    const cityMatch = address.match(/,\s*([A-Za-z.\s]+?)(?:,|$)/);
    if (cityMatch) {
      const candidate = normalizeSpaces(cityMatch[1]);
      if (candidate.length >= 2) {
        city = candidate;
      }
    }
  }

  return { street, city, state, zip };
}

function titleCaseWords(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function extractAddressPartsFromMessage(message: string): AddressParts {
  const normalized = normalizeSpaces(message.replace(/,/g, " "));
  const parts: AddressParts = {};

  const fullMatch = normalized.match(FULL_ADDRESS_PATTERN);
  if (fullMatch) {
    parts.street = normalizeSpaces(fullMatch[1]);
    parts.city = titleCaseWords(fullMatch[2]);
    parts.state = extractState(fullMatch[3]) ?? undefined;
    parts.zip = fullMatch[4];
    return parts;
  }

  const street = extractStreet(normalized);
  if (street) {
    parts.street = street;
  }

  const zip = extractZip(normalized);
  if (zip) {
    parts.zip = zip;
  }

  const state = extractState(normalized);
  if (state) {
    parts.state = state;
  }

  const matches = Array.from(normalized.matchAll(CITY_STATE_PATTERN));
  if (matches.length > 0) {
    const match = matches[matches.length - 1];
    const cityCandidate = normalizeSpaces(match[1]);
    const stateToken = match[2];
    if (!parts.state) {
      const normalizedState = extractState(stateToken);
      if (normalizedState) {
        parts.state = normalizedState;
      }
    }
    if (!CITY_INVALID_PATTERN.test(cityCandidate)) {
      const cityTokens = cityCandidate.split(/\s+/).filter(Boolean);
      const trimmedCity = cityTokens.slice(-3).join(" ");
      if (isLikelyCity(trimmedCity)) {
        parts.city = titleCaseWords(trimmedCity);
      }
    }
  } else if (STATE_TOKEN_PATTERN.test(normalized)) {
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const stateIndex = tokens.findIndex((token) =>
      extractState(token.toLowerCase()),
    );
    if (stateIndex > 0) {
      const cityTokens = tokens.slice(Math.max(0, stateIndex - 3), stateIndex);
      const cityCandidate = cityTokens.join(" ");
      if (
        !CITY_INVALID_PATTERN.test(cityCandidate) &&
        isLikelyCity(cityCandidate)
      ) {
        parts.city = titleCaseWords(cityCandidate);
      }
    }
  } else if (isLikelyCity(normalized)) {
    parts.city = titleCaseWords(normalized);
  }

  if (!parts.city && parts.street && parts.state) {
    const streetIndex = normalized.toLowerCase().indexOf(parts.street.toLowerCase());
    const afterStreet =
      streetIndex >= 0
        ? normalized.slice(streetIndex + parts.street.length)
        : normalized;
    const stateIndex = parts.state
      ? afterStreet.toLowerCase().indexOf(parts.state.toLowerCase())
      : -1;
    const zipIndex = parts.zip ? afterStreet.indexOf(parts.zip) : -1;
    const endIndex =
      stateIndex >= 0 && zipIndex >= 0
        ? Math.min(stateIndex, zipIndex)
        : stateIndex >= 0
          ? stateIndex
          : zipIndex;
    if (endIndex > 0) {
      const candidate = normalizeSpaces(afterStreet.slice(0, endIndex));
      if (
        candidate.length >= 2 &&
        !CITY_INVALID_PATTERN.test(candidate) &&
        isLikelyCity(candidate)
      ) {
        parts.city = titleCaseWords(candidate);
      }
    }
  }

  return parts;
}

export function assembleAddress(parts: AddressParts): string | null {
  const components: string[] = [];
  if (parts.street) components.push(parts.street);
  if (parts.city) components.push(parts.city);
  if (parts.state) components.push(parts.state);
  let base = components.join(", ");
  if (parts.zip) {
    base = base ? `${base} ${parts.zip}` : parts.zip;
  }
  return base || null;
}

export function getMissingAddressParts(address?: string): string[] {
  const parts = getAddressParts(address);
  const missing: string[] = [];
  if (!parts.street) missing.push("street");
  if (!parts.city) missing.push("city");
  if (!parts.state) missing.push("state");
  if (!parts.zip) missing.push("zip");
  return missing;
}

export function isCompleteAddress(address?: string): boolean {
  return getMissingAddressParts(address).length === 0;
}

export function stringifyPreferredWindow(
  parsed: ParsedPreferredWindow,
): string | null {
  switch (parsed.kind) {
    case "none":
      return null;
    case "asap":
      return "ASAP";
    case "anytime":
      return `${parsed.day} anytime`;
    case "day_part":
      return `${parsed.day} ${parsed.part}`;
    case "after":
      return `${parsed.day ? `${parsed.day} ` : ""}after ${parsed.time24}`;
    case "before":
      return `${parsed.day ? `${parsed.day} ` : ""}before ${parsed.time24}`;
    case "between":
      return `${parsed.day ? `${parsed.day} ` : ""}between ${parsed.start24} and ${parsed.end24}`;
    case "date_time":
      if (parsed.time24) {
        if (parsed.date === "today" || parsed.date === "tomorrow") {
          return `${parsed.date} at ${parsed.time24}`;
        }
        return `${parsed.date} ${parsed.time24}`;
      }
      return parsed.date;
    default:
      return null;
  }
}

export function detectCategory(text: string): CallDeskCategory | null {
  const lower = text.toLowerCase();
  for (const matcher of CATEGORY_MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(lower))) {
      return matcher.category;
    }
  }
  return null;
}

export function detectUrgency(text: string): CallDeskUrgency | null {
  const lower = text.toLowerCase();
  if (URGENCY_EMERGENCY.some((pattern) => pattern.test(lower))) {
    return "EMERGENCY";
  }
  if (URGENCY_HIGH.some((pattern) => pattern.test(lower))) {
    return "HIGH_PRIORITY";
  }
  if (URGENCY_STANDARD.some((pattern) => pattern.test(lower))) {
    return "STANDARD";
  }
  return null;
}

export function detectUrgencyAcknowledgement(
  text: string,
  urgency?: CallDeskUrgency | null,
): boolean {
  if (!urgency) {
    return false;
  }
  const lower = text.toLowerCase();
  const label =
    urgency === "HIGH_PRIORITY"
      ? "high priority"
      : urgency === "STANDARD"
        ? "standard"
        : "emergency";
  if (!lower.includes(label)) {
    return false;
  }
  if (URGENCY_QUESTION_PATTERNS.test(lower)) {
    return false;
  }
  return URGENCY_STATEMENT_PATTERNS[urgency].some((pattern) =>
    pattern.test(lower),
  );
}

export function detectPreferredWindow(text: string): string | undefined {
  const parsed = parsePreferredWindow(text);
  return stringifyPreferredWindow(parsed) ?? undefined;
}

export function extractBookingFields(textRaw: string): Partial<BookingFields> {
  const text = (textRaw || "").trim();
  const updates: Partial<BookingFields> = {};

  if (!text) return updates;

  /* =========================
   * PHONE (tolerant US)
   * ========================= */
  const phoneMatch = text.match(
    /(?:\+?1[\s-]?)?(?:\(?(\d{3})\)?)[\s.-]?(\d{3})[\s.-]?(\d{4})/
  );
  if (phoneMatch) {
    updates.phone = `${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}`;
  }

  /* =========================
   * NAME (intro patterns)
   * ========================= */
  const nameMatch =
    text.match(
      /\b(?:this is|my name is|i am|i’m|im)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/i
    ) ||
    text.match(/\bname\s+(?:is)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/i);

  if (nameMatch) {
    const candidate = nameMatch[1].trim();
    if (isNameCandidate(candidate)) {
      updates.name = candidate;
    }
  }

  /* =========================
   * ADDRESS (full service address)
   * ========================= */

  // Example:
  // 123 Elm Street Dr, Euclid, OH 44119
  // 987 W 117th St Apt 2B, Cleveland, Ohio 44102
  const ADDRESS_REGEX =
    /(\d{1,6}\s+[A-Za-z0-9.#\s]+?\b(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way)\b[\s,#A-Za-z0-9.-]*,\s*[A-Za-z.\s]+,\s*(?:[A-Z]{2}|Ohio)\s+\d{5}(?:-\d{4})?)/i;
  const ADDRESS_NO_COMMA_REGEX =
    /(\d{1,6}\s+[A-Za-z0-9.#\s]+?\b(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way)\b\s+[A-Za-z.\s]+\s+(?:[A-Z]{2}|Ohio)\s+\d{5}(?:-\d{4})?)/i;

  const ADDRESS_PREFIX_REGEX =
    /\b(?:located at|address is|service address is|i(?:’|')?m at|im at|i(?:’|')?m located at)\s+(.+?)(?:[.?!]|$)/i;

  const addrMatch =
    text.match(ADDRESS_REGEX) ||
    text.match(ADDRESS_NO_COMMA_REGEX) ||
    text.match(ADDRESS_PREFIX_REGEX);

  if (addrMatch) {
    const addr = (addrMatch[1] || "").trim();
    if (addr.length >= 10) {
      updates.address = addr.replace(/\s+/g, " ");
    }
  }

  if (!updates.address) {
    const streetOnly = text.match(STREET_ONLY_REGEX);
    if (streetOnly) {
      updates.address = streetOnly[1].trim().replace(/\s+/g, " ");
    }
  }

  /* =========================
   * ISSUE (start at trade keyword)
   * ========================= */

  const ISSUE_KEYWORDS =
    /\b(furnace|no heat|heater|boiler|ac|air conditioner|air conditioning|leak|clog|drain|water heater|sparks|outlet|breaker|panel)\b/i;

  const issueIndex = text.search(ISSUE_KEYWORDS);
  if (issueIndex >= 0) {
    updates.issue = text
      .slice(issueIndex)
      .replace(/\s+/g, " ")
      .slice(0, 240)
      .trim();
  }

  /* =========================
   * PHOTOS (simple negative)
   * ========================= */
  if (/\b(no photos|don’t have photos|do not have photos|none)\b/i.test(text)) {
    updates.photos = false;
  }

  const parsed = parsePreferredWindow(text);
  const normalizedWindow = stringifyPreferredWindow(parsed);
  if (normalizedWindow) {
    updates.preferred_window = normalizedWindow;
  }

  return updates;
}

export function mergeBookingFields(
  existing: BookingFields,
  incoming: Partial<BookingFields>,
): BookingFields {
  const out: BookingFields = { ...existing };

  (["phone", "address", "issue", "preferred_window"] as const).forEach(
    (k) => {
      const v = incoming[k];
      if (typeof v === "string") {
        const cleaned = v.trim();
        if (cleaned.length >= 2) {
          const current = out[k];
          if (!current || cleaned.length >= current.length) {
            out[k] = cleaned;
          }
        }
      }
    },
  );

  if (typeof incoming.name === "string") {
    const incomingName = incoming.name.trim();
    if (incomingName.length >= 2 && isNameCandidate(incomingName)) {
      const existingName = out.name?.trim();
      const existingValid = existingName
        ? isNameCandidate(existingName)
        : false;
      if (!existingName || !existingValid) {
        out.name = incomingName;
      } else {
        const existingTokens = existingName.split(/\s+/).filter(Boolean);
        const incomingTokens = incomingName.split(/\s+/).filter(Boolean);
        const existingFirst = existingTokens[0]?.toLowerCase();
        const incomingFirst = incomingTokens[0]?.toLowerCase();
        if (
          existingTokens.length === 1 &&
          incomingTokens.length >= 2 &&
          (!existingFirst || existingFirst === incomingFirst)
        ) {
          out.name = incomingName;
        } else if (
          existingTokens.length === 1 &&
          incomingTokens.length === 1 &&
          existingFirst === incomingFirst
        ) {
          out.name = incomingName;
        }
      }
    }
  }

  if (typeof incoming.photos === "boolean") {
    if (incoming.photos || out.photos !== true) {
      out.photos = incoming.photos;
    }
  }

  return out;
}


export function detectFeeDisclosure(text: string): boolean {
  return /\$?99/.test(text) && /diagnostic|service fee/i.test(text);
}

export function detectAffirmation(text: string): boolean {
  return /\b(yes|yeah|yep|hell yeah|correct|that's right|right|sure|ok|okay|you have it|i did|i already did|already did)\b/i.test(
    text,
  );
}

export function detectRequestedField(
  text: string,
): keyof BookingFields | null {
  if (!/\?/.test(text)) {
    return null;
  }

  if (/\b(address|street|city|zip|zip code)\b/i.test(text)) {
    return "address";
  }
  if (/\b(phone|number|reach|call)\b/i.test(text)) {
    return "phone";
  }
  if (/\b(name|full name)\b/i.test(text)) {
    return "name";
  }
  if (/\b(issue|problem|happening|going on|describe)\b/i.test(text)) {
    return "issue";
  }
  if (/\b(time|date|window|availability|schedule|when|soon)\b/i.test(text)) {
    return "preferred_window";
  }
  if (/\b(photo|picture|image)\b/i.test(text)) {
    return "photos";
  }

  return null;
}

export function detectFeeConfirmation(text: string): boolean {
  return /\b(yes|yeah|yep|ok|okay|sure|agree|approved|sounds good|that works)\b/i.test(
    text,
  );
}

export function detectUpsellOffer(text: string): boolean {
  return /maintenance plan|priority service|membership|service plan/i.test(text);
}

export function detectDistress(text: string): boolean {
  return /\b(sleep|can't sleep|cannot sleep|freezing|cold|frustrated|upset|angry|annoyed|in pain|worried|scared|nervous|stressed)\b/i.test(
    text,
  );
}

export function detectPricingQuestion(text: string): boolean {
  return /\b(cost|price|pricing|fee|charge|surcharge|costs more|cost more|extra charge)\b.*\?/i.test(
    text,
  ) || /\b(do|does)\b.*\b(cost|price|fee|charge|surcharge)\b/i.test(text);
}

export function getIssueLabel(
  issue?: string,
  category?: CallDeskCategory | null,
): string {
  const text = (issue ?? "").toLowerCase();
  if (/\bfurnace\b/.test(text)) {
    return "furnace issue";
  }
  if (/\b(heater|heat|boiler)\b/.test(text)) {
    return "heating issue";
  }
  if (/\b(ac|a\/c|air conditioner|cooling)\b/.test(text)) {
    return "AC issue";
  }
  if (/\b(drain|clog|backup)\b/.test(text)) {
    return "drain issue";
  }
  if (/\b(leak|pipe|toilet|sink|water heater|plumb)\b/.test(text)) {
    return "plumbing issue";
  }
  if (/\b(outlet|breaker|panel|sparks|electri)\b/.test(text)) {
    return "electrical issue";
  }

  switch (category) {
    case "HEATING":
      return "heating issue";
    case "COOLING":
      return "AC issue";
    case "PLUMBING":
      return "plumbing issue";
    case "ELECTRICAL":
      return "electrical issue";
    case "DRAINS":
      return "drain issue";
    case "GENERAL_HANDYMAN_CONSTRUCTION":
      return "service request";
    default:
      return "issue";
  }
}

export function isNameCandidate(name: string): boolean {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) {
    return false;
  }
  return tokens.every((token) => {
    if (!/^[A-Za-z][A-Za-z'’-]*$/.test(token)) {
      return false;
    }
    return !NAME_STOPWORDS.has(token.toLowerCase());
  });
}

export function getSafeFirstName(name?: string): string | null {
  if (!name) {
    return null;
  }
  const token = name.trim().split(/\s+/).filter(Boolean)[0];
  if (!token || !isNameCandidate(token)) {
    return null;
  }
  return token.charAt(0).toUpperCase() + token.slice(1);
}
