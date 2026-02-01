import { Module } from "@nestjs/common";
import { VoiceController } from "./voice.controller";
import { TenantsModule } from "../tenants/tenants.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { ConversationsService } from "../conversations/conversations.service";
import { AiModule } from "../ai/ai.module";
import { LoggingModule } from "../logging/logging.module";
import { AddressValidationService } from "../address/address-validation.service";
import { CsrStrategySelector } from "./csr-strategy.selector";
import { GoogleModule } from "../google/google.module";
import { VoiceCallService } from "./voice-call.service";
import { VoiceStreamGateway } from "./voice-stream.gateway";
import { VoiceTurnService } from "./voice-turn.service";
import { VoiceConsentAudioService } from "./voice-consent-audio.service";

@Module({
  imports: [
    TenantsModule,
    PrismaModule,
    SanitizationModule,
    AiModule,
    LoggingModule,
    GoogleModule,
  ],
  providers: [
    ConversationsService,
    AddressValidationService,
    CsrStrategySelector,
    VoiceCallService,
    VoiceStreamGateway,
    VoiceTurnService,
    VoiceConsentAudioService,
  ],
  controllers: [VoiceController],
})
export class VoiceModule {}
