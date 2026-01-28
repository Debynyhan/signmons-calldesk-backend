import { Module } from "@nestjs/common";
import { SmsController } from "./sms.controller";
import { SmsService } from "./sms.service";
import { ConversationsService } from "../conversations/conversations.service";
import { PrismaModule } from "../prisma/prisma.module";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { AdminApiGuard } from "../common/guards/admin-api.guard";
import { AiModule } from "../ai/ai.module";
import { TenantsModule } from "../tenants/tenants.module";
import { LoggingModule } from "../logging/logging.module";

@Module({
  imports: [
    PrismaModule,
    SanitizationModule,
    AiModule,
    TenantsModule,
    LoggingModule,
  ],
  controllers: [SmsController],
  providers: [ConversationsService, SmsService, AdminApiGuard],
})
export class SmsModule {}
