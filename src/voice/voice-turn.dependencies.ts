import { Inject, Injectable } from "@nestjs/common";
import { AiService } from "../ai/ai.service";
import { LoggingService } from "../logging/logging.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import {
  VOICE_ADDRESS_SLOT_SERVICE,
  type IVoiceAddressSlot,
} from "./voice-address-slot.service.interface";
import { VoiceAddressPromptService } from "./voice-address-prompt.service";
import { VoiceHandoffPolicyService } from "./voice-handoff-policy.service";
import {
  VOICE_NAME_SLOT_SERVICE,
  type IVoiceNameSlot,
} from "./voice-name-slot.service.interface";
import { VoicePromptComposerService } from "./voice-prompt-composer.service";
import { VoiceSmsHandoffService } from "./voice-sms-handoff.service";
import {
  VOICE_SMS_SLOT_SERVICE,
  type IVoiceSmsSlot,
} from "./voice-sms-slot.service.interface";
import { VoiceTurnPolicyService } from "./voice-turn-policy.service";
import {
  VOICE_TRANSCRIPT_STATE_SERVICE,
  type IVoiceTranscriptState,
} from "./voice-transcript-state.service.interface";
import {
  VOICE_TURN_ORCHESTRATION_SERVICE,
  type IVoiceTurnOrchestration,
} from "./voice-turn-orchestration.service.interface";
import { VoiceUtteranceService } from "./voice-utterance.service";
import { VoiceResponseService } from "./voice-response.service";
import { VoiceListeningWindowService } from "./voice-listening-window.service";

@Injectable()
export class VoiceTurnDependencies {
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
    public readonly aiService: AiService,
    public readonly loggingService: LoggingService,
    public readonly sanitizationService: SanitizationService,
    public readonly voicePromptComposer: VoicePromptComposerService,
    public readonly voiceHandoffPolicy: VoiceHandoffPolicyService,
    public readonly voiceSmsHandoffService: VoiceSmsHandoffService,
    public readonly voiceTurnPolicyService: VoiceTurnPolicyService,
    public readonly voiceUtteranceService: VoiceUtteranceService,
    public readonly voiceAddressPromptService: VoiceAddressPromptService,
    public readonly voiceResponseService: VoiceResponseService,
    public readonly voiceListeningWindowService: VoiceListeningWindowService,
  ) {}
}
