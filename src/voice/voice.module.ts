import { Module } from "@nestjs/common";
import { VoiceController } from "./voice.controller";
import { TenantsModule } from "../tenants/tenants.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { ConversationsService } from "../conversations/conversations.service";
import { AiModule } from "../ai/ai.module";
import { LoggingModule } from "../logging/logging.module";
import { AddressValidationService } from "../address/address-validation.service";

@Module({
  imports: [
    TenantsModule,
    PrismaModule,
    SanitizationModule,
    AiModule,
    LoggingModule,
  ],
  providers: [ConversationsService, AddressValidationService],
  controllers: [VoiceController],
})
export class VoiceModule {}
