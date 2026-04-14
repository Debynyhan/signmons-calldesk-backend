import type { Prisma } from "@prisma/client";
import type {
  VoiceComfortRisk,
  VoiceListeningWindow,
  VoiceUrgencyConfirmation,
} from "../conversations/voice-conversation-state.codec";

export const VOICE_TURN_ORCHESTRATION_SERVICE = "VOICE_TURN_ORCHESTRATION_SERVICE";

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

export interface IVoiceTurnOrchestration {
  incrementVoiceTurn(params: {
    tenantId: string;
    conversationId: string;
    now?: Date;
  }): Promise<{
    conversation: { id: string; collectedData: Prisma.JsonValue };
    voiceTurnCount: number;
    voiceStartedAt: string;
  } | null>;

  updateVoiceIssueCandidate(params: {
    tenantId: string;
    conversationId: string;
    issue: { value: string; sourceEventId: string; createdAt: string };
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
}
