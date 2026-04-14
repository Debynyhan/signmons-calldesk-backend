import type {
  VoiceFieldConfirmation,
  VoiceNameState,
} from "../conversations/voice-conversation-state.codec";

export const VOICE_NAME_SLOT_SERVICE = "VOICE_NAME_SLOT_SERVICE";

export interface IVoiceNameSlot {
  updateVoiceNameState(params: {
    tenantId: string;
    conversationId: string;
    nameState: VoiceNameState;
    confirmation?: VoiceFieldConfirmation;
  }): Promise<unknown>;

  promoteNameFromSms(params: {
    tenantId: string;
    conversationId: string;
    value: string;
    sourceEventId: string;
    confirmedAt?: string;
  }): Promise<unknown>;
}
