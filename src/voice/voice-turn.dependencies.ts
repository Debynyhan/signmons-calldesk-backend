import { Inject, Injectable } from "@nestjs/common";
import { AiService } from "../ai/ai.service";
import { ConversationsService } from "../conversations/conversations.service";
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
import { VoiceUtteranceService } from "./voice-utterance.service";
import { VoiceUrgencySlotService } from "./voice-urgency-slot.service";

@Injectable()
export class VoiceTurnDependencies {
  constructor(
    @Inject(TENANTS_SERVICE)
    public readonly tenantsService: TenantsService,
    public readonly conversationsService: ConversationsService,
    public readonly callLogService: CallLogService,
    public readonly aiService: AiService,
    public readonly loggingService: LoggingService,
    public readonly sanitizationService: SanitizationService,
    public readonly csrStrategySelector: CsrStrategySelector,
    public readonly voicePromptComposer: VoicePromptComposerService,
    public readonly voiceHandoffPolicy: VoiceHandoffPolicyService,
    public readonly voiceSmsHandoffService: VoiceSmsHandoffService,
    public readonly voiceSmsPhoneSlotService: VoiceSmsPhoneSlotService,
    public readonly voiceUtteranceService: VoiceUtteranceService,
    public readonly voiceUrgencySlotService: VoiceUrgencySlotService,
    public readonly paymentsService: PaymentsService,
    public readonly voiceAddressPromptService: VoiceAddressPromptService,
  ) {}
}
