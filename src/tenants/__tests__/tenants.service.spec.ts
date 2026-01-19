import { PrismaTenantsService } from "../tenants.service";
import { SanitizationService } from "../../sanitization/sanitization.service";
import type { PrismaService } from "../../prisma/prisma.service";

describe("PrismaTenantsService", () => {
  let prisma: {
    tenantOrganization: { findFirst: jest.Mock };
  };
  let service: PrismaTenantsService;

  beforeEach(() => {
    prisma = {
      tenantOrganization: {
        findFirst: jest.fn(),
      },
    };
    service = new PrismaTenantsService(
      prisma as unknown as PrismaService,
      new SanitizationService(),
    );
  });

  it("normalizes To numbers without +1 to E.164", async () => {
    prisma.tenantOrganization.findFirst.mockResolvedValue(null as never);

    await service.resolveTenantByPhone("2167448929");

    expect(prisma.tenantOrganization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { voiceNumber: "+12167448929" },
      }),
    );
  });

  it("accepts already normalized E.164 numbers", async () => {
    prisma.tenantOrganization.findFirst.mockResolvedValue(null as never);

    await service.resolveTenantByPhone("+12167448929");

    expect(prisma.tenantOrganization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { voiceNumber: "+12167448929" },
      }),
    );
  });
});
