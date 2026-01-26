import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_FEE_POLICY,
  normalizeFeePolicyFromSettings,
} from "../src/tenants/fee-policy";

const prisma = new PrismaClient();

const run = async () => {
  const tenants = await prisma.tenantOrganization.findMany({
    select: { id: true, settings: true },
  });

  let createdCount = 0;

  for (const tenant of tenants) {
    const existing = await prisma.tenantFeePolicy.findFirst({
      where: { tenantId: tenant.id, isActive: true },
    });
    if (existing) {
      continue;
    }

    const normalized = normalizeFeePolicyFromSettings(
      tenant.settings,
      DEFAULT_FEE_POLICY,
    );

    await prisma.tenantFeePolicy.create({
      data: {
        tenantId: tenant.id,
        serviceFeeCents: normalized.serviceFeeCents,
        emergencyFeeCents: normalized.emergencyFeeCents,
        creditWindowHours: normalized.creditWindowHours,
        currency: normalized.currency,
        effectiveAt: new Date(),
        isActive: true,
      },
    });
    createdCount += 1;
  }

  // eslint-disable-next-line no-console
  console.log(`Backfilled fee policies for ${createdCount} tenant(s).`);
};

run()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Failed to backfill tenant fee policies.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
