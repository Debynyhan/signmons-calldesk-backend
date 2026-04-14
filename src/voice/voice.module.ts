import { Module } from "@nestjs/common";
import { VoiceController } from "./voice.controller";
import { TenantsModule } from "../tenants/tenants.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { AiModule } from "../ai/ai.module";
import { LoggingModule } from "../logging/logging.module";
import { AddressModule } from "../address/address.module";
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
import { VoiceSmsPhoneSlotService } from "./voice-sms-phone-slot.service";
import { VoiceUrgencySlotService } from "./voice-urgency-slot.service";
import { PaymentsModule } from "../payments/payments.module";
import { VoiceAddressPromptService } from "./voice-address-prompt.service";
import { VoiceTurnDependencies } from "./voice-turn.dependencies";
import { VoiceStreamDependencies } from "./voice-stream.dependencies";
import { VoiceUtteranceService } from "./voice-utterance.service";
import { VoiceWebhookParserService } from "./voice-webhook-parser.service";
import { VoiceTurnPolicyService } from "./voice-turn-policy.service";
import { VoiceResponseService } from "./voice-response.service";
import { VoiceListeningWindowService } from "./voice-listening-window.service";
import { VoiceCallStateService } from "./voice-call-state.service";
import { TwilioSignatureGuard } from "./twilio-signature.guard";
import { VoiceTurnRuntimeFactory } from "./voice-turn-runtime.factory";
import { VoiceTurnPipeline } from "./voice-turn-pipeline.service";
import { VOICE_TURN_STEPS } from "./voice-turn.constants";
import { VoiceInboundUseCase } from "./voice-inbound.use-case";
import { VoiceTurnPreludeContextFactory } from "./voice-turn-prelude-context.factory";
import { VoiceTurnNameFlowFactory } from "./voice-turn-name-flow.factory";
import { VoiceTurnAddressFlowFactory } from "./voice-turn-address-flow.factory";
import { VoiceTurnTriageHandoffFactory } from "./voice-turn-triage-handoff.factory";
import { VoiceTurnStepFactory } from "./voice-turn-step.factory";
import {
  VOICE_TURN_STEP_REGISTRATIONS,
  DEFAULT_VOICE_TURN_STEP_DESCRIPTORS,
} from "./voice-turn-step.token";

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
    AddressModule,
  ],
  providers: [
    CsrStrategySelector,
    VoiceCallService,
    VoiceStreamGateway,
    VoiceTurnService,
    VoicePromptComposerService,
    VoiceHandoffPolicyService,
    VoiceSmsHandoffService,
    VoiceSmsPhoneSlotService,
    VoiceTurnPolicyService,
    VoiceUtteranceService,
    VoiceWebhookParserService,
    VoiceUrgencySlotService,
    VoiceAddressPromptService,
    VoiceTurnDependencies,
    VoiceStreamDependencies,
    VoiceConsentAudioService,
    VoiceFillerAudioService,
    VoiceResponseService,
    VoiceListeningWindowService,
    VoiceCallStateService,
    TwilioSignatureGuard,
    VoiceTurnPreludeContextFactory,
    VoiceTurnNameFlowFactory,
    VoiceTurnAddressFlowFactory,
    VoiceTurnTriageHandoffFactory,
    VoiceTurnStepFactory,
    {
      provide: VOICE_TURN_STEP_REGISTRATIONS,
      useValue: DEFAULT_VOICE_TURN_STEP_DESCRIPTORS,
    },
    VoiceTurnRuntimeFactory,
    VoiceTurnPipeline,
    {
      provide: VOICE_TURN_STEPS,
      useFactory: (factory: VoiceTurnRuntimeFactory) => factory.buildSteps(),
      inject: [VoiceTurnRuntimeFactory],
    },
    VoiceInboundUseCase,
  ],
  controllers: [VoiceController],
})
export class VoiceModule {}
