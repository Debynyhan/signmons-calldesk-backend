import { Inject, Injectable } from "@nestjs/common";
import { CONVERSATION_LIFECYCLE_SERVICE, type IConversationLifecycleService } from "../conversations/conversation-lifecycle.service.interface";
import { CONVERSATIONS_SERVICE, type IConversationsService } from "../conversations/conversations.service.interface";
import { VOICE_CONVERSATION_STATE_SERVICE, type IVoiceConversationStateService } from "./voice-conversation-state.service.interface";
import { GoogleSpeechService } from "../google/google-speech.service";
import { GoogleTtsService } from "../google/google-tts.service";
import { LoggingService } from "../logging/logging.service";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { VoiceCallService } from "./voice-call.service";
import { VoiceFillerAudioService } from "./voice-filler-audio.service";
import { VoiceTurnService } from "./voice-turn.service";

@Injectable()
export class VoiceStreamDependencies {
  constructor(
    @Inject(TENANTS_SERVICE)
    public readonly tenantsService: TenantsService,
    @Inject(CONVERSATIONS_SERVICE) public readonly conversationsService: IConversationsService,
    @Inject(CONVERSATION_LIFECYCLE_SERVICE)
    public readonly conversationLifecycleService: IConversationLifecycleService,
    @Inject(VOICE_CONVERSATION_STATE_SERVICE)
    public readonly voiceConversationStateService: IVoiceConversationStateService,
    public readonly googleSpeechService: GoogleSpeechService,
    public readonly googleTtsService: GoogleTtsService,
    public readonly voiceCallService: VoiceCallService,
    public readonly voiceTurnService: VoiceTurnService,
    public readonly voiceFillerAudioService: VoiceFillerAudioService,
    public readonly loggingService: LoggingService,
  ) {}
}
