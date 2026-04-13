import type { CommunicationChannel } from "@prisma/client";

export const CALL_LOG_SERVICE = "CALL_LOG_SERVICE";

export interface CreateCallLogInput {
  tenantId: string;
  sessionId: string;
  jobId?: string;
  conversationId?: string;
  transcript: string;
  aiResponse?: string;
  direction?: "INBOUND" | "OUTBOUND";
  metadata?: Record<string, unknown>;
  channel?: CommunicationChannel;
}

export interface ICallLogService {
  createLog(input: CreateCallLogInput): Promise<void>;

  getRecentMessages(
    tenantId: string,
    sessionId: string,
    limit?: number,
  ): Promise<Array<{ role: "user" | "assistant"; content: string; createdAt: Date }>>;

  clearSession(
    tenantId: string,
    sessionId: string,
    conversationId?: string,
  ): Promise<void>;

  createVoiceTranscriptLog(input: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    transcript: string;
    confidence?: number;
    occurredAt?: Date;
  }): Promise<string | null>;

  createVoiceAssistantLog(input: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    message: string;
    occurredAt?: Date;
    sourceEventId?: string;
  }): Promise<string | null>;
}
