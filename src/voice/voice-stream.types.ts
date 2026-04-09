import type { TenantOrganization } from "@prisma/client";

export type VoicePendingTranscript = {
  transcript: string;
  confidence?: number;
  sttFinalMs?: number;
  queuedAtMs: number;
};

export type VoiceStreamSession = {
  callSid: string;
  streamSid: string;
  tenantId: string;
  tenant: TenantOrganization;
  leadId?: string;
  streamUrl: string;
  speechStream: NodeJS.ReadWriteStream;
  processing: boolean;
  startedAtMs: number;
  lastMediaAtMs?: number;
  pendingTranscript?: VoicePendingTranscript;
  lastTranscript?: string;
  lastTranscriptAt?: number;
  lastResponseText?: string;
  lastResponseAt?: number;
  speechRestartCount: number;
  lastSpeechRestartAtMs?: number;
  restartingSpeechStream?: boolean;
  hangupRequestedAtMs?: number;
  forceHangupScheduled?: boolean;
  forceHangupDelayMs?: number;
  closed: boolean;
};
