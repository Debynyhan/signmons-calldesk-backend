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
  /leak/,
  /flood/,
  /sparks/,
  /burning smell/,
  /gas/,
];

const URGENCY_HIGH = [/soon/, /today/, /tomorrow/, /whenever you can/];

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
  return null;
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
    updates.name = nameMatch[1].trim();
  }

  /* =========================
   * ADDRESS (full service address)
   * ========================= */

  // Example:
  // 123 Elm Street Dr, Euclid, OH 44119
  // 987 W 117th St Apt 2B, Cleveland, Ohio 44102
  const ADDRESS_REGEX =
    /(\d{1,6}\s+[A-Za-z0-9.#\s]+?\b(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way)\b[\s,#A-Za-z0-9.-]*,\s*[A-Za-z.\s]+,\s*(?:[A-Z]{2}|Ohio)\s+\d{5}(?:-\d{4})?)/i;

  const ADDRESS_PREFIX_REGEX =
    /\b(?:located at|address is|service address is|i(?:’|')?m at|im at|i(?:’|')?m located at)\s+(.+?)(?:[.?!]|$)/i;

  const addrMatch =
    text.match(ADDRESS_REGEX) || text.match(ADDRESS_PREFIX_REGEX);

  if (addrMatch) {
    const addr = (addrMatch[1] || "").trim();
    if (addr.length >= 10) {
      updates.address = addr.replace(/\s+/g, " ");
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

  (["name", "phone", "address", "issue", "preferred_window"] as const).forEach(
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

export function detectFeeConfirmation(text: string): boolean {
  return /\b(yes|yeah|yep|ok|okay|sure|agree|approved|sounds good|that works)\b/i.test(
    text,
  );
}

export function detectUpsellOffer(text: string): boolean {
  return /maintenance plan|priority service|membership|service plan/i.test(text);
}
