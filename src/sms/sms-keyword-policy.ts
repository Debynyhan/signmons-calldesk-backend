export type SmsKeywordIntent = "opt_in" | "opt_out" | "help" | "none";
type SmsKeywordPayload = {
  Body?: string;
  OptOutType?: string;
};

const OPT_IN_KEYWORDS = new Set(["START", "YES", "SUBSCRIBE", "UNSTOP"]);
const OPT_OUT_KEYWORDS = new Set([
  "STOP",
  "END",
  "UNSUBSCRIBE",
  "CANCEL",
  "QUIT",
  "STOPALL",
]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

function normalizeKeywordToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function intentFromOptOutType(value: string): SmsKeywordIntent {
  const normalized = normalizeKeywordToken(value);
  if (normalized === "STOP") {
    return "opt_out";
  }
  if (normalized === "START") {
    return "opt_in";
  }
  if (normalized === "HELP") {
    return "help";
  }
  return "none";
}

export function resolveSmsKeywordIntent(body: SmsKeywordPayload): SmsKeywordIntent {
  if (typeof body.OptOutType === "string" && body.OptOutType.trim()) {
    return intentFromOptOutType(body.OptOutType);
  }

  const message = typeof body.Body === "string" ? body.Body : "";
  const normalized = normalizeKeywordToken(message);
  if (!normalized) {
    return "none";
  }

  if (
    OPT_OUT_KEYWORDS.has(normalized) ||
    normalized.startsWith("STOP ")
  ) {
    return "opt_out";
  }
  if (OPT_IN_KEYWORDS.has(normalized)) {
    return "opt_in";
  }
  if (HELP_KEYWORDS.has(normalized)) {
    return "help";
  }
  return "none";
}

export function isTwilioManagedKeyword(body: SmsKeywordPayload): boolean {
  return typeof body.OptOutType === "string" && body.OptOutType.trim().length > 0;
}

export function buildSmsKeywordReply(
  intent: SmsKeywordIntent,
  brandName = "Signmons",
): string | null {
  if (intent === "opt_out") {
    return `${brandName}: You have been unsubscribed and will no longer receive text messages. Reply START to opt in again.`;
  }
  if (intent === "opt_in") {
    return `${brandName}: You are now opted in for service-related SMS updates. Msg frequency varies. Msg&data rates may apply. Reply HELP for help, STOP to opt out.`;
  }
  if (intent === "help") {
    return `${brandName}: For support, reply with your question or call our office. Reply STOP to opt out or START to opt back in.`;
  }
  return null;
}
