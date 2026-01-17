import { Module } from "@nestjs/common";
import { VoiceController } from "./voice.controller";
import { TenantsModule } from "../tenants/tenants.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { ConversationsService } from "../conversations/conversations.service";

@Module({
  imports: [TenantsModule, PrismaModule, SanitizationModule],
  providers: [ConversationsService],
  controllers: [VoiceController],
})
export class VoiceModule {}
