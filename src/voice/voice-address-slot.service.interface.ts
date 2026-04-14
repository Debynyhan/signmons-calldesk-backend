import type {
  VoiceAddressState,
  VoiceFieldConfirmation,
} from "../conversations/voice-conversation-state.codec";

export const VOICE_ADDRESS_SLOT_SERVICE = "VOICE_ADDRESS_SLOT_SERVICE";

export interface IVoiceAddressSlot {
  updateVoiceAddressState(params: {
    tenantId: string;
    conversationId: string;
    addressState: VoiceAddressState;
    confirmation?: VoiceFieldConfirmation;
  }): Promise<unknown>;

  promoteAddressFromSms(params: {
    tenantId: string;
    conversationId: string;
    value: string;
    sourceEventId: string;
    confirmedAt?: string;
  }): Promise<unknown>;
}
