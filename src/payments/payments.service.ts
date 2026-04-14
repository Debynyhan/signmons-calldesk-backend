import {
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import type { Request } from "express";
import { Prisma, StripeEventStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LoggingService } from "../logging/logging.service";
import { IntakeFeeCalculatorService } from "./intake-fee-calculator.service";
import { StripeEventProcessorService } from "./stripe-event-processor.service";
import { VoiceIntakeSmsService } from "./voice-intake-sms.service";
import { IntakeCheckoutOrchestratorService } from "./intake-checkout-orchestrator.service";
import type { IntakeCheckoutDto } from "./dto/intake-checkout.dto";

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly intakeFeeCalculator: IntakeFeeCalculatorService,
    private readonly stripeEventProcessor: StripeEventProcessorService,
    private readonly voiceIntakeSmsService: VoiceIntakeSmsService,
    private readonly intakeCheckoutOrchestrator: IntakeCheckoutOrchestratorService,
  ) {}

  async getIntakePageData(token: string): Promise<{
    token: string;
    displayName: string;
    fullName: string;
    address: string;
    issue: string;
    phone: string;
    emergency: boolean;
    totalCents: number;
    currency: string;
  }> {
    const context = await this.intakeFeeCalculator.resolveIntakeContext(token);
    return {
      token,
      displayName: context.displayName,
      fullName: context.fullName ?? "",
      address: context.address ?? "",
      issue: context.issue ?? "",
      phone: context.customerPhone ?? context.callerPhone ?? "",
      emergency: context.isEmergency,
      totalCents: this.intakeFeeCalculator.computeTotalCents(context, context.isEmergency),
      currency: context.currency,
    };
  }

  async createCheckoutSessionFromIntake(params: {
    token: string;
    input: IntakeCheckoutDto;
  }): Promise<{ checkoutUrl: string; expiresAt: string }> {
    return this.intakeCheckoutOrchestrator.run(params);
  }

  async sendVoiceHandoffIntakeLink(params: {
    tenantId: string;
    conversationId: string;
    callSid: string;
    toPhone: string;
    displayName: string;
    isEmergency: boolean;
  }): Promise<void> {
    return this.voiceIntakeSmsService.sendVoiceHandoffIntakeLink(params);
  }

  async handleStripeWebhook(req: Request): Promise<{ received: true }> {
    const event = this.stripeEventProcessor.parse(req);
    const tenantId = this.stripeEventProcessor.extractTenantId(event);
    if (!tenantId) {
      this.loggingService.warn(
        {
          event: "stripe.webhook_missing_tenant",
          stripeEventId: event.id,
          type: event.type,
        },
        PaymentsService.name,
      );
      return { received: true };
    }

    const stripeEvent = await this.stripeEventProcessor.createEventRecord({
      tenantId,
      stripeEventId: event.id,
      type: event.type,
      payload: event as unknown as Prisma.InputJsonValue,
    });
    if (!stripeEvent) {
      return { received: true };
    }

    try {
      await this.stripeEventProcessor.process(tenantId, event);
      await this.prisma.stripeEvent.update({
        where: { id: stripeEvent.id },
        data: {
          processingStatus: StripeEventStatus.PROCESSED,
          processedAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.prisma.stripeEvent.update({
        where: { id: stripeEvent.id },
        data: {
          processingStatus: StripeEventStatus.FAILED,
          processedAt: new Date(),
          errorMessage: reason,
        },
      });
      this.loggingService.error(
        "stripe.webhook_processing_failed",
        error instanceof Error ? error : new Error(reason),
        PaymentsService.name,
      );
      throw new InternalServerErrorException("Stripe webhook processing failed.");
    }

    return { received: true };
  }
}
