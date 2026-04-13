import { randomUUID } from "crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  JobUrgency,
  PaymentStatus,
  Prisma,
  StripeEventStatus,
} from "@prisma/client";
import Stripe from "stripe";
import appConfig, { type AppConfig } from "../config/app.config";
import { PrismaService } from "../prisma/prisma.service";
import { SanitizationService } from "../sanitization/sanitization.service";
import { LoggingService } from "../logging/logging.service";
import { IntakeLinkService } from "./intake-link.service";
import { IntakeFeeCalculatorService } from "./intake-fee-calculator.service";
import { StripeEventProcessorService } from "./stripe-event-processor.service";
import { VoiceIntakeSmsService } from "./voice-intake-sms.service";
import { CONVERSATION_LIFECYCLE_SERVICE, type IConversationLifecycleService } from "../conversations/conversation-lifecycle.service.interface";
import { JobsService } from "../jobs/jobs.service";
import type { IntakeCheckoutDto } from "./dto/intake-checkout.dto";

@Injectable()
export class PaymentsService {
  private stripeClient: Stripe | null = null;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly sanitizationService: SanitizationService,
    private readonly loggingService: LoggingService,
    private readonly intakeLinkService: IntakeLinkService,
    private readonly intakeFeeCalculator: IntakeFeeCalculatorService,
    private readonly stripeEventProcessor: StripeEventProcessorService,
    private readonly voiceIntakeSmsService: VoiceIntakeSmsService,
    @Inject(CONVERSATION_LIFECYCLE_SERVICE) private readonly conversationLifecycleService: IConversationLifecycleService,
    private readonly jobsService: JobsService,
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
      totalCents: this.intakeFeeCalculator.computeTotalCents(
        context,
        context.isEmergency,
      ),
      currency: context.currency,
    };
  }

  async createCheckoutSessionFromIntake(params: {
    token: string;
    input: IntakeCheckoutDto;
  }): Promise<{ checkoutUrl: string; expiresAt: string }> {
    const context = await this.intakeFeeCalculator.resolveIntakeContext(
      params.token,
    );
    const fullName =
      this.sanitizeText(params.input.fullName) ??
      this.sanitizeText(context.fullName) ??
      null;
    const address =
      this.sanitizeText(params.input.address) ??
      this.sanitizeText(context.address) ??
      null;
    const issue =
      this.sanitizeText(params.input.issue) ??
      this.sanitizeText(context.issue) ??
      null;
    const phone =
      this.normalizePhone(params.input.phone) ??
      this.normalizePhone(context.customerPhone) ??
      this.normalizePhone(context.callerPhone) ??
      null;
    const isEmergency =
      typeof params.input.emergency === "boolean"
        ? params.input.emergency
        : context.isEmergency;

    if (!fullName || !address || !issue || !phone) {
      throw new BadRequestException(
        "Missing required intake details: name, address, issue, and phone.",
      );
    }

    await this.voiceIntakeSmsService.persistSmsIntakeFields({
      tenantId: context.tenantId,
      conversationId: context.conversationId,
      fullName,
      address,
      issue,
    });

    const jobId = await this.ensureJobForConversation({
      tenantId: context.tenantId,
      conversationId: context.conversationId,
      existingJobId: context.existingJobId,
      sessionId: context.conversationId,
      fullName,
      address,
      issue,
      phone,
      isEmergency,
    });

    const totalCents = this.intakeFeeCalculator.computeTotalCents(
      context,
      isEmergency,
    );
    const stripe = this.getStripeClientOrThrow();
    const currency = context.currency.toLowerCase();
    const intakeUrl = this.intakeLinkService.buildIntakeUrl(params.token);
    const successUrl = `${intakeUrl}/success`;
    const cancelUrl = `${intakeUrl}/cancel`;

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: context.conversationId,
      metadata: {
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        jobId,
        emergency: isEmergency ? "true" : "false",
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: totalCents,
            product_data: {
              name: isEmergency
                ? "Emergency Dispatch Authorization"
                : "Service Dispatch Authorization",
              description:
                "This payment authorizes dispatch. Service fee terms are set by the company.",
            },
          },
        },
      ],
      payment_intent_data: {
        metadata: {
          tenantId: context.tenantId,
          conversationId: context.conversationId,
          jobId,
        },
      },
    });

    await this.upsertPaymentForCheckout({
      tenantId: context.tenantId,
      jobId,
      checkoutSessionId: checkoutSession.id,
      paymentIntentId:
        typeof checkoutSession.payment_intent === "string"
          ? checkoutSession.payment_intent
          : null,
      amountTotalCents: totalCents,
      currency,
    });

    await this.voiceIntakeSmsService.updateVoiceIntakePaymentState({
      tenantId: context.tenantId,
      conversationId: context.conversationId,
      next: {
        checkoutSessionId: checkoutSession.id,
        checkoutCreatedAt: new Date().toISOString(),
        amountCents: totalCents,
        currency,
      },
    });

    if (!checkoutSession.url) {
      throw new BadRequestException("Stripe Checkout URL was not returned.");
    }

    return {
      checkoutUrl: checkoutSession.url,
      expiresAt: new Date((checkoutSession.expires_at ?? 0) * 1000).toISOString(),
    };
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

  private async ensureJobForConversation(params: {
    tenantId: string;
    conversationId: string;
    existingJobId: string | null;
    sessionId: string;
    fullName: string;
    phone: string;
    address: string;
    issue: string;
    isEmergency: boolean;
  }): Promise<string> {
    if (params.existingJobId) {
      return params.existingJobId;
    }

    const rawArgs = JSON.stringify({
      customerName: params.fullName,
      phone: params.phone,
      address: params.address,
      issueCategory: this.intakeFeeCalculator.inferIssueCategory(params.issue),
      urgency: params.isEmergency ? JobUrgency.EMERGENCY : JobUrgency.STANDARD,
      description: params.issue,
      preferredTime: "asap",
    });
    const job = await this.jobsService.createJobFromToolCall({
      tenantId: params.tenantId,
      sessionId: params.sessionId,
      rawArgs,
    });
    await this.conversationLifecycleService.linkJobToConversation({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      jobId: job.id,
    });
    return job.id;
  }

  private async upsertPaymentForCheckout(params: {
    tenantId: string;
    jobId: string;
    checkoutSessionId: string;
    paymentIntentId: string | null;
    amountTotalCents: number;
    currency: string;
  }): Promise<void> {
    await this.prisma.payment.upsert({
      where: {
        tenantId_jobId: {
          tenantId: params.tenantId,
          jobId: params.jobId,
        },
      },
      create: {
        id: randomUUID(),
        tenantId: params.tenantId,
        jobId: params.jobId,
        jobTenantId: params.tenantId,
        status: PaymentStatus.PENDING,
        stripeCheckoutSessionId: params.checkoutSessionId,
        stripePaymentIntentId: params.paymentIntentId,
        amountTotalCents: params.amountTotalCents,
        applicationFeeAmountCents: 0,
        currency: params.currency,
      },
      update: {
        status: PaymentStatus.PENDING,
        stripeCheckoutSessionId: params.checkoutSessionId,
        stripePaymentIntentId: params.paymentIntentId,
        amountTotalCents: params.amountTotalCents,
        currency: params.currency,
        updatedAt: new Date(),
      },
    });
  }

  private getStripeClientOrThrow(): Stripe {
    const client = this.getStripeClient();
    if (!client) {
      throw new BadRequestException(
        "Stripe test key is not configured. Set STRIPE_SECRET_KEY in .env.",
      );
    }
    return client;
  }

  private getStripeClient(): Stripe | null {
    if (!this.config.stripeSecretKey) {
      return null;
    }
    if (!this.stripeClient) {
      this.stripeClient = new Stripe(this.config.stripeSecretKey, {
        apiVersion: "2024-06-20",
      });
    }
    return this.stripeClient;
  }

  private sanitizeText(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const sanitized = this.sanitizationService.sanitizeText(value);
    return sanitized.length ? sanitized : null;
  }

  private normalizePhone(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const normalized = this.sanitizationService.normalizePhoneE164(value);
    return normalized || null;
  }

}
