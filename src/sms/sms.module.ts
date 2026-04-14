import { Module } from "@nestjs/common";
import { SmsController } from "./sms.controller";
import { SmsService } from "./sms.service";
import { ConversationsModule } from "../conversations/conversations.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { AdminApiGuard } from "../common/guards/admin-api.guard";
import { AdminAuditInterceptor } from "../common/interceptors/admin-audit.interceptor";
import { AiModule } from "../ai/ai.module";
import { TenantsModule } from "../tenants/tenants.module";
import { LoggingModule } from "../logging/logging.module";
import { SmsInboundUseCase } from "./sms-inbound.use-case";

@Module({
  imports: [
    PrismaModule,
    SanitizationModule,
    ConversationsModule,
    AiModule,
    TenantsModule,
    LoggingModule,
  ],
  controllers: [SmsController],
  providers: [
    SmsService,
    AdminApiGuard,
    AdminAuditInterceptor,
    SmsInboundUseCase,
  ],
  exports: [SmsService],
})
export class SmsModule {}
