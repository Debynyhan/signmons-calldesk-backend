import type { CommunicationChannel } from "@prisma/client";
import type { TriageOrchestratorResult } from "./triage-orchestrator.service";

export const AI_SERVICE = Symbol("AI_SERVICE");

export type AiAddressCandidate = {
  address: string | null;
  confidence?: number;
  houseNumber?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export interface IAiService {
  triage(
    tenantId: string,
    sessionId: string,
    userMessage: string,
    options?: { conversationId?: string; channel?: CommunicationChannel },
  ): Promise<TriageOrchestratorResult>;
  extractNameCandidate(tenantId: string, transcript: string): Promise<string | null>;
  extractAddressCandidate(
    tenantId: string,
    transcript: string,
  ): Promise<AiAddressCandidate | null>;
}
