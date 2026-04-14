import { Inject, Injectable } from "@nestjs/common";
import { CONVERSATION_LIFECYCLE_SERVICE, type IConversationLifecycleService } from "../conversations/conversation-lifecycle.service.interface";
import { GoogleSpeechService } from "../google/google-speech.service";
import { GoogleTtsService } from "../google/google-tts.service";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { VoiceCallService } from "./voice-call.service";
import { VoiceFillerAudioService } from "./voice-filler-audio.service";
import { VoiceTurnService } from "./voice-turn.service";
import {
  VOICE_TURN_ORCHESTRATION_SERVICE,
  type IVoiceTurnOrchestration,
} from "./voice-turn-orchestration.service.interface";

@Injectable()
export class VoiceStreamDependencies {
  constructor(
    @Inject(TENANTS_SERVICE)
    public readonly tenantsService: TenantsService,
    @Inject(CONVERSATION_LIFECYCLE_SERVICE)
    public readonly conversationLifecycleService: IConversationLifecycleService,
    @Inject(VOICE_TURN_ORCHESTRATION_SERVICE)
    public readonly voiceConversationStateService: IVoiceTurnOrchestration,
    public readonly googleSpeechService: GoogleSpeechService,
    public readonly googleTtsService: GoogleTtsService,
    public readonly voiceCallService: VoiceCallService,
    public readonly voiceTurnService: VoiceTurnService,
    public readonly voiceFillerAudioService: VoiceFillerAudioService,
  ) {}
}
