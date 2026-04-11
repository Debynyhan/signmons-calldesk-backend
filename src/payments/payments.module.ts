import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SanitizationModule } from "../sanitization/sanitization.module";
import { TenantsModule } from "../tenants/tenants.module";
import { JobsModule } from "../jobs/jobs.module";
import { LoggingModule } from "../logging/logging.module";
import { SmsModule } from "../sms/sms.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { IntakeLinkService } from "./intake-link.service";
import { IntakeFeeCalculatorService } from "./intake-fee-calculator.service";
import { PaymentsService } from "./payments.service";
import { PaymentsController } from "./payments.controller";

@Module({
  imports: [
    PrismaModule,
    SanitizationModule,
    TenantsModule,
    JobsModule,
    LoggingModule,
    SmsModule,
    ConversationsModule,
  ],
  controllers: [PaymentsController],
  providers: [IntakeLinkService, IntakeFeeCalculatorService, PaymentsService],
  exports: [IntakeLinkService, PaymentsService],
})
export class PaymentsModule {}
