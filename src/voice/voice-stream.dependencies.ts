import { Inject, Injectable } from "@nestjs/common";
import { ConversationsService } from "../conversations/conversations.service";
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
    public readonly conversationsService: ConversationsService,
    public readonly googleSpeechService: GoogleSpeechService,
    public readonly googleTtsService: GoogleTtsService,
    public readonly voiceCallService: VoiceCallService,
    public readonly voiceTurnService: VoiceTurnService,
    public readonly voiceFillerAudioService: VoiceFillerAudioService,
    public readonly loggingService: LoggingService,
  ) {}
}
