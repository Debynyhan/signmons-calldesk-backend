import { Injectable } from "@nestjs/common";
import type { IVoiceAddressSlot } from "./voice-address-slot.service.interface";
import type { IVoiceNameSlot } from "./voice-name-slot.service.interface";
import type { IVoiceSmsSlot } from "./voice-sms-slot.service.interface";
import type { IVoiceTranscriptState } from "./voice-transcript-state.service.interface";
import type { IVoiceTurnOrchestration } from "./voice-turn-orchestration.service.interface";
import { VoiceTurnAiDependencies } from "./voice-turn-ai.dependencies";
import { VoiceTurnCoreDependencies } from "./voice-turn-core.dependencies";
import { VoiceTurnHandoffDependencies } from "./voice-turn-handoff.dependencies";
import { VoiceTurnStateDependencies } from "./voice-turn-state.dependencies";
import type { IAiService } from "../ai/ai.service.interface";
import type { LoggingService } from "../logging/logging.service";
import type { SanitizationService } from "../sanitization/sanitization.service";
import type { VoiceAddressPromptService } from "./voice-address-prompt.service";
import type { VoiceHandoffPolicyService } from "./voice-handoff-policy.service";
import type { VoicePromptComposerService } from "./voice-prompt-composer.service";
import type { VoiceSmsHandoffService } from "./voice-sms-handoff.service";
import type { VoiceTurnPolicyService } from "./voice-turn-policy.service";
import type { VoiceUtteranceService } from "./voice-utterance.service";
import type { VoiceResponseService } from "./voice-response.service";
import type { VoiceListeningWindowService } from "./voice-listening-window.service";

@Injectable()
export class VoiceTurnDependencies {
  constructor(
    private readonly stateDeps: VoiceTurnStateDependencies,
    private readonly coreDeps: VoiceTurnCoreDependencies,
    private readonly aiDeps: VoiceTurnAiDependencies,
    private readonly handoffDeps: VoiceTurnHandoffDependencies,
  ) {}

  get voiceTranscriptState(): IVoiceTranscriptState {
    return this.stateDeps.voiceTranscriptState;
  }

  get voiceNameSlot(): IVoiceNameSlot {
    return this.stateDeps.voiceNameSlot;
  }

  get voiceAddressSlot(): IVoiceAddressSlot {
    return this.stateDeps.voiceAddressSlot;
  }

  get voiceSmsSlot(): IVoiceSmsSlot {
    return this.stateDeps.voiceSmsSlot;
  }

  get voiceTurnOrchestration(): IVoiceTurnOrchestration {
    return this.stateDeps.voiceTurnOrchestration;
  }

  get aiService(): IAiService {
    return this.aiDeps.aiService;
  }

  get loggingService(): LoggingService {
    return this.coreDeps.loggingService;
  }

  get sanitizationService(): SanitizationService {
    return this.coreDeps.sanitizationService;
  }

  get voicePromptComposer(): VoicePromptComposerService {
    return this.coreDeps.voicePromptComposer;
  }

  get voiceHandoffPolicy(): VoiceHandoffPolicyService {
    return this.handoffDeps.voiceHandoffPolicy;
  }

  get voiceSmsHandoffService(): VoiceSmsHandoffService {
    return this.handoffDeps.voiceSmsHandoffService;
  }

  get voiceTurnPolicyService(): VoiceTurnPolicyService {
    return this.coreDeps.voiceTurnPolicyService;
  }

  get voiceUtteranceService(): VoiceUtteranceService {
    return this.coreDeps.voiceUtteranceService;
  }

  get voiceAddressPromptService(): VoiceAddressPromptService {
    return this.coreDeps.voiceAddressPromptService;
  }

  get voiceResponseService(): VoiceResponseService {
    return this.coreDeps.voiceResponseService;
  }

  get voiceListeningWindowService(): VoiceListeningWindowService {
    return this.coreDeps.voiceListeningWindowService;
  }
}
