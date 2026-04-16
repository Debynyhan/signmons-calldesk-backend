import { Inject, Injectable } from "@nestjs/common";
import {
  VOICE_ADDRESS_SLOT_SERVICE,
  type IVoiceAddressSlot,
} from "./voice-address-slot.service.interface";
import {
  VOICE_NAME_SLOT_SERVICE,
  type IVoiceNameSlot,
} from "./voice-name-slot.service.interface";
import {
  VOICE_SMS_SLOT_SERVICE,
  type IVoiceSmsSlot,
} from "./voice-sms-slot.service.interface";
import {
  VOICE_TRANSCRIPT_STATE_SERVICE,
  type IVoiceTranscriptState,
} from "./voice-transcript-state.service.interface";
import {
  VOICE_TURN_ORCHESTRATION_SERVICE,
  type IVoiceTurnOrchestration,
} from "./voice-turn-orchestration.service.interface";

@Injectable()
export class VoiceTurnStateDependencies {
  constructor(
    @Inject(VOICE_TRANSCRIPT_STATE_SERVICE)
    public readonly voiceTranscriptState: IVoiceTranscriptState,
    @Inject(VOICE_NAME_SLOT_SERVICE)
    public readonly voiceNameSlot: IVoiceNameSlot,
    @Inject(VOICE_ADDRESS_SLOT_SERVICE)
    public readonly voiceAddressSlot: IVoiceAddressSlot,
    @Inject(VOICE_SMS_SLOT_SERVICE)
    public readonly voiceSmsSlot: IVoiceSmsSlot,
    @Inject(VOICE_TURN_ORCHESTRATION_SERVICE)
    public readonly voiceTurnOrchestration: IVoiceTurnOrchestration,
  ) {}
}
