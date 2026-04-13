import type { Prisma } from "@prisma/client";
import type {
  VoiceAddressState,
  VoiceComfortRisk,
  VoiceFieldConfirmation,
  VoiceListeningWindow,
  VoiceNameState,
  VoiceSmsHandoff,
  VoiceSmsPhoneState,
  VoiceUrgencyConfirmation,
} from "../conversations/voice-conversation-state.codec";

export const VOICE_CONVERSATION_STATE_SERVICE = "VOICE_CONVERSATION_STATE_SERVICE";

type VoiceTurnTimingInput = {
  recordedAt?: string;
  sttFinalMs: number | null;
  queueDelayMs: number | null;
  turnLogicMs: number;
  aiMs: number;
  aiCalls: number;
  ttsMs: number;
  twilioUpdateMs: number;
  transcriptChars: number;
  reason: string;
  twilioUpdated: boolean;
  usedGoogleTts: boolean;
  ttsCacheHit: boolean;
  ttsPolicy: "google_play" | "twilio_say";
  hangup: boolean;
  totalTurnMs?: number;
  latencyBreaches?: string[];
};

export interface IVoiceConversationStateService {
  updateVoiceTranscript(params: {
    tenantId: string;
    callSid: string;
    transcript: string;
    confidence?: number;
  }): Promise<unknown>;

  updateVoiceIssueCandidate(params: {
    tenantId: string;
    conversationId: string;
    issue: { value: string; sourceEventId: string; createdAt: string };
  }): Promise<{ id: string; collectedData: Prisma.JsonValue | null } | null>;

  incrementVoiceTurn(params: {
    tenantId: string;
    conversationId: string;
    now?: Date;
  }): Promise<{
    conversation: { id: string; collectedData: Prisma.JsonValue };
    voiceTurnCount: number;
    voiceStartedAt: string;
  } | null>;

  updateVoiceNameState(params: {
    tenantId: string;
    conversationId: string;
    nameState: VoiceNameState;
    confirmation?: VoiceFieldConfirmation;
  }): Promise<unknown>;

  updateVoiceSmsPhoneState(params: {
    tenantId: string;
    conversationId: string;
    phoneState: VoiceSmsPhoneState;
  }): Promise<{ id: string; collectedData: Prisma.JsonValue | null } | null>;

  updateVoiceSmsHandoff(params: {
    tenantId: string;
    conversationId: string;
    handoff: VoiceSmsHandoff;
  }): Promise<{ id: string; collectedData: Prisma.JsonValue | null } | null>;

  updateVoiceComfortRisk(params: {
    tenantId: string;
    conversationId: string;
    comfortRisk: Partial<VoiceComfortRisk>;
  }): Promise<unknown>;

  updateVoiceUrgencyConfirmation(params: {
    tenantId: string;
    conversationId: string;
    urgencyConfirmation: Partial<VoiceUrgencyConfirmation>;
  }): Promise<{ id: string; collectedData: Prisma.JsonValue | null } | null>;

  clearVoiceSmsHandoff(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<unknown>;

  updateVoiceAddressState(params: {
    tenantId: string;
    conversationId: string;
    addressState: VoiceAddressState;
    confirmation?: VoiceFieldConfirmation;
  }): Promise<unknown>;

  updateVoiceListeningWindow(params: {
    tenantId: string;
    conversationId: string;
    window: VoiceListeningWindow;
  }): Promise<unknown>;

  clearVoiceListeningWindow(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<unknown>;

  updateVoiceLastEventId(params: {
    tenantId: string;
    conversationId: string;
    eventId: string;
  }): Promise<unknown>;

  appendVoiceTurnTiming(params: {
    tenantId: string;
    callSid: string;
    timing: VoiceTurnTimingInput;
    maxHistory?: number;
  }): Promise<unknown>;

  promoteNameFromSms(params: {
    tenantId: string;
    conversationId: string;
    value: string;
    sourceEventId: string;
    confirmedAt?: string;
  }): Promise<unknown>;

  promoteAddressFromSms(params: {
    tenantId: string;
    conversationId: string;
    value: string;
    sourceEventId: string;
    confirmedAt?: string;
  }): Promise<unknown>;
}
