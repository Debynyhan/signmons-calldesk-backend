import { StripeEventProcessorService } from "../stripe-event-processor.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { JobsService } from "../../jobs/jobs.service";
import type { LoggingService } from "../../logging/logging.service";
import type { AppConfig } from "../../config/app.config";
import type Stripe from "stripe";

const buildConfig = (overrides: Partial<AppConfig> = {}): AppConfig =>
  ({
    stripeSecretKey: "sk_test_abc",
    stripeWebhookSecret: "",
    environment: "test",
    ...overrides,
  }) as AppConfig;

const buildPrisma = () => ({
  stripeEvent: {
    create: jest.fn(),
  },
  payment: {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
});

const buildJobsService = () => ({
  acceptJobAfterPayment: jest.fn().mockResolvedValue({ id: "job-1", status: "ACCEPTED" }),
});

const buildLoggingService = () => ({
  warn: jest.fn(),
});

const buildService = (
  overrides: {
    prisma?: ReturnType<typeof buildPrisma>;
    jobs?: ReturnType<typeof buildJobsService>;
    logging?: ReturnType<typeof buildLoggingService>;
    config?: Partial<AppConfig>;
  } = {},
) => {
  const prisma = overrides.prisma ?? buildPrisma();
  const jobs = overrides.jobs ?? buildJobsService();
  const logging = overrides.logging ?? buildLoggingService();
  const config = buildConfig(overrides.config);
  return {
    service: new StripeEventProcessorService(
      config,
      prisma as unknown as PrismaService,
      jobs as unknown as JobsService,
      logging as unknown as LoggingService,
    ),
    prisma,
    jobs,
    logging,
  };
};

const makeEvent = (
  type: string,
  data: Record<string, unknown>,
  metadata: Record<string, string> = { tenantId: "tenant-1" },
): Stripe.Event =>
  ({
    id: "evt_test_1",
    type,
    data: { object: { ...data, metadata } },
  }) as unknown as Stripe.Event;

describe("StripeEventProcessorService", () => {
  describe("extractTenantId", () => {
    it("extracts tenantId from event metadata", () => {
      const { service } = buildService();
      const event = makeEvent("checkout.session.completed", {}, { tenantId: "t-1" });
      expect(service.extractTenantId(event)).toBe("t-1");
    });

    it("returns null when metadata is missing", () => {
      const { service } = buildService();
      const event = {
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: {} },
      } as unknown as Stripe.Event;
      expect(service.extractTenantId(event)).toBeNull();
    });

    it("returns null when metadata object is absent", () => {
      const { service } = buildService();
      const event = {
        id: "evt_2",
        type: "checkout.session.completed",
        data: { object: { id: "no_metadata" } },
      } as unknown as Stripe.Event;
      expect(service.extractTenantId(event)).toBeNull();
    });
  });

  describe("createEventRecord", () => {
    it("creates a stripe event record", async () => {
      const prisma = buildPrisma();
      prisma.stripeEvent.create.mockResolvedValue({ id: "se-1" } as never);
      const { service } = buildService({ prisma });

      const result = await service.createEventRecord({
        tenantId: "t-1",
        stripeEventId: "evt_1",
        type: "checkout.session.completed",
        payload: {} as never,
      });

      expect(prisma.stripeEvent.create).toHaveBeenCalled();
      expect(result).toEqual({ id: "se-1" });
    });

    it("returns null on duplicate (P2002)", async () => {
      const prisma = buildPrisma();
      const { Prisma: PrismaTypes } = jest.requireActual("@prisma/client");
      const dupError = new PrismaTypes.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "5.0",
      });
      prisma.stripeEvent.create.mockRejectedValue(dupError);
      const { service } = buildService({ prisma });

      const result = await service.createEventRecord({
        tenantId: "t-1",
        stripeEventId: "evt_1",
        type: "checkout.session.completed",
        payload: {} as never,
      });

      expect(result).toBeNull();
    });
  });

  describe("process — checkout.session.completed", () => {
    it("marks payment SUCCEEDED and accepts the job", async () => {
      const prisma = buildPrisma();
      prisma.payment.findFirst.mockResolvedValue({
        id: "pay-1",
        jobId: "job-1",
        stripePaymentIntentId: null,
        amountTotalCents: 9900,
      } as never);
      prisma.payment.update.mockResolvedValue({} as never);
      const jobs = buildJobsService();
      const { service } = buildService({ prisma, jobs });

      const event = makeEvent("checkout.session.completed", {
        id: "cs_test_1",
        payment_intent: "pi_test_1",
        amount_total: 9900,
      });

      await service.process("tenant-1", event);

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "SUCCEEDED" }),
        }),
      );
      expect(jobs.acceptJobAfterPayment).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-1", jobId: "job-1" }),
      );
    });

    it("logs a warning when no matching payment is found", async () => {
      const prisma = buildPrisma();
      prisma.payment.findFirst.mockResolvedValue(null as never);
      const logging = buildLoggingService();
      const { service } = buildService({ prisma, logging });

      const event = makeEvent("checkout.session.completed", {
        id: "cs_test_nomatch",
        payment_intent: "pi_test_nomatch",
        amount_total: 9900,
      });

      await service.process("tenant-1", event);

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(logging.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "stripe.checkout_completed_unmatched_payment" }),
        expect.any(String),
      );
    });

    it("does not throw when acceptJobAfterPayment fails", async () => {
      const prisma = buildPrisma();
      prisma.payment.findFirst.mockResolvedValue({
        id: "pay-1",
        jobId: "job-1",
        stripePaymentIntentId: null,
        amountTotalCents: 9900,
      } as never);
      prisma.payment.update.mockResolvedValue({} as never);
      const jobs = buildJobsService();
      jobs.acceptJobAfterPayment.mockRejectedValue(new Error("job already accepted"));
      const logging = buildLoggingService();
      const { service } = buildService({ prisma, jobs, logging });

      const event = makeEvent("checkout.session.completed", {
        id: "cs_test_1",
        payment_intent: "pi_test_1",
        amount_total: 9900,
      });

      await expect(service.process("tenant-1", event)).resolves.not.toThrow();
      expect(logging.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "stripe.job_accept_after_payment_failed" }),
        expect.any(String),
      );
    });
  });

  describe("process — checkout.session.expired", () => {
    it("cancels pending payments for the expired session", async () => {
      const prisma = buildPrisma();
      prisma.payment.updateMany.mockResolvedValue({ count: 1 } as never);
      const { service } = buildService({ prisma });

      const event = makeEvent("checkout.session.expired", { id: "cs_exp_1" });

      await service.process("tenant-1", event);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stripeCheckoutSessionId: "cs_exp_1" }),
          data: expect.objectContaining({ status: "CANCELED" }),
        }),
      );
    });
  });

  describe("process — payment_intent.payment_failed", () => {
    it("marks matching pending payment as FAILED", async () => {
      const prisma = buildPrisma();
      prisma.payment.updateMany.mockResolvedValue({ count: 1 } as never);
      const { service } = buildService({ prisma });

      const event = makeEvent("payment_intent.payment_failed", { id: "pi_fail_1" });

      await service.process("tenant-1", event);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stripePaymentIntentId: "pi_fail_1" }),
          data: expect.objectContaining({ status: "FAILED" }),
        }),
      );
    });

    it("falls back to jobId lookup when no payment matches by intent id", async () => {
      const prisma = buildPrisma();
      prisma.payment.updateMany
        .mockResolvedValueOnce({ count: 0 } as never)
        .mockResolvedValueOnce({ count: 1 } as never);
      const { service } = buildService({ prisma });

      const event = makeEvent(
        "payment_intent.payment_failed",
        { id: "pi_fail_2" },
        { tenantId: "tenant-1", jobId: "job-1" },
      );

      await service.process("tenant-1", event);

      expect(prisma.payment.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.payment.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ jobId: "job-1" }),
        }),
      );
    });
  });

  describe("process — unknown event type", () => {
    it("is a no-op for unrecognised event types", async () => {
      const prisma = buildPrisma();
      const { service } = buildService({ prisma });

      const event = makeEvent("customer.created", { id: "cus_1" });

      await expect(service.process("tenant-1", event)).resolves.toBeUndefined();
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });
  });
});
