import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TenantFeePolicySynchronizerService } from "../tenant-fee-policy-synchronizer.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import type { PrismaService } from "../../prisma/prisma.service";

describe("TenantFeePolicySynchronizerService", () => {
  let prisma: {
    tenantOrganization: { findUnique: jest.Mock; update: jest.Mock };
    tenantFeePolicy: { findFirst: jest.Mock; updateMany: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: TenantFeePolicySynchronizerService;

  const tenant = {
    id: "t-1",
    settings: {
      fees: {
        serviceFeeCents: 9900,
        emergencyFeeCents: 19900,
        creditWindowHours: 24,
        currency: "USD",
      },
    },
  };

  const existingPolicy = {
    id: "fp-1",
    tenantId: "t-1",
    serviceFeeCents: 9900,
    emergencyFeeCents: 19900,
    creditWindowHours: 24,
    currency: "USD",
    isActive: true,
    effectiveAt: new Date("2025-01-01"),
  };

  beforeEach(() => {
    prisma = {
      tenantOrganization: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      tenantFeePolicy: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    service = new TenantFeePolicySynchronizerService(
      prisma as unknown as PrismaService,
      new SanitizationService(),
    );
  });

  describe("sync", () => {
    it("returns existing policy when fee values are unchanged", async () => {
      prisma.tenantOrganization.findUnique.mockResolvedValue(tenant as never);
      prisma.tenantFeePolicy.findFirst.mockResolvedValue(existingPolicy as never);

      const result = await service.sync("t-1");

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result).toBe(existingPolicy);
    });

    it("creates a new policy when no existing policy is found", async () => {
      const newPolicy = { ...existingPolicy, id: "fp-2" };
      prisma.tenantOrganization.findUnique.mockResolvedValue(tenant as never);
      prisma.tenantFeePolicy.findFirst.mockResolvedValue(null as never);
      prisma.$transaction.mockResolvedValue([{}, newPolicy] as never);

      const result = await service.sync("t-1");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toBe(newPolicy);
    });

    it("creates a new policy when fee values have changed", async () => {
      const changedPolicy = { ...existingPolicy, serviceFeeCents: 5000 };
      const newPolicy = { ...existingPolicy, id: "fp-3" };
      prisma.tenantOrganization.findUnique.mockResolvedValue(tenant as never);
      prisma.tenantFeePolicy.findFirst.mockResolvedValue(changedPolicy as never);
      prisma.$transaction.mockResolvedValue([{}, newPolicy] as never);

      const result = await service.sync("t-1");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toBe(newPolicy);
    });

    it("throws NotFoundException for unknown tenantId", async () => {
      prisma.tenantOrganization.findUnique.mockResolvedValue(null as never);

      await expect(service.sync("unknown")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("updateSettings", () => {
    it("updates fee settings and syncs the policy", async () => {
      const newPolicy = { ...existingPolicy, serviceFeeCents: 7500 };
      prisma.tenantOrganization.findUnique.mockResolvedValue(tenant as never);
      prisma.tenantOrganization.update.mockResolvedValue(tenant as never);
      prisma.tenantFeePolicy.findFirst.mockResolvedValue(null as never);
      prisma.$transaction.mockResolvedValue([{}, newPolicy] as never);

      const result = await service.updateSettings("t-1", {
        serviceFeeCents: 7500,
      });

      expect(prisma.tenantOrganization.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "t-1" } }),
      );
      expect(result).toBe(newPolicy);
    });

    it("throws BadRequestException when no fields are provided", async () => {
      prisma.tenantOrganization.findUnique.mockResolvedValue(tenant as never);

      await expect(
        service.updateSettings("t-1", {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws NotFoundException for unknown tenantId", async () => {
      prisma.tenantOrganization.findUnique.mockResolvedValue(null as never);

      await expect(
        service.updateSettings("unknown", { serviceFeeCents: 1000 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
