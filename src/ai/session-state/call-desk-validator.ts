import type { CallDeskSessionState, BookingFields } from "./call-desk-state";
import {
  canTransition,
  missingFields,
  missingInfoFields,
} from "./call-desk-state";

export interface ToolCallPayload {
  name: string;
  arguments?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  correctiveSystemMessage?: string;
  suggestedStep?: CallDeskSessionState["step"];
  missingField?: keyof BookingFields | "fee_disclosure" | "fee_confirmation";
}

const FORBIDDEN_LEAK_PATTERNS = [
  /\btool\b/i,
  /\bjson\b/i,
  /\binternal\b/i,
  /\bstate\b/i,
  /\bopenai\b/i,
  /\bmodel\b/i,
];

const FORBIDDEN_DIY_PATTERNS = [
  /\bbreaker\b/i,
  /\bpanel\b/i,
  /\bgas valve\b/i,
  /\bopen (the )?(furnace|air handler|unit)\b/i,
  /\bremove (the )?(cover|panel)\b/i,
  /\btouch (the )?(wiring|wires)\b/i,
];

const BOOKING_LANGUAGE_PATTERNS = [
  /\bbooked\b/i,
  /\bscheduled\b/i,
  /\bconfirmed\b/i,
  /\bappointment is set\b/i,
  /\bwe'?ll see you\b/i,
  /\bsee you on\b/i,
];

function countSentences(text: string): number {
  const matches = text.trim().match(/[.!?]+/g);
  if (!matches || matches.length === 0) {
    return text.trim().length ? 1 : 0;
  }
  return matches.length;
}

function countQuestions(text: string): number {
  const matches = text.match(/\?/g);
  return matches ? matches.length : 0;
}

function containsAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasToolCall(
  toolCalls: ToolCallPayload[] | undefined,
  name: string,
): boolean {
  return (toolCalls ?? []).some((call) => call.name === name);
}

function mentionsField(
  field: keyof BookingFields,
  text: string,
): boolean {
  switch (field) {
    case "name":
      return /\b(name|full name)\b/i.test(text);
    case "phone":
      return /\b(phone|number|reach|call)\b/i.test(text);
    case "address":
      return /\b(address|street|city|zip|zip code)\b/i.test(text);
    case "issue":
      return /\b(issue|problem|happening|going on|describe)\b/i.test(text);
    case "photos":
      return /\b(photo|picture|image)\b/i.test(text);
    case "preferred_window":
      return /\b(time|date|window|availability|schedule|when|soon)\b/i.test(text);
    default:
      return false;
  }
}

export function validateAssistantTurn(params: {
  prevState: CallDeskSessionState;
  nextState: CallDeskSessionState;
  assistantText: string;
  toolCalls?: ToolCallPayload[];
}): ValidationResult {
  const { prevState, nextState, assistantText, toolCalls } = params;
  const text = assistantText.trim();

  if (countSentences(text) > 2) {
    return {
      ok: false,
      reason: "Too many sentences",
      correctiveSystemMessage:
        "Rewrite your last message to be 1–2 sentences max and ask exactly one question. Do not add extra information.",
      suggestedStep: prevState.step,
    };
  }

  const questionCount = countQuestions(text);
  if (questionCount > 1) {
    return {
      ok: false,
      reason: "Too many questions",
      correctiveSystemMessage:
        "Rewrite your last message to include exactly ONE question. Keep it concise.",
      suggestedStep: prevState.step,
    };
  }

  if (containsAny(FORBIDDEN_LEAK_PATTERNS, text)) {
    return {
      ok: false,
      reason: "Internal leakage detected",
      correctiveSystemMessage:
        "Rewrite your last message without mentioning tools, JSON, internal state, models, or system rules. Stay in dispatcher role.",
      suggestedStep: prevState.step,
    };
  }

  if (containsAny(FORBIDDEN_DIY_PATTERNS, text)) {
    return {
      ok: false,
      reason: "DIY guidance detected",
      correctiveSystemMessage:
        "Rewrite your last message. Do not provide troubleshooting or repair steps. Focus on scheduling and information gathering.",
      suggestedStep: prevState.step,
    };
  }

  if (
    nextState.step !== prevState.step &&
    !canTransition(prevState.step, nextState.step)
  ) {
    return {
      ok: false,
      reason: `Illegal transition ${prevState.step} -> ${nextState.step}`,
      correctiveSystemMessage: `You must follow the dispatcher FSM. Stay in ${prevState.step} unless the server advances you.`,
      suggestedStep: prevState.step,
    };
  }

  const missing = missingFields(nextState);
  const missingInfo = missingInfoFields(nextState);
  const hasCreateJob = hasToolCall(toolCalls, "create_job");

  if (nextState.step === "INFO_COLLECTION" && missingInfo.length > 0) {
    const nextField = missingInfo[0];
    if (!mentionsField(nextField, text)) {
      return {
        ok: false,
        reason: "Missing field not requested",
        correctiveSystemMessage: `Ask for the next missing field only: ${nextField}. Keep it to one question.`,
        suggestedStep: "INFO_COLLECTION",
        missingField: nextField,
      };
    }
  }

  if (
    questionCount === 0 &&
    nextState.step !== "CLOSEOUT" &&
    nextState.step !== "BOOKING"
  ) {
    if (missingInfo.length > 0) {
      return {
        ok: false,
        reason: "No question asked for missing field",
        correctiveSystemMessage: `Ask for the next missing field only: ${missingInfo[0]}.`,
        suggestedStep: "INFO_COLLECTION",
        missingField: missingInfo[0],
      };
    }

    if (!nextState.fee_disclosed) {
      return {
        ok: false,
        reason: "No question asked to confirm fee",
        correctiveSystemMessage:
          "Confirm the $99 diagnostic/service fee and ask if the caller agrees so you can proceed.",
        suggestedStep: "PRICING",
        missingField: "fee_disclosure",
      };
    }

    if (!nextState.fee_confirmed) {
      return {
        ok: false,
        reason: "No question asked to confirm fee",
        correctiveSystemMessage:
          "Ask the caller to confirm they agree to the $99 diagnostic/service fee so you can proceed.",
        suggestedStep: "PRICING",
        missingField: "fee_confirmation",
      };
    }

    return {
      ok: false,
      reason: "No question asked to move forward",
      correctiveSystemMessage:
        "Ask a single clear question to move to the next step. Do not add extra information.",
      suggestedStep: prevState.step,
    };
  }

  if (nextState.step === "BOOKING") {
    if (missing.length > 0) {
      return {
        ok: false,
        reason: "Missing required booking fields",
        correctiveSystemMessage: `Do not book yet. Ask for the next missing field only: ${missing[0]}.`,
        suggestedStep: "INFO_COLLECTION",
        missingField: missing[0],
      };
    }

    if (!nextState.fee_confirmed) {
      return {
        ok: false,
        reason: "Fee not confirmed before booking",
        correctiveSystemMessage:
          "Before booking, confirm the caller agrees to the $99 diagnostic/service fee (credited toward repairs if approved within 24 hours).",
        suggestedStep: "PRICING",
        missingField: "fee_confirmation",
      };
    }

    if (!hasCreateJob) {
      return {
        ok: false,
        reason: "Booking step without create_job tool call",
        correctiveSystemMessage:
          "You must call the create_job tool to finalize booking. Do not claim booking without it.",
        suggestedStep: "BOOKING",
      };
    }
  }

  if (containsAny(BOOKING_LANGUAGE_PATTERNS, text) && !hasCreateJob) {
    return {
      ok: false,
      reason: "Booking language without tool call",
      correctiveSystemMessage:
        "Do not claim scheduling or confirmation unless create_job is called successfully. Rewrite the response without booking claims.",
      suggestedStep: prevState.step,
    };
  }

  return { ok: true };
}
