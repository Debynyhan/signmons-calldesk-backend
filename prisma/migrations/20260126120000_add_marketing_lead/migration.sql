-- CreateEnum
CREATE TYPE "MarketingLeadStatus" AS ENUM ('PENDING', 'CALLING', 'CALLED', 'FAILED');

-- CreateTable
CREATE TABLE "MarketingLead" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "email" TEXT,
    "consentToAutoCall" BOOLEAN NOT NULL,
    "consentTextVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "demoScenario" TEXT,
    "callMode" TEXT NOT NULL DEFAULT 'immediate',
    "timezone" TEXT,
    "preferredCallTime" TIMESTAMP(3),
    "utm" JSONB,
    "referrerUrl" TEXT,
    "status" "MarketingLeadStatus" NOT NULL DEFAULT 'PENDING',
    "callSid" TEXT,
    "lastCallAt" TIMESTAMP(3),
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingLead_tenantId_idx" ON "MarketingLead"("tenantId");

-- CreateIndex
CREATE INDEX "MarketingLead_phone_createdAt_idx" ON "MarketingLead"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingLead_status_createdAt_idx" ON "MarketingLead"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketingLead" ADD CONSTRAINT "MarketingLead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
