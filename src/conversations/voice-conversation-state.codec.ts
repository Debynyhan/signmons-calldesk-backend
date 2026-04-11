import type { Prisma } from "@prisma/client";

export type VoiceNameStatus = "MISSING" | "CANDIDATE" | "CONFIRMED";
export type VoiceNameCandidate = {
  value: string | null;
  sourceEventId: string | null;
  createdAt: string | null;
};
export type VoiceNameConfirmed = {
  value: string | null;
  sourceEventId: string | null;
  confirmedAt: string | null;
};
export type VoiceNameState = {
  candidate: VoiceNameCandidate;
  confirmed: VoiceNameConfirmed;
  status: VoiceNameStatus;
  locked: boolean;
  attemptCount: number;
  corrections?: number;
  lastConfidence?: number | null;
  spellPromptedAt?: number | null;
  spellPromptedTurnIndex?: number | null;
  spellPromptCount?: number;
  firstNameSpelled?: string | null;
};

export type VoiceAddressStatus =
  | "MISSING"
  | "CANDIDATE"
  | "CONFIRMED"
  | "FAILED";
export type VoiceAddressState = {
  candidate: string | null;
  confirmed: string | null;
  houseNumber?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  status: VoiceAddressStatus;
  locked: boolean;
  attemptCount: number;
  confidence?: number;
  sourceEventId?: string | null;
  needsLocality?: boolean;
  smsConfirmNeeded?: boolean;
};

export type VoiceSmsPhoneSource = "twilio_ani" | "user_spoken";
export type VoiceSmsPhoneState = {
  value: string | null;
  source: VoiceSmsPhoneSource | null;
  confirmed: boolean;
  confirmedAt: string | null;
  attemptCount: number;
  lastPromptedAt?: string | null;
};

export type VoiceSmsHandoff = {
  reason: string;
  messageOverride?: string | null;
  createdAt: string;
};

export type VoiceComfortRiskResponse = "YES" | "NO";
export type VoiceComfortRisk = {
  askedAt: string | null;
  response: VoiceComfortRiskResponse | null;
  sourceEventId: string | null;
};

export type VoiceUrgencyConfirmationResponse = "YES" | "NO";
export type VoiceUrgencyConfirmation = {
  askedAt: string | null;
  response: VoiceUrgencyConfirmationResponse | null;
  sourceEventId: string | null;
};

export type VoiceFieldConfirmation = {
  field: "name" | "address";
  value: string;
  confirmedAt: string;
  sourceEventId: string;
  channel: "VOICE" | "SMS";
};

export type VoiceListeningField =
  | "name"
  | "address"
  | "confirmation"
  | "sms_phone"
  | "booking"
  | "callback"
  | "comfort_risk"
  | "urgency_confirm";

export type VoiceListeningWindow = {
  field: VoiceListeningField;
  sourceEventId: string | null;
  expiresAt: string;
  targetField?:
    | "name"
    | "address"
    | "booking"
    | "callback"
    | "comfort_risk"
    | "urgency_confirm";
};

export function getDefaultVoiceNameState(): VoiceNameState {
  return {
    candidate: { value: null, sourceEventId: null, createdAt: null },
    confirmed: { value: null, sourceEventId: null, confirmedAt: null },
    status: "MISSING",
    locked: false,
    attemptCount: 0,
    corrections: 0,
    lastConfidence: null,
    spellPromptedAt: null,
    spellPromptedTurnIndex: null,
    spellPromptCount: 0,
    firstNameSpelled: null,
  };
}

export function getDefaultVoiceAddressState(): VoiceAddressState {
  return {
    candidate: null,
    confirmed: null,
    houseNumber: null,
    street: null,
    city: null,
    state: null,
    zip: null,
    status: "MISSING",
    locked: false,
    attemptCount: 0,
    confidence: undefined,
    sourceEventId: null,
    needsLocality: false,
    smsConfirmNeeded: false,
  };
}

export function getDefaultVoiceSmsPhoneState(
  value: string | null,
): VoiceSmsPhoneState {
  return {
    value,
    source: value ? "twilio_ani" : null,
    confirmed: false,
    confirmedAt: null,
    attemptCount: 0,
    lastPromptedAt: null,
  };
}

export function parseVoiceNameState(value: unknown): VoiceNameState {
  const defaults = getDefaultVoiceNameState();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const data = value as Partial<VoiceNameState>;
  const candidate = data.candidate ?? defaults.candidate;
  const confirmed = data.confirmed ?? defaults.confirmed;
  const status =
    data.status === "CANDIDATE" || data.status === "CONFIRMED"
      ? data.status
      : "MISSING";
  const corrections =
    typeof data.corrections === "number" && data.corrections >= 0
      ? data.corrections
      : 0;
  const lastConfidence =
    typeof data.lastConfidence === "number" ? data.lastConfidence : null;
  const spellPromptedAt =
    typeof data.spellPromptedAt === "number" ? data.spellPromptedAt : null;
  const spellPromptedTurnIndex =
    typeof data.spellPromptedTurnIndex === "number"
      ? data.spellPromptedTurnIndex
      : null;
  const spellPromptCount =
    typeof data.spellPromptCount === "number" && data.spellPromptCount >= 0
      ? data.spellPromptCount
      : 0;
  const firstNameSpelled =
    typeof data.firstNameSpelled === "string" ? data.firstNameSpelled : null;

  return {
    candidate: {
      value: typeof candidate.value === "string" ? candidate.value : null,
      sourceEventId:
        typeof candidate.sourceEventId === "string"
          ? candidate.sourceEventId
          : null,
      createdAt:
        typeof candidate.createdAt === "string" ? candidate.createdAt : null,
    },
    confirmed: {
      value: typeof confirmed.value === "string" ? confirmed.value : null,
      sourceEventId:
        typeof confirmed.sourceEventId === "string"
          ? confirmed.sourceEventId
          : null,
      confirmedAt:
        typeof confirmed.confirmedAt === "string"
          ? confirmed.confirmedAt
          : null,
    },
    status,
    locked: Boolean(data.locked),
    attemptCount:
      typeof data.attemptCount === "number" && data.attemptCount >= 0
        ? data.attemptCount
        : 0,
    corrections,
    lastConfidence,
    spellPromptedAt,
    spellPromptedTurnIndex,
    spellPromptCount,
    firstNameSpelled,
  };
}

export function parseVoiceAddressState(value: unknown): VoiceAddressState {
  const defaults = getDefaultVoiceAddressState();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const data = value as Record<string, unknown>;
  const candidateRaw = data.candidate;
  const confirmedRaw = data.confirmed;
  let candidate =
    typeof candidateRaw === "string" ? candidateRaw : defaults.candidate;
  let confirmed =
    typeof confirmedRaw === "string" ? confirmedRaw : defaults.confirmed;
  let sourceEventId =
    typeof data.sourceEventId === "string" ? data.sourceEventId : null;
  const confidence =
    typeof data.confidence === "number" ? data.confidence : undefined;
  const needsLocality =
    typeof data.needsLocality === "boolean" ? data.needsLocality : false;
  const smsConfirmNeeded =
    typeof data.smsConfirmNeeded === "boolean" ? data.smsConfirmNeeded : false;
  const houseNumber =
    typeof data.houseNumber === "string" ? data.houseNumber : null;
  const street = typeof data.street === "string" ? data.street : null;
  const city = typeof data.city === "string" ? data.city : null;
  const state = typeof data.state === "string" ? data.state : null;
  const zip = typeof data.zip === "string" ? data.zip : null;

  if (candidateRaw && typeof candidateRaw === "object") {
    const legacyCandidate = candidateRaw as {
      value?: unknown;
      sourceEventId?: unknown;
    };
    if (typeof legacyCandidate.value === "string") {
      candidate = legacyCandidate.value;
    }
    if (typeof legacyCandidate.sourceEventId === "string" && !sourceEventId) {
      sourceEventId = legacyCandidate.sourceEventId;
    }
  }

  if (confirmedRaw && typeof confirmedRaw === "object") {
    const legacyConfirmed = confirmedRaw as {
      value?: unknown;
      sourceEventId?: unknown;
    };
    if (typeof legacyConfirmed.value === "string") {
      confirmed = legacyConfirmed.value;
    }
    if (typeof legacyConfirmed.sourceEventId === "string" && !sourceEventId) {
      sourceEventId = legacyConfirmed.sourceEventId;
    }
  }

  const status =
    data.status === "CANDIDATE" ||
    data.status === "CONFIRMED" ||
    data.status === "FAILED"
      ? data.status
      : "MISSING";

  return {
    candidate: candidate ?? null,
    confirmed: confirmed ?? null,
    houseNumber,
    street,
    city,
    state,
    zip,
    status,
    locked: Boolean(data.locked),
    attemptCount:
      typeof data.attemptCount === "number" && data.attemptCount >= 0
        ? data.attemptCount
        : 0,
    confidence,
    sourceEventId,
    needsLocality,
    smsConfirmNeeded,
  };
}

export function parseVoiceSmsPhoneState(value: unknown): VoiceSmsPhoneState {
  if (!value || typeof value !== "object") {
    return getDefaultVoiceSmsPhoneState(null);
  }
  const data = value as Partial<VoiceSmsPhoneState>;
  const rawValue = typeof data.value === "string" ? data.value : null;
  const source =
    data.source === "twilio_ani" || data.source === "user_spoken"
      ? data.source
      : rawValue
        ? "twilio_ani"
        : null;

  return {
    value: rawValue,
    source,
    confirmed: Boolean(data.confirmed),
    confirmedAt: typeof data.confirmedAt === "string" ? data.confirmedAt : null,
    attemptCount:
      typeof data.attemptCount === "number" && data.attemptCount >= 0
        ? data.attemptCount
        : 0,
    lastPromptedAt:
      typeof data.lastPromptedAt === "string" ? data.lastPromptedAt : null,
  };
}

export function getVoiceNameStateFromCollectedData(
  collectedData: Prisma.JsonValue | null | undefined,
): VoiceNameState {
  if (!collectedData || typeof collectedData !== "object") {
    return getDefaultVoiceNameState();
  }
  const data = collectedData as Record<string, unknown>;
  return parseVoiceNameState(data.name);
}

export function getVoiceSmsPhoneStateFromCollectedData(
  collectedData: Prisma.JsonValue | null | undefined,
): VoiceSmsPhoneState {
  if (!collectedData || typeof collectedData !== "object") {
    return getDefaultVoiceSmsPhoneState(null);
  }
  const data = collectedData as Record<string, unknown>;
  if (data.smsPhone) {
    return parseVoiceSmsPhoneState(data.smsPhone);
  }
  const fallback =
    typeof data.callerPhone === "string" ? data.callerPhone : null;
  return getDefaultVoiceSmsPhoneState(fallback);
}

export function getVoiceSmsHandoffFromCollectedData(
  collectedData: Prisma.JsonValue | null | undefined,
): VoiceSmsHandoff | null {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  const data = collectedData as Record<string, unknown>;
  const raw = data.voiceSmsHandoff;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.reason !== "string") {
    return null;
  }

  return {
    reason: record.reason,
    messageOverride:
      typeof record.messageOverride === "string"
        ? record.messageOverride
        : null,
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date().toISOString(),
  };
}

export function getVoiceAddressStateFromCollectedData(
  collectedData: Prisma.JsonValue | null | undefined,
): VoiceAddressState {
  if (!collectedData || typeof collectedData !== "object") {
    return getDefaultVoiceAddressState();
  }
  const data = collectedData as Record<string, unknown>;
  return parseVoiceAddressState(data.address);
}

export function getVoiceComfortRiskFromCollectedData(
  collectedData: Prisma.JsonValue | null | undefined,
): VoiceComfortRisk {
  if (!collectedData || typeof collectedData !== "object") {
    return { askedAt: null, response: null, sourceEventId: null };
  }
  const data = collectedData as Record<string, unknown>;
  const raw = data.voiceComfortRisk;
  if (!raw || typeof raw !== "object") {
    return { askedAt: null, response: null, sourceEventId: null };
  }
  const record = raw as Partial<VoiceComfortRisk>;
  const response =
    record.response === "YES" || record.response === "NO"
      ? record.response
      : null;

  return {
    askedAt: typeof record.askedAt === "string" ? record.askedAt : null,
    response,
    sourceEventId:
      typeof record.sourceEventId === "string" ? record.sourceEventId : null,
  };
}

export function getVoiceUrgencyConfirmationFromCollectedData(
  collectedData: Prisma.JsonValue | null | undefined,
): VoiceUrgencyConfirmation {
  if (!collectedData || typeof collectedData !== "object") {
    return { askedAt: null, response: null, sourceEventId: null };
  }
  const data = collectedData as Record<string, unknown>;
  const raw = data.voiceUrgencyConfirmation;
  if (!raw || typeof raw !== "object") {
    return { askedAt: null, response: null, sourceEventId: null };
  }
  const record = raw as Partial<VoiceUrgencyConfirmation>;
  const response =
    record.response === "YES" || record.response === "NO"
      ? record.response
      : null;

  return {
    askedAt: typeof record.askedAt === "string" ? record.askedAt : null,
    response,
    sourceEventId:
      typeof record.sourceEventId === "string" ? record.sourceEventId : null,
  };
}

export function mergeLockedVoiceNameState(
  current: VoiceNameState,
  next: VoiceNameState,
): VoiceNameState {
  if (current.locked && current.confirmed.value) {
    return {
      ...current,
      status: "CONFIRMED",
      locked: true,
    };
  }
  return next;
}

export function mergeLockedVoiceAddressState(
  current: VoiceAddressState,
  next: VoiceAddressState,
): VoiceAddressState {
  if (current.locked && current.confirmed) {
    return {
      ...current,
      status: "CONFIRMED",
      locked: true,
    };
  }
  return next;
}
