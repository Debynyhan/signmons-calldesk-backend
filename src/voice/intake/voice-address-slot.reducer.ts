export type VoiceAddressSlotStatus =
  | "MISSING"
  | "CANDIDATE"
  | "CONFIRMED"
  | "FAILED";

export type VoiceAddressSlotState = {
  candidate: string | null;
  confirmed: string | null;
  houseNumber?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  status: VoiceAddressSlotStatus;
  locked: boolean;
  attemptCount: number;
  confidence?: number;
  sourceEventId?: string | null;
  needsLocality?: boolean;
  smsConfirmNeeded?: boolean;
};

type VoiceAddressParts = {
  houseNumber?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export function buildAddressStateFromLocalityMerge(params: {
  state: VoiceAddressSlotState;
  mergedParts: VoiceAddressParts;
  mergedCandidate: string | null;
  sourceEventId: string | null;
}): VoiceAddressSlotState {
  return {
    ...params.state,
    ...params.mergedParts,
    candidate: params.mergedCandidate ?? params.state.candidate,
    needsLocality: false,
    sourceEventId: params.sourceEventId,
  };
}

export function buildAddressCorrectionState(params: {
  state: VoiceAddressSlotState;
  mergedParts: VoiceAddressParts;
  mergedCandidate: string | null;
  sourceEventId: string | null;
}): VoiceAddressSlotState {
  return {
    ...params.state,
    ...params.mergedParts,
    candidate: params.mergedCandidate ?? params.state.candidate,
    status: "CANDIDATE",
    needsLocality: false,
    sourceEventId: params.sourceEventId,
  };
}

export function buildAddressLockedCandidateState(params: {
  state: VoiceAddressSlotState;
  sourceEventId: string | null;
}): VoiceAddressSlotState {
  return {
    ...params.state,
    status: "CANDIDATE",
    locked: true,
    sourceEventId: params.sourceEventId,
  };
}

export function buildAddressRejectedState(params: {
  state: VoiceAddressSlotState;
  sourceEventId: string | null;
}): { state: VoiceAddressSlotState; shouldFailClosed: boolean } {
  const nextAttempt = params.state.attemptCount + 1;
  const shouldFailClosed = nextAttempt >= 2;
  return {
    shouldFailClosed,
    state: {
      ...params.state,
      candidate: null,
      status: shouldFailClosed ? "FAILED" : "MISSING",
      attemptCount: nextAttempt,
      sourceEventId: params.sourceEventId,
    },
  };
}

export function buildAddressReplacementState(params: {
  state: VoiceAddressSlotState;
  replacementCandidate: string;
  sourceEventId: string | null;
}): { state: VoiceAddressSlotState; shouldFailClosed: boolean } {
  const nextAttempt = params.state.attemptCount + 1;
  const shouldFailClosed = nextAttempt >= 2;
  return {
    shouldFailClosed,
    state: {
      ...params.state,
      candidate: params.replacementCandidate,
      status: shouldFailClosed ? "FAILED" : "CANDIDATE",
      confidence: params.state.confidence,
      sourceEventId: params.sourceEventId,
      attemptCount: nextAttempt,
    },
  };
}

export function buildAddressExtractionBaseState(params: {
  state: VoiceAddressSlotState;
  mergedParts: VoiceAddressParts;
  candidate: string | null;
  confidence: number | undefined;
  sourceEventId: string | null;
}): VoiceAddressSlotState {
  return {
    ...params.state,
    ...params.mergedParts,
    candidate: params.candidate,
    confidence: params.confidence,
    sourceEventId: params.sourceEventId,
  };
}

export function buildAddressExtractionRetryState(params: {
  baseState: VoiceAddressSlotState;
  missingLocality: boolean;
}): { state: VoiceAddressSlotState; shouldFailClosed: boolean } {
  const nextAttempt = params.baseState.attemptCount + 1;
  const shouldFailClosed = nextAttempt >= 2;
  return {
    shouldFailClosed,
    state: {
      ...params.baseState,
      status: shouldFailClosed ? "FAILED" : "CANDIDATE",
      attemptCount: nextAttempt,
      needsLocality: params.missingLocality && !shouldFailClosed,
    },
  };
}

export function buildAddressExtractionCandidateState(params: {
  baseState: VoiceAddressSlotState;
  missingLocality: boolean;
}): VoiceAddressSlotState {
  return {
    ...params.baseState,
    status: "CANDIDATE",
    needsLocality: params.missingLocality,
  };
}
