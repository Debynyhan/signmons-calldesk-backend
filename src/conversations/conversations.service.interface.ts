import type { Conversation, Prisma } from "@prisma/client";
import type { AiRouteIntent } from "../ai/routing/ai-route-state";
import type {
  VoiceAddressState,
  VoiceComfortRisk,
  VoiceNameState,
  VoiceSmsHandoff,
  VoiceSmsPhoneState,
  VoiceUrgencyConfirmation,
} from "./voice-conversation-state.codec";

export const CONVERSATIONS_SERVICE = Symbol("CONVERSATIONS_SERVICE");

export interface IConversationsService {
  getVoiceConversationByCallSid(params: {
    tenantId: string;
    callSid: string;
  }): Promise<Conversation | null>;

  findConversationTenantBySmsSid(params: {
    smsSid: string;
  }): Promise<{ id: string; tenantId: string } | null>;

  getConversationBySmsSid(params: {
    tenantId: string;
    smsSid: string;
  }): Promise<Conversation | null>;

  getConversationById(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<Conversation | null>;

  getSmsConsentByPhone(params: {
    tenantId: string;
    phone: string;
  }): Promise<boolean | null>;

  setSmsConsentByPhone(params: {
    tenantId: string;
    phone: string;
    consent: boolean;
  }): Promise<void>;

  setAiRouteIntent(params: {
    tenantId: string;
    conversationId: string;
    intent: AiRouteIntent;
  }): Promise<{ id: string; collectedData: Prisma.JsonValue | null } | null>;

  getVoiceNameState(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceNameState;

  getVoiceSmsPhoneState(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceSmsPhoneState;

  getVoiceSmsHandoff(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceSmsHandoff | null;

  getVoiceAddressState(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceAddressState;

  getVoiceComfortRisk(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceComfortRisk;

  getVoiceUrgencyConfirmation(
    collectedData: Prisma.JsonValue | null | undefined,
  ): VoiceUrgencyConfirmation;
}
