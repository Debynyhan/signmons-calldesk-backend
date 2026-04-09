export type VoiceNameSlotState = {
  candidate: {
    value: string | null;
    sourceEventId: string | null;
    createdAt: string | null;
  };
  confirmed: {
    value: string | null;
    sourceEventId: string | null;
    confirmedAt: string | null;
  };
  status: "MISSING" | "CANDIDATE" | "CONFIRMED";
  locked: boolean;
  attemptCount: number;
  corrections?: number;
  lastConfidence?: number | null;
  firstNameSpelled?: string | null;
  spellPromptedAt?: number | null;
  spellPromptedTurnIndex?: number | null;
  spellPromptCount?: number;
};

type ProvisionalNameOptions = {
  lastConfidence?: number | null;
  corrections?: number;
  firstNameSpelled?: string | null;
  spellPromptedAt?: number | null;
  spellPromptedTurnIndex?: number | null;
  spellPromptCount?: number;
};

export function lockNameForAddressProgression(params: {
  state: VoiceNameSlotState;
  sourceEventId: string | null;
  nowIso: string;
}): VoiceNameSlotState {
  if (params.state.locked) {
    return params.state;
  }
  return {
    ...params.state,
    status: params.state.candidate.value ? "CANDIDATE" : "MISSING",
    locked: true,
    attemptCount: Math.max(1, params.state.attemptCount),
    candidate: {
      value: params.state.candidate.value,
      sourceEventId:
        params.state.candidate.sourceEventId ?? params.sourceEventId,
      createdAt: params.state.candidate.createdAt ?? params.nowIso,
    },
  };
}

export function markNameAttemptIfNeeded(
  state: VoiceNameSlotState,
): VoiceNameSlotState {
  if (state.attemptCount > 0) {
    return state;
  }
  return {
    ...state,
    attemptCount: 1,
  };
}

export function markLowConfidenceNameReprompt(params: {
  state: VoiceNameSlotState;
  candidate: string | null;
  turnIndex: number;
  nowMs: number;
}): VoiceNameSlotState {
  return {
    ...params.state,
    status: params.candidate ? "CANDIDATE" : "MISSING",
    locked: false,
    spellPromptedAt: params.nowMs,
    spellPromptedTurnIndex: params.turnIndex,
    spellPromptCount: (params.state.spellPromptCount ?? 0) + 1,
  };
}

export function storeProvisionalNameCandidate(params: {
  state: VoiceNameSlotState;
  candidate: string;
  sourceEventId: string | null;
  createdAtIso: string;
  options?: ProvisionalNameOptions;
}): VoiceNameSlotState {
  const baseState = params.state;
  return {
    ...baseState,
    candidate: {
      value: params.candidate,
      sourceEventId: params.sourceEventId,
      createdAt: params.createdAtIso,
    },
    status: "CANDIDATE",
    attemptCount: Math.max(1, baseState.attemptCount),
    corrections:
      typeof params.options?.corrections === "number"
        ? params.options.corrections
        : (baseState.corrections ?? 0),
    lastConfidence:
      typeof params.options?.lastConfidence === "number"
        ? params.options.lastConfidence
        : (baseState.lastConfidence ?? null),
    firstNameSpelled:
      typeof params.options?.firstNameSpelled === "string"
        ? params.options.firstNameSpelled
        : (baseState.firstNameSpelled ?? null),
    spellPromptedAt:
      params.options && "spellPromptedAt" in params.options
        ? (params.options.spellPromptedAt ?? null)
        : (baseState.spellPromptedAt ?? null),
    spellPromptedTurnIndex:
      params.options && "spellPromptedTurnIndex" in params.options
        ? (params.options.spellPromptedTurnIndex ?? null)
        : (baseState.spellPromptedTurnIndex ?? null),
    spellPromptCount:
      typeof params.options?.spellPromptCount === "number"
        ? params.options.spellPromptCount
        : (baseState.spellPromptCount ?? 0),
  };
}

export function markNameSpellPrompted(params: {
  state: VoiceNameSlotState;
  turnIndex: number;
  nowMs: number;
}): VoiceNameSlotState {
  return {
    ...params.state,
    spellPromptedAt: params.nowMs,
    spellPromptedTurnIndex: params.turnIndex,
    spellPromptCount: (params.state.spellPromptCount ?? 0) + 1,
  };
}

export function clearNameSpellPrompt(
  state: VoiceNameSlotState,
): VoiceNameSlotState {
  return {
    ...state,
    spellPromptedAt: null,
    spellPromptedTurnIndex: null,
  };
}

export function buildNameFollowUpPrompt(issueSummary?: string | null): string {
  const trimmedIssue = issueSummary?.trim().replace(/[.?!]+$/, "") ?? "";
  const issueAck = trimmedIssue ? `I heard ${trimmedIssue}. ` : "";
  return `${issueAck}What's your full name?`.replace(/\s+/g, " ").trim();
}
