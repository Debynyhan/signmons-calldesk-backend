import { Inject, Injectable } from "@nestjs/common";
import { ConversationLifecycleService } from "../conversations/conversation-lifecycle.service";
import { ConversationsService } from "../conversations/conversations.service";
import { VoiceConversationStateService } from "./voice-conversation-state.service";
import { GoogleSpeechService } from "../google/google-speech.service";
import { GoogleTtsService } from "../google/google-tts.service";
import { LoggingService } from "../logging/logging.service";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { VoiceCallService } from "./voice-call.service";
import { VoiceFillerAudioService } from "./voice-filler-audio.service";
import { VoiceTurnService } from "./voice-turn.service";

const hasLegacyVoiceTimingMethods = (
  value: unknown,
): value is VoiceConversationStateService =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { appendVoiceTurnTiming?: unknown })
        .appendVoiceTurnTiming === "function",
  );

const hasLegacyVoiceLifecycleMethods = (
  value: unknown,
): value is ConversationLifecycleService =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { ensureVoiceConsentConversation?: unknown })
        .ensureVoiceConsentConversation === "function" &&
      typeof (value as { completeVoiceConversationByCallSid?: unknown })
        .completeVoiceConversationByCallSid === "function",
  );

@Injectable()
export class VoiceStreamDependencies {
  public readonly voiceConversationStateService: VoiceConversationStateService;
  public readonly conversationLifecycleService: ConversationLifecycleService;

  constructor(
    @Inject(TENANTS_SERVICE)
    public readonly tenantsService: TenantsService,
    public readonly conversationsService: ConversationsService,
    injectedConversationLifecycleService: ConversationLifecycleService,
    injectedVoiceConversationStateService: VoiceConversationStateService,
    public readonly googleSpeechService: GoogleSpeechService,
    public readonly googleTtsService: GoogleTtsService,
    public readonly voiceCallService: VoiceCallService,
    public readonly voiceTurnService: VoiceTurnService,
    public readonly voiceFillerAudioService: VoiceFillerAudioService,
    public readonly loggingService: LoggingService,
  ) {
    this.conversationLifecycleService = hasLegacyVoiceLifecycleMethods(
      this.conversationsService,
    )
      ? this.conversationsService
      : injectedConversationLifecycleService;
    this.voiceConversationStateService = hasLegacyVoiceTimingMethods(
      this.conversationsService,
    )
      ? this.conversationsService
      : injectedVoiceConversationStateService;
  }
}
