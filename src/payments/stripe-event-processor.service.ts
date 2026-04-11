import { randomUUID } from "crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  type Payment,
  PaymentStatus,
  Prisma,
  StripeEventStatus,
} from "@prisma/client";
import Stripe from "stripe";
import appConfig, { type AppConfig } from "../config/app.config";
import { PrismaService } from "../prisma/prisma.service";
import { LoggingService } from "../logging/logging.service";
import { JobsService } from "../jobs/jobs.service";

@Injectable()
export class StripeEventProcessorService {
  private stripeClient: Stripe | null = null;

  constructor(
    @Inject(appConfig.KEY)
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
    private readonly loggingService: LoggingService,
  ) {}

  parse(req: Request): Stripe.Event {
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

  extractTenantId(event: Stripe.Event): string | null {
    const object = event.data.object as { metadata?: Record<string, string> };
    return object?.metadata?.tenantId ?? null;
  }

  async createEventRecord(params: {
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

  async process(tenantId: string, event: Stripe.Event): Promise<void> {
    if (event.type === "checkout.session.completed") {
      await this.processCheckoutSessionCompleted(tenantId, event);
      return;
    }

    if (event.type === "checkout.session.expired") {
      await this.processCheckoutSessionExpired(tenantId, event);
      return;
    }

    if (event.type === "payment_intent.payment_failed") {
      await this.processPaymentIntentFailed(tenantId, event);
    }
  }

  private async processCheckoutSessionCompleted(
    tenantId: string,
    event: Stripe.Event,
  ): Promise<void> {
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
        StripeEventProcessorService.name,
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
        StripeEventProcessorService.name,
      );
    }
  }

  private async processCheckoutSessionExpired(
    tenantId: string,
    event: Stripe.Event,
  ): Promise<void> {
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
  }

  private async processPaymentIntentFailed(
    tenantId: string,
    event: Stripe.Event,
  ): Promise<void> {
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
}
