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
import { StripeEventProcessorService } from "./stripe-event-processor.service";
import { VoiceIntakeSmsService } from "./voice-intake-sms.service";
import { IntakeCheckoutOrchestratorService } from "./intake-checkout-orchestrator.service";
import { PaymentsService } from "./payments.service";
import { PaymentsController } from "./payments.controller";
import { PaymentsPageRendererService } from "./payments-page-renderer.service";

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
  providers: [
    IntakeLinkService,
    IntakeFeeCalculatorService,
    StripeEventProcessorService,
    VoiceIntakeSmsService,
    IntakeCheckoutOrchestratorService,
    PaymentsPageRendererService,
    PaymentsService,
  ],
  exports: [IntakeLinkService, VoiceIntakeSmsService, PaymentsService],
})
export class PaymentsModule {}
