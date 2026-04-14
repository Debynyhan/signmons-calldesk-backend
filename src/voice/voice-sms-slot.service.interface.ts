import type { Prisma } from "@prisma/client";
import type {
  VoiceSmsHandoff,
  VoiceSmsPhoneState,
} from "../conversations/voice-conversation-state.codec";

export const VOICE_SMS_SLOT_SERVICE = "VOICE_SMS_SLOT_SERVICE";

export interface IVoiceSmsSlot {
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

  clearVoiceSmsHandoff(params: {
    tenantId: string;
    conversationId: string;
  }): Promise<unknown>;
}
