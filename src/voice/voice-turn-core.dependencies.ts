import { Injectable } from "@nestjs/common";
import { LoggingService } from "../logging/logging.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { VoiceAddressPromptService } from "./voice-address-prompt.service";
import { VoiceListeningWindowService } from "./voice-listening-window.service";
import { VoicePromptComposerService } from "./voice-prompt-composer.service";
import { VoiceResponseService } from "./voice-response.service";
import { VoiceTurnPolicyService } from "./voice-turn-policy.service";
import { VoiceUtteranceService } from "./voice-utterance.service";

@Injectable()
export class VoiceTurnCoreDependencies {
  constructor(
    public readonly loggingService: LoggingService,
    public readonly sanitizationService: SanitizationService,
    public readonly voicePromptComposer: VoicePromptComposerService,
    public readonly voiceTurnPolicyService: VoiceTurnPolicyService,
    public readonly voiceUtteranceService: VoiceUtteranceService,
    public readonly voiceAddressPromptService: VoiceAddressPromptService,
    public readonly voiceResponseService: VoiceResponseService,
    public readonly voiceListeningWindowService: VoiceListeningWindowService,
  ) {}
}
