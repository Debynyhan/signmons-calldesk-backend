export const ISSUE_SLOT_MAX_REPROMPTS = 1;

export const ISSUE_SLOT_BASE_PROMPT =
  "In a few words, what's the main issue, like no heat or leaking water?";

export const ISSUE_SLOT_SMS_DEFER_MESSAGE =
  "No problem. I'm texting you now to confirm your details and collect a brief description of the issue so we can move forward. Goodbye.";

export function buildIssueSlotPrompt(params?: {
  prefix?: string;
}): string {
  const prefix = params?.prefix?.trim();
  if (!prefix) {
    return ISSUE_SLOT_BASE_PROMPT;
  }
  return `${prefix} ${ISSUE_SLOT_BASE_PROMPT}`.trim();
}
