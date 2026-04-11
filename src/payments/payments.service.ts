import { randomUUID } from "crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  JobUrgency,
  type Payment,
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
import { ConversationsService } from "../conversations/conversations.service";
import { JobsService } from "../jobs/jobs.service";
import { SmsService } from "../sms/sms.service";
import { TENANTS_SERVICE } from "../tenants/tenants.constants";
import type { TenantsService } from "../tenants/interfaces/tenants-service.interface";
import { DEFAULT_FEE_POLICY } from "../tenants/fee-policy";
import { VoiceConversationStateService } from "../voice/voice-conversation-state.service";
import type { IntakeCheckoutDto } from "./dto/intake-checkout.dto";

type IntakeContext = {
  tenantId: string;
  conversationId: string;
  customerPhone: string | null;
  callerPhone: string | null;
  fullName: string | null;
  address: string | null;
  issue: string | null;
  isEmergency: boolean;
  displayName: string;
  serviceFeeCents: number;
  emergencyFeeCents: number;
  creditWindowHours: number;
  currency: string;
  existingJobId: string | null;
  collectedData: Prisma.JsonValue | null;
};

type VoiceIntakePaymentState = {
  linkSentAt?: string;
  linkMessageSid?: string | null;
  linkToPhone?: string | null;
  intakeUrl?: string;
  tokenExpiresAt?: string;
  amountCents?: number;
  currency?: string;
  checkoutSessionId?: string;
  checkoutCreatedAt?: string;
};

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
    private readonly conversationsService: ConversationsService,
    private readonly voiceConversationStateService: VoiceConversationStateService,
    private readonly jobsService: JobsService,
    private readonly smsService: SmsService,
    @Inject(TENANTS_SERVICE)
    private readonly tenantsService: TenantsService,
  ) {}

  private get stateService(): Pick<
    VoiceConversationStateService,
    "promoteNameFromSms" | "promoteAddressFromSms" | "updateVoiceIssueCandidate"
  > {
    const legacy = this.conversationsService as Partial<VoiceConversationStateService>;
    if (
      typeof legacy.promoteNameFromSms === "function" &&
      typeof legacy.promoteAddressFromSms === "function" &&
      typeof legacy.updateVoiceIssueCandidate === "function"
    ) {
      return legacy as Pick<
        VoiceConversationStateService,
        "promoteNameFromSms" | "promoteAddressFromSms" | "updateVoiceIssueCandidate"
      >;
    }
    return this.voiceConversationStateService;
  }

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
    const context = await this.resolveIntakeContext(token);
    return {
      token,
      displayName: context.displayName,
      fullName: context.fullName ?? "",
      address: context.address ?? "",
      issue: context.issue ?? "",
      phone: context.customerPhone ?? context.callerPhone ?? "",
      emergency: context.isEmergency,
      totalCents: this.computeTotalCents(context, context.isEmergency),
      currency: context.currency,
    };
  }

  async createCheckoutSessionFromIntake(params: {
    token: string;
    input: IntakeCheckoutDto;
  }): Promise<{ checkoutUrl: string; expiresAt: string }> {
    const context = await this.resolveIntakeContext(params.token);
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

    await this.persistSmsIntakeFields({
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

    const totalCents = this.computeTotalCents(context, isEmergency);
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

    await this.updateVoiceIntakePaymentState({
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
    if (!this.config.stripeSecretKey) {
      return;
    }
    if (!this.config.smsIntakeBaseUrl && !this.config.twilioWebhookBaseUrl) {
      this.loggingService.warn(
        {
          event: "voice.sms_intake_link_skipped",
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          callSid: params.callSid,
          reason: "missing_public_base_url",
        },
        PaymentsService.name,
      );
      return;
    }
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
      select: { id: true, collectedData: true },
    });
    if (!conversation) {
      return;
    }
    const state = this.getVoiceIntakePaymentState(conversation.collectedData);
    if (state?.linkSentAt && state?.intakeUrl) {
      return;
    }

    const tokenData = this.intakeLinkService.createConversationToken({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
    const intakeUrl = this.intakeLinkService.buildIntakeUrl(tokenData.token);
    const feePolicy =
      (await this.tenantsService.getTenantFeePolicy(params.tenantId)) ??
      DEFAULT_FEE_POLICY;
    const totalCents = Math.max(
      0,
      feePolicy.serviceFeeCents +
        (params.isEmergency ? feePolicy.emergencyFeeCents : 0),
    );
    const amount = this.formatFeeAmount(totalCents);
    const body = `Thanks for calling ${params.displayName}. Confirm your details and pay ${amount} to dispatch: ${intakeUrl}`;

    const messageSid = await this.smsService.sendMessage({
      to: params.toPhone,
      body,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });

    await this.updateVoiceIntakePaymentState({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      next: {
        linkSentAt: new Date().toISOString(),
        linkMessageSid: messageSid ?? null,
        linkToPhone: params.toPhone,
        intakeUrl,
        tokenExpiresAt: tokenData.expiresAt,
        amountCents: totalCents,
        currency: feePolicy.currency.toLowerCase(),
      },
    });

    this.loggingService.log(
      {
        event: "voice.sms_intake_link_sent",
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        callSid: params.callSid,
        to: params.toPhone,
        hasMessageSid: Boolean(messageSid),
      },
      PaymentsService.name,
    );
  }

  async handleStripeWebhook(req: Request): Promise<{ received: true }> {
    const event = this.parseWebhookEvent(req);
    const tenantId = this.extractTenantId(event);
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

    const stripeEvent = await this.createStripeEventRecord({
      tenantId,
      stripeEventId: event.id,
      type: event.type,
      payload: event as unknown as Prisma.InputJsonValue,
    });
    if (!stripeEvent) {
      return { received: true };
    }

    try {
      await this.processStripeEvent(tenantId, event);
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
      throw error;
    }

    return { received: true };
  }

  private async resolveIntakeContext(token: string): Promise<IntakeContext> {
    const parsed = this.intakeLinkService.verifyConversationToken(token);
    if (!parsed) {
      throw new UnauthorizedException("Invalid or expired intake link.");
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: parsed.tid,
        id: parsed.cid,
      },
      include: {
        customer: true,
        jobLinks: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException("Conversation not found.");
    }

    const tenant = await this.tenantsService.getTenantById(parsed.tid);
    if (!tenant) {
      throw new NotFoundException("Tenant not found.");
    }

    const policy =
      (await this.tenantsService.getTenantFeePolicy(parsed.tid)) ??
      DEFAULT_FEE_POLICY;
    const collectedData = conversation.collectedData ?? null;
    const nameState = this.conversationsService.getVoiceNameState(collectedData);
    const addressState =
      this.conversationsService.getVoiceAddressState(collectedData);
    const phoneState = this.conversationsService.getVoiceSmsPhoneState(
      collectedData,
    );
    const urgency =
      this.conversationsService.getVoiceUrgencyConfirmation(collectedData);
    const issue = this.extractIssue(collectedData);

    const fullName =
      this.sanitizeText(nameState.confirmed.value) ??
      this.sanitizeText(nameState.candidate.value) ??
      this.sanitizeText(conversation.customer?.fullName) ??
      null;
    const address =
      this.sanitizeText(addressState.confirmed) ??
      this.sanitizeText(addressState.candidate) ??
      null;
    const customerPhone = this.normalizePhone(phoneState.value);
    const callerPhone = this.extractCallerPhone(collectedData);
    const displayName = this.resolveTenantDisplayName(tenant.settings, tenant.name);

    return {
      tenantId: parsed.tid,
      conversationId: parsed.cid,
      customerPhone,
      callerPhone,
      fullName,
      address,
      issue,
      isEmergency: urgency.response === "YES",
      displayName,
      serviceFeeCents: policy.serviceFeeCents,
      emergencyFeeCents: policy.emergencyFeeCents,
      creditWindowHours: policy.creditWindowHours,
      currency: policy.currency.toUpperCase(),
      existingJobId: conversation.jobLinks[0]?.jobId ?? null,
      collectedData,
    };
  }

  private async persistSmsIntakeFields(params: {
    tenantId: string;
    conversationId: string;
    fullName: string;
    address: string;
    issue: string;
  }): Promise<void> {
    const sourceEventId = `sms-intake-${randomUUID()}`;
    await this.stateService.promoteNameFromSms({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      value: params.fullName,
      sourceEventId,
    });
    await this.stateService.promoteAddressFromSms({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      value: params.address,
      sourceEventId,
    });
    await this.stateService.updateVoiceIssueCandidate({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      issue: {
        value: params.issue,
        sourceEventId,
        createdAt: new Date().toISOString(),
      },
    });
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
      issueCategory: this.inferIssueCategory(params.issue),
      urgency: params.isEmergency ? JobUrgency.EMERGENCY : JobUrgency.STANDARD,
      description: params.issue,
      preferredTime: "asap",
    });
    const job = await this.jobsService.createJobFromToolCall({
      tenantId: params.tenantId,
      sessionId: params.sessionId,
      rawArgs,
    });
    await this.conversationsService.linkJobToConversation({
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

  private parseWebhookEvent(req: Request): Stripe.Event {
    const stripe = this.getStripeClientOrThrow();
    const signature = req.header("stripe-signature");
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const hasWebhookSecret = Boolean(this.config.stripeWebhookSecret);
    const shouldVerify = hasWebhookSecret && Boolean(signature);

    if (shouldVerify && rawBody && signature) {
      return stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.stripeWebhookSecret,
      );
    }

    if (this.config.environment === "production" && hasWebhookSecret) {
      throw new UnauthorizedException(
        "Stripe signature verification is required in production.",
      );
    }

    return req.body as Stripe.Event;
  }

  private extractTenantId(event: Stripe.Event): string | null {
    const object = event.data.object as { metadata?: Record<string, string> };
    return object?.metadata?.tenantId ?? null;
  }

  private async createStripeEventRecord(params: {
    tenantId: string;
    stripeEventId: string;
    type: string;
    payload: Prisma.InputJsonValue;
  }) {
    try {
      return await this.prisma.stripeEvent.create({
        data: {
          id: randomUUID(),
          tenantId: params.tenantId,
          stripeEventId: params.stripeEventId,
          type: params.type,
          payload: params.payload,
          processingStatus: StripeEventStatus.PENDING,
          receivedAt: new Date(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return null;
      }
      throw error;
    }
  }

  private async processStripeEvent(
    tenantId: string,
    event: Stripe.Event,
  ): Promise<void> {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : null;
      const payment = await this.findPaymentForCheckoutSessionComplete({
        tenantId,
        session,
        paymentIntentId,
      });
      if (!payment) {
        this.loggingService.warn(
          {
            event: "stripe.checkout_completed_unmatched_payment",
            tenantId,
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
            jobId: this.getMetadataValue(session.metadata, "jobId"),
          },
          PaymentsService.name,
        );
        return;
      }
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: paymentIntentId ?? payment.stripePaymentIntentId,
          amountTotalCents:
            typeof session.amount_total === "number"
              ? session.amount_total
              : payment.amountTotalCents,
          updatedAt: new Date(),
        },
      });
      try {
        await this.jobsService.acceptJobAfterPayment({
          tenantId,
          jobId: payment.jobId,
          paymentIntentId: paymentIntentId ?? undefined,
        });
      } catch (error) {
        this.loggingService.warn(
          {
            event: "stripe.job_accept_after_payment_failed",
            tenantId,
            jobId: payment.jobId,
            reason: error instanceof Error ? error.message : String(error),
          },
          PaymentsService.name,
        );
      }
      return;
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      await this.prisma.payment.updateMany({
        where: {
          tenantId,
          stripeCheckoutSessionId: session.id,
          status: PaymentStatus.PENDING,
        },
        data: {
          status: PaymentStatus.CANCELED,
          updatedAt: new Date(),
        },
      });
      return;
    }

    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const result = await this.prisma.payment.updateMany({
        where: {
          tenantId,
          stripePaymentIntentId: intent.id,
          status: PaymentStatus.PENDING,
        },
        data: {
          status: PaymentStatus.FAILED,
          updatedAt: new Date(),
        },
      });
      if (result.count === 0) {
        const jobId = this.getMetadataValue(intent.metadata, "jobId");
        if (jobId) {
          await this.prisma.payment.updateMany({
            where: {
              tenantId,
              jobId,
              status: PaymentStatus.PENDING,
            },
            data: {
              status: PaymentStatus.FAILED,
              stripePaymentIntentId: intent.id,
              updatedAt: new Date(),
            },
          });
        }
      }
    }
  }

  private async findPaymentForCheckoutSessionComplete(params: {
    tenantId: string;
    session: Stripe.Checkout.Session;
    paymentIntentId: string | null;
  }): Promise<Payment | null> {
    const paymentBySession = await this.prisma.payment.findFirst({
      where: {
        tenantId: params.tenantId,
        stripeCheckoutSessionId: params.session.id,
      },
    });
    if (paymentBySession) {
      return paymentBySession;
    }

    if (params.paymentIntentId) {
      const paymentByIntent = await this.prisma.payment.findFirst({
        where: {
          tenantId: params.tenantId,
          stripePaymentIntentId: params.paymentIntentId,
        },
      });
      if (paymentByIntent) {
        return paymentByIntent;
      }
    }

    const jobId = this.getMetadataValue(params.session.metadata, "jobId");
    if (!jobId) {
      return null;
    }
    return this.prisma.payment.findFirst({
      where: {
        tenantId: params.tenantId,
        jobId,
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

  private computeTotalCents(
    context: {
      serviceFeeCents: number;
      emergencyFeeCents: number;
    },
    isEmergency: boolean,
  ): number {
    return Math.max(
      0,
      context.serviceFeeCents + (isEmergency ? context.emergencyFeeCents : 0),
    );
  }

  private inferIssueCategory(issue: string): string {
    const normalized = issue.toLowerCase();
    if (/\b(heat|furnace|boiler)\b/.test(normalized)) {
      return "HEATING";
    }
    if (/\b(ac|cool|air conditioning|compressor)\b/.test(normalized)) {
      return "COOLING";
    }
    if (/\b(pipe|drain|leak|water|plumb)\b/.test(normalized)) {
      return "PLUMBING";
    }
    if (/\b(outlet|breaker|electric|panel|power)\b/.test(normalized)) {
      return "ELECTRICAL";
    }
    return "GENERAL";
  }

  private resolveTenantDisplayName(settings: unknown, fallback: string): string {
    if (settings && typeof settings === "object") {
      const value = (settings as { displayName?: unknown }).displayName;
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return fallback;
  }

  private extractIssue(collectedData: Prisma.JsonValue | null): string | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const issueCandidate = (collectedData as Record<string, unknown>)
      .issueCandidate;
    if (!issueCandidate || typeof issueCandidate !== "object") {
      return null;
    }
    const value = (issueCandidate as { value?: unknown }).value;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private extractCallerPhone(collectedData: Prisma.JsonValue | null): string | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const value = (collectedData as Record<string, unknown>).callerPhone;
    return typeof value === "string" ? this.normalizePhone(value) : null;
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

  private formatFeeAmount(cents: number): string {
    const dollars = Math.max(0, cents) / 100;
    return `$${dollars.toFixed(2)}`;
  }

  private getVoiceIntakePaymentState(
    collectedData: Prisma.JsonValue | null,
  ): VoiceIntakePaymentState | null {
    if (!collectedData || typeof collectedData !== "object") {
      return null;
    }
    const raw = (collectedData as Record<string, unknown>).voiceIntakePayment;
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return raw as VoiceIntakePaymentState;
  }

  private async updateVoiceIntakePaymentState(params: {
    tenantId: string;
    conversationId: string;
    next: VoiceIntakePaymentState;
  }): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: params.tenantId,
        id: params.conversationId,
      },
      select: { id: true, collectedData: true },
    });
    if (!conversation) {
      return;
    }
    const current =
      conversation.collectedData && typeof conversation.collectedData === "object"
        ? (conversation.collectedData as Record<string, unknown>)
        : {};
    const existingState = this.getVoiceIntakePaymentState(
      conversation.collectedData ?? null,
    );
    const merged: Prisma.InputJsonValue = {
      ...current,
      voiceIntakePayment: {
        ...(existingState ?? {}),
        ...params.next,
      },
    };
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { collectedData: merged, updatedAt: new Date() },
    });
  }

  private getMetadataValue(
    metadata: Stripe.Metadata | null | undefined,
    key: string,
  ): string | null {
    const value = metadata?.[key];
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed || null;
  }
}
