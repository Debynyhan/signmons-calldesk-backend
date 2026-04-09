import { Module } from "@nestjs/common";
import { VoiceController } from "./voice.controller";
import { TenantsModule } from "../tenants/tenants.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { AiModule } from "../ai/ai.module";
import { LoggingModule } from "../logging/logging.module";
import { AddressValidationService } from "../address/address-validation.service";
import { CsrStrategySelector } from "./csr-strategy.selector";
import { GoogleModule } from "../google/google.module";
import { VoiceCallService } from "./voice-call.service";
import { VoiceStreamGateway } from "./voice-stream.gateway";
import { VoiceTurnService } from "./voice-turn.service";
import { VoiceConsentAudioService } from "./voice-consent-audio.service";
import { VoiceFillerAudioService } from "./voice-filler-audio.service";
import { VoicePromptComposerService } from "./voice-prompt-composer.service";
import { VoiceHandoffPolicyService } from "./voice-handoff-policy.service";
import { VoiceSmsHandoffService } from "./voice-sms-handoff.service";
import { PaymentsModule } from "../payments/payments.module";

@Module({
  imports: [
    TenantsModule,
    PrismaModule,
    SanitizationModule,
    ConversationsModule,
    AiModule,
    LoggingModule,
    GoogleModule,
    PaymentsModule,
  ],
  providers: [
    AddressValidationService,
    CsrStrategySelector,
    VoiceCallService,
    VoiceStreamGateway,
    VoiceTurnService,
    VoicePromptComposerService,
    VoiceHandoffPolicyService,
    VoiceSmsHandoffService,
    VoiceConsentAudioService,
    VoiceFillerAudioService,
  ],
  controllers: [VoiceController],
})
export class VoiceModule {}
