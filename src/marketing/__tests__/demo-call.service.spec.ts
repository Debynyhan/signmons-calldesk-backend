import type { MarketingLead, MarketingLeadStatus } from "@prisma/client";
import type { AppConfig } from "../../config/app.config";
import type { PrismaService } from "../../prisma/prisma.service";
import type { LoggingService } from "../../logging/logging.service";
import { DemoCallService, TRY_DEMO_RATE_LIMIT_MS } from "../demo-call.service";

jest.mock("twilio");

const buildConfig = (overrides: Partial<AppConfig> = {}): AppConfig =>
  ({
    twilioAccountSid: "AC_test",
    twilioAuthToken: "auth_token",
    twilioPhoneNumber: "+12167448929",
    twilioWebhookBaseUrl: "https://example.ngrok.io",
    ...overrides,
  }) as AppConfig;

const buildPrisma = () => ({
  marketingLead: {
    update: jest.fn(),
  },
});

const buildLogging = () => ({
  log: jest.fn(),
  warn: jest.fn(),
});

const buildService = (overrides: {
  config?: Partial<AppConfig>;
  prisma?: ReturnType<typeof buildPrisma>;
  logging?: ReturnType<typeof buildLogging>;
} = {}) => {
  const config = buildConfig(overrides.config);
  const prisma = overrides.prisma ?? buildPrisma();
  const logging = overrides.logging ?? buildLogging();
  return {
    service: new DemoCallService(
      config,
      prisma as unknown as PrismaService,
      logging as unknown as LoggingService,
    ),
    config,
    prisma,
    logging,
  };
};

const makeLead = (overrides: Partial<MarketingLead> = {}): MarketingLead =>
  ({
    id: "lead-1",
    phone: "+12165551234",
    status: "PENDING" as MarketingLeadStatus,
    createdAt: new Date(),
    callSid: null,
    errorReason: null,
    ...overrides,
  }) as MarketingLead;

describe("DemoCallService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("place", () => {
    it("places a Twilio call and returns queued status on success", async () => {
      const { Twilio } = jest.requireMock("twilio") as {
        Twilio: jest.MockedClass<{ new (...args: unknown[]): unknown }>;
      };
      const callsCreate = jest.fn().mockResolvedValue({ sid: "CA_test_1" });
      (Twilio as jest.Mock).mockImplementation(() => ({
        calls: { create: callsCreate },
      }));

      const prisma = buildPrisma();
      prisma.marketingLead.update.mockResolvedValue({} as never);
      const { service } = buildService({ prisma });

      const result = await service.place(makeLead());

      expect(callsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "+12165551234",
          from: "+12167448929",
        }),
      );
      expect(result.status).toBe("queued");
      expect(result.call.status).toBe("initiated");
      expect(result.call.callSid).toBe("CA_test_1");
      expect(result.retry.allowed).toBe(false);
    });

    it("returns failed status when Twilio throws", async () => {
      const { Twilio } = jest.requireMock("twilio") as {
        Twilio: jest.MockedClass<{ new (...args: unknown[]): unknown }>;
      };
      const callsCreate = jest
        .fn()
        .mockRejectedValue(new Error("twilio_error"));
      (Twilio as jest.Mock).mockImplementation(() => ({
        calls: { create: callsCreate },
      }));

      const prisma = buildPrisma();
      prisma.marketingLead.update.mockResolvedValue({} as never);
      const { service } = buildService({ prisma });

      const result = await service.place(makeLead());

      expect(result.status).toBe("failed");
      expect(result.call.status).toBe("failed");
      expect(result.call.callSid).toBeNull();
      expect(result.retry.allowed).toBe(true);
      expect(result.retry.reason).toBe("provider_unavailable");
    });

    it("logs success after placing a call", async () => {
      const { Twilio } = jest.requireMock("twilio") as {
        Twilio: jest.MockedClass<{ new (...args: unknown[]): unknown }>;
      };
      (Twilio as jest.Mock).mockImplementation(() => ({
        calls: { create: jest.fn().mockResolvedValue({ sid: "CA_1" }) },
      }));

      const prisma = buildPrisma();
      prisma.marketingLead.update.mockResolvedValue({} as never);
      const logging = buildLogging();
      const { service } = buildService({ prisma, logging });

      await service.place(makeLead());

      expect(logging.log).toHaveBeenCalledWith(
        expect.objectContaining({ event: "marketing.try_demo_called" }),
        expect.any(String),
      );
    });

    it("logs a warning when Twilio fails", async () => {
      const { Twilio } = jest.requireMock("twilio") as {
        Twilio: jest.MockedClass<{ new (...args: unknown[]): unknown }>;
      };
      (Twilio as jest.Mock).mockImplementation(() => ({
        calls: { create: jest.fn().mockRejectedValue(new Error("boom")) },
      }));

      const prisma = buildPrisma();
      prisma.marketingLead.update.mockResolvedValue({} as never);
      const logging = buildLogging();
      const { service } = buildService({ prisma, logging });

      await service.place(makeLead());

      expect(logging.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "marketing.try_demo_call_failed" }),
        expect.any(String),
      );
    });
  });

  describe("mapStatus", () => {
    it.each([
      ["completed", "CALLED"],
      ["busy", "FAILED"],
      ["failed", "FAILED"],
      ["no-answer", "FAILED"],
      ["noanswer", "FAILED"],
      ["canceled", "FAILED"],
    ])("maps Twilio status '%s' to '%s'", (raw, expected) => {
      const { service } = buildService();
      expect(service.mapStatus(raw)).toBe(expected);
    });

    it("returns null for unrecognised statuses", () => {
      const { service } = buildService();
      expect(service.mapStatus("ringing")).toBeNull();
      expect(service.mapStatus("in-progress")).toBeNull();
      expect(service.mapStatus("queued")).toBeNull();
    });
  });

  describe("mapLeadCallStatus", () => {
    it.each<[MarketingLeadStatus, string]>([
      ["CALLING", "calling"],
      ["CALLED", "completed"],
      ["FAILED", "failed"],
      ["PENDING", "pending"],
    ])("maps lead status '%s' to '%s'", (status, expected) => {
      const { service } = buildService();
      expect(service.mapLeadCallStatus(status)).toBe(expected);
    });
  });

  describe("buildRetryInfo", () => {
    it("returns not allowed when lead status is not FAILED", () => {
      const { service } = buildService();
      const lead = makeLead({ status: "CALLING" });
      const result = service.buildRetryInfo(lead, new Date());
      expect(result).toEqual({ allowed: false, afterSec: 0, reason: null });
    });

    it("returns not allowed with afterSec > 0 for FAILED lead within window", () => {
      const { service } = buildService();
      const lead = makeLead({
        status: "FAILED",
        createdAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
      });
      const result = service.buildRetryInfo(lead, new Date());
      expect(result.allowed).toBe(false);
      expect(result.afterSec).toBeGreaterThan(0);
      expect(result.reason).toBe("rate_limited");
    });

    it("returns allowed when FAILED lead is outside the rate limit window", () => {
      const { service } = buildService();
      const lead = makeLead({
        status: "FAILED",
        createdAt: new Date(
          Date.now() - TRY_DEMO_RATE_LIMIT_MS - 10 * 1000,
        ),
      });
      const result = service.buildRetryInfo(lead, new Date());
      expect(result.allowed).toBe(true);
      expect(result.afterSec).toBe(0);
      expect(result.reason).toBeNull();
    });
  });

  describe("normalizeFailureReason", () => {
    it("returns null for null input", () => {
      const { service } = buildService();
      expect(service.normalizeFailureReason(null)).toBeNull();
    });

    it("normalizes known Twilio statuses", () => {
      const { service } = buildService();
      expect(service.normalizeFailureReason("busy")).toBe("busy");
      expect(service.normalizeFailureReason("failed")).toBe("failed");
      expect(service.normalizeFailureReason("no-answer")).toBe("no-answer");
      expect(service.normalizeFailureReason("noanswer")).toBe("no-answer");
      expect(service.normalizeFailureReason("canceled")).toBe("canceled");
      expect(service.normalizeFailureReason("provider_unavailable")).toBe(
        "provider_unavailable",
      );
    });

    it("strips call_status: prefix", () => {
      const { service } = buildService();
      expect(service.normalizeFailureReason("call_status:busy")).toBe("busy");
    });

    it("falls back to 'failed' for unknown reasons", () => {
      const { service } = buildService();
      expect(service.normalizeFailureReason("something_weird")).toBe("failed");
    });
  });
});
