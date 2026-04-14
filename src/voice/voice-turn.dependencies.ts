import { Inject, Injectable } from "@nestjs/common";
import { AiService } from "../ai/ai.service";
import { CONVERSATIONS_SERVICE, type IConversationsService } from "../conversations/conversations.service.interface";
import { VOICE_CONVERSATION_STATE_SERVICE, type IVoiceConversationStateService } from "../conversations/voice-conversation-state.service.interface";
import { CALL_LOG_SERVICE, type ICallLogService } from "../logging/call-log.service.interface";
import { LoggingService } from "../logging/logging.service";
import { PaymentsService } from "../payments/payments.service";
import { VoiceIntakeSmsService } from "../payments/voice-intake-sms.service";
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

@Injectable()
export class VoiceTurnDependencies {
  constructor(
    @Inject(TENANTS_SERVICE)
    public readonly tenantsService: TenantsService,
    @Inject(CONVERSATIONS_SERVICE) public readonly conversationsService: IConversationsService,
    @Inject(VOICE_CONVERSATION_STATE_SERVICE)
    public readonly voiceConversationStateService: IVoiceConversationStateService,
    @Inject(CALL_LOG_SERVICE)
    public readonly callLogService: ICallLogService,
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
    public readonly voiceIntakeSmsService: VoiceIntakeSmsService,
    public readonly voiceAddressPromptService: VoiceAddressPromptService,
    public readonly voiceResponseService: VoiceResponseService,
    public readonly voiceListeningWindowService: VoiceListeningWindowService,
    public readonly voiceCallStateService: VoiceCallStateService,
  ) {}
}
