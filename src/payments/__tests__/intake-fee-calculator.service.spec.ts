import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { DEFAULT_FEE_POLICY } from "../../tenants/fee-policy";
import { SanitizationService } from "../../sanitization/sanitization.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { TenantsService } from "../../tenants/interfaces/tenants-service.interface";
import { IntakeFeeCalculatorService } from "../intake-fee-calculator.service";
import type { IntakeLinkService } from "../intake-link.service";

describe("IntakeFeeCalculatorService", () => {
  let prisma: {
    conversation: {
      findFirst: jest.Mock;
    };
  };
  let tenantsService: {
    getTenantById: jest.Mock;
    getTenantFeePolicy: jest.Mock;
  };
  let intakeLinkService: {
    verifyConversationToken: jest.Mock;
  };
  let service: IntakeFeeCalculatorService;

  beforeEach(() => {
    prisma = {
      conversation: {
        findFirst: jest.fn(),
      },
    };
    tenantsService = {
      getTenantById: jest.fn(),
      getTenantFeePolicy: jest.fn(),
    };
    intakeLinkService = {
      verifyConversationToken: jest.fn(),
    };

    service = new IntakeFeeCalculatorService(
      prisma as unknown as PrismaService,
      new SanitizationService(),
      intakeLinkService as unknown as IntakeLinkService,
      tenantsService as unknown as TenantsService,
    );
  });

  describe("resolveIntakeContext", () => {
    it("resolves context from conversation, tenant, and fee policy", async () => {
      intakeLinkService.verifyConversationToken.mockReturnValue({
        tid: "tenant-1",
        cid: "conversation-1",
      } as never);
      prisma.conversation.findFirst.mockResolvedValue({
        id: "conversation-1",
        collectedData: {
          name: {
            candidate: { value: " Jane Doe " },
            confirmed: { value: null },
          },
          address: {
            confirmed: " 123 Main St ",
          },
          smsPhone: {
            value: "(216) 555-0000",
          },
          voiceUrgencyConfirmation: {
            response: "YES",
          },
          issueCandidate: {
            value: " No heat in bedrooms ",
          },
          callerPhone: "+12165551111",
        },
        customer: {
          fullName: "Fallback Name",
        },
        jobLinks: [{ jobId: "job-1" }],
      } as never);
      tenantsService.getTenantById.mockResolvedValue({
        id: "tenant-1",
        name: "Acme HVAC",
        settings: {
          displayName: "Acme Heating & Cooling",
        },
      } as never);
      tenantsService.getTenantFeePolicy.mockResolvedValue({
        serviceFeeCents: 12500,
        emergencyFeeCents: 5000,
        creditWindowHours: 24,
        currency: "usd",
      } as never);

      const context = await service.resolveIntakeContext("token-1");

      expect(context).toMatchObject({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        customerPhone: "+12165550000",
        callerPhone: "+12165551111",
        fullName: "Jane Doe",
        address: "123 Main St",
        issue: "No heat in bedrooms",
        isEmergency: true,
        displayName: "Acme Heating & Cooling",
        serviceFeeCents: 12500,
        emergencyFeeCents: 5000,
        creditWindowHours: 24,
        currency: "USD",
        existingJobId: "job-1",
      });
    });

    it("uses defaults when fee policy is missing", async () => {
      intakeLinkService.verifyConversationToken.mockReturnValue({
        tid: "tenant-1",
        cid: "conversation-1",
      } as never);
      prisma.conversation.findFirst.mockResolvedValue({
        id: "conversation-1",
        collectedData: null,
        customer: null,
        jobLinks: [],
      } as never);
      tenantsService.getTenantById.mockResolvedValue({
        id: "tenant-1",
        name: "Acme HVAC",
        settings: {},
      } as never);
      tenantsService.getTenantFeePolicy.mockResolvedValue(null as never);

      const context = await service.resolveIntakeContext("token-2");

      expect(context.displayName).toBe("Acme HVAC");
      expect(context.serviceFeeCents).toBe(DEFAULT_FEE_POLICY.serviceFeeCents);
      expect(context.emergencyFeeCents).toBe(
        DEFAULT_FEE_POLICY.emergencyFeeCents,
      );
      expect(context.creditWindowHours).toBe(DEFAULT_FEE_POLICY.creditWindowHours);
      expect(context.currency).toBe(DEFAULT_FEE_POLICY.currency);
      expect(context.isEmergency).toBe(false);
    });

    it("throws UnauthorizedException for invalid token", async () => {
      intakeLinkService.verifyConversationToken.mockReturnValue(null as never);

      await expect(service.resolveIntakeContext("bad-token")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("throws NotFoundException when conversation is missing", async () => {
      intakeLinkService.verifyConversationToken.mockReturnValue({
        tid: "tenant-1",
        cid: "conversation-1",
      } as never);
      prisma.conversation.findFirst.mockResolvedValue(null as never);

      await expect(service.resolveIntakeContext("token-3")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("computeTotalCents", () => {
    it("adds emergency fee when emergency is true", () => {
      expect(
        service.computeTotalCents(
          { serviceFeeCents: 12000, emergencyFeeCents: 6000 },
          true,
        ),
      ).toBe(18000);
    });

    it("returns only service fee when emergency is false", () => {
      expect(
        service.computeTotalCents(
          { serviceFeeCents: 12000, emergencyFeeCents: 6000 },
          false,
        ),
      ).toBe(12000);
    });

    it("floors total at zero", () => {
      expect(
        service.computeTotalCents(
          { serviceFeeCents: -500, emergencyFeeCents: -1000 },
          true,
        ),
      ).toBe(0);
    });
  });

  describe("inferIssueCategory", () => {
    it("maps heating keywords", () => {
      expect(service.inferIssueCategory("furnace is down")).toBe("HEATING");
    });

    it("maps cooling keywords", () => {
      expect(service.inferIssueCategory("ac compressor failure")).toBe(
        "COOLING",
      );
    });

    it("maps plumbing keywords", () => {
      expect(service.inferIssueCategory("water leak in wall")).toBe("PLUMBING");
    });

    it("maps electrical keywords", () => {
      expect(service.inferIssueCategory("breaker keeps tripping")).toBe(
        "ELECTRICAL",
      );
    });

    it("defaults to GENERAL", () => {
      expect(service.inferIssueCategory("strange smell")).toBe("GENERAL");
    });
  });

  describe("formatFeeAmount", () => {
    it("formats cents as dollars", () => {
      expect(service.formatFeeAmount(12500)).toBe("$125.00");
    });

    it("floors negatives to zero", () => {
      expect(service.formatFeeAmount(-1)).toBe("$0.00");
    });
  });
});
