import { Module } from "@nestjs/common";
import { VoiceController } from "./voice.controller";
import { TenantsModule } from "../tenants/tenants.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { ConversationsService } from "../conversations/conversations.service";
import { CallLogService } from "../logging/call-log.service";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [TenantsModule, PrismaModule, SanitizationModule, AiModule],
  providers: [ConversationsService, CallLogService],
  controllers: [VoiceController],
})
export class VoiceModule {}
