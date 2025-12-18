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
  const normalized = text.trim();
  for (const [pattern, label] of WINDOW_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      const value = match[1] ?? label;
      return value.toLowerCase();
    }
  }
  if (/after\s+noon/i.test(normalized)) {
    return "afternoon";
  }
  if (/today/i.test(normalized) && /after/i.test(normalized)) {
    return "today";
  }
  return undefined;
}

export function extractBookingFields(
  text: string,
  existing: BookingFields,
): Partial<BookingFields> {
  const updates: Partial<BookingFields> = {};
  const normalized = text.trim();
  const digitsOnly = normalized.replace(/[\s-]/g, "");
  if (!existing.phone) {
    if (/^\d{7,}$/.test(digitsOnly)) {
      updates.phone = normalized;
    }
    if (!updates.phone) {
      const phoneMatch = normalized.match(PHONE_REGEX);
      if (phoneMatch) {
        updates.phone = phoneMatch[1].trim();
      } else {
        const loose = normalized.match(LOOSE_PHONE_REGEX);
        if (loose) {
          updates.phone = loose[0].trim();
        }
      }
    }
  }

  if (!existing.name) {
    const nameMatch = normalized.match(NAME_REGEX) ?? normalized.match(NAME_COLON_REGEX);
    if (nameMatch) {
      updates.name = nameMatch[1].trim();
    }
  }

  if (!existing.address) {
    const addressMatch = normalized.match(ADDRESS_PREFIX_REGEX);
    if (addressMatch) {
      updates.address = addressMatch[2].trim();
    } else {
      const general = normalized.match(ADDRESS_REGEX);
      if (general) {
        updates.address = general[0].trim();
      }
    }
  }

  if (
    !existing.issue &&
    normalized.length > 10 &&
    !/^\d+$/.test(digitsOnly)
  ) {
    const issueMatch =
      normalized.match(/(?:issue|problem|need help with|it's|it is)\s+([^.!?]+)/i);
    updates.issue = issueMatch ? issueMatch[1].trim() : normalized.slice(0, 240);
  }

  if (existing.photos !== true) {
    if (/photo|picture|image/i.test(normalized)) {
      updates.photos = true;
    }
  }

  if (!existing.preferred_window) {
    const preferred = detectPreferredWindow(normalized);
    if (preferred) {
      updates.preferred_window = preferred;
    }
  }

  return updates;
}

export function detectFeeDisclosure(text: string): boolean {
  return /\$?99/.test(text) && /diagnostic|service fee/i.test(text);
}

export function detectUpsellOffer(text: string): boolean {
  return /maintenance plan|priority service|membership|service plan/i.test(text);
}
