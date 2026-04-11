import { Inject, Injectable } from "@nestjs/common";
import { AiService } from "../ai/ai.service";
import { ConversationsService } from "../conversations/conversations.service";
import { VoiceConversationStateService } from "./voice-conversation-state.service";
import { CallLogService } from "../logging/call-log.service";
import { LoggingService } from "../logging/logging.service";
import { PaymentsService } from "../payments/payments.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { CsrStrategySelector } from "./csr-strategy.selector";
import { VoiceAddressPromptService } from "./voice-address-prompt.service";
import { VoiceHandoffPolicyService } from "./voice-handoff-policy.service";
import { VoicePromptComposerService } from "./voice-prompt-composer.service";
import { VoiceSmsHandoffService } from "./voice-sms-handoff.service";
import { VoiceSmsPhoneSlotService } from "./voice-sms-phone-slot.service";
import { VoiceTurnPolicyService } from "./voice-turn-policy.service";
import { VoiceUtteranceService } from "./voice-utterance.service";
import { VoiceUrgencySlotService } from "./voice-urgency-slot.service";
import { VoiceResponseService } from "./voice-response.service";
import { VoiceListeningWindowService } from "./voice-listening-window.service";
import { VoiceCallStateService } from "./voice-call-state.service";

const hasLegacyVoiceStateMethods = (
  value: unknown,
): value is VoiceConversationStateService =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { updateVoiceTranscript?: unknown })
        .updateVoiceTranscript === "function" &&
      typeof (value as { incrementVoiceTurn?: unknown }).incrementVoiceTurn ===
        "function",
  );

@Injectable()
export class VoiceTurnDependencies {
  public readonly voiceConversationStateService: VoiceConversationStateService;

  constructor(
    @Inject(TENANTS_SERVICE)
    public readonly tenantsService: TenantsService,
    public readonly conversationsService: ConversationsService,
    injectedVoiceConversationStateService: VoiceConversationStateService,
    public readonly callLogService: CallLogService,
    public readonly aiService: AiService,
    public readonly loggingService: LoggingService,
    public readonly sanitizationService: SanitizationService,
    public readonly csrStrategySelector: CsrStrategySelector,
    public readonly voicePromptComposer: VoicePromptComposerService,
    public readonly voiceHandoffPolicy: VoiceHandoffPolicyService,
    public readonly voiceSmsHandoffService: VoiceSmsHandoffService,
    public readonly voiceSmsPhoneSlotService: VoiceSmsPhoneSlotService,
    public readonly voiceTurnPolicyService: VoiceTurnPolicyService,
    public readonly voiceUtteranceService: VoiceUtteranceService,
    public readonly voiceUrgencySlotService: VoiceUrgencySlotService,
    public readonly paymentsService: PaymentsService,
    public readonly voiceAddressPromptService: VoiceAddressPromptService,
    public readonly voiceResponseService: VoiceResponseService,
    public readonly voiceListeningWindowService: VoiceListeningWindowService,
    public readonly voiceCallStateService: VoiceCallStateService,
  ) {
    this.voiceConversationStateService = hasLegacyVoiceStateMethods(
      this.conversationsService,
    )
      ? this.conversationsService
      : injectedVoiceConversationStateService;
  }
}
