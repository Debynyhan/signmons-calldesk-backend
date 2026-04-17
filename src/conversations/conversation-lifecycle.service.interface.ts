import type { Conversation, ConversationJobRelation } from "@prisma/client";

export const CONVERSATION_LIFECYCLE_SERVICE = "CONVERSATION_LIFECYCLE_SERVICE";

export interface IConversationLifecycleService {
  ensureConversation(tenantId: string, sessionId: string): Promise<Conversation>;

  findVoiceConversationTenantByCallSid(params: {
    callSid: string;
  }): Promise<{ id: string; tenantId: string } | null>;

  ensureSmsConversation(params: {
    tenantId: string;
    fromNumber: string;
    smsSid?: string;
  }): Promise<{ conversation: Conversation; sessionId: string }>;

  ensureVoiceConsentConversation(params: {
    tenantId: string;
    callSid: string;
    requestId?: string;
    callerPhone?: string;
  }): Promise<Conversation>;

  completeVoiceConversationByCallSid(params: {
    tenantId: string;
    callSid: string;
    source: "stop" | "disconnect" | "forced_hangup" | "unknown";
    endedAt?: Date;
    hangupRequestedAt?: string | null;
    hangupToEndMs?: number | null;
  }): Promise<unknown>;

  linkJobToConversation(params: {
    tenantId: string;
    conversationId: string;
    jobId: string;
    relationType?: ConversationJobRelation;
  }): Promise<unknown>;
}
