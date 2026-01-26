-- CreateTable
CREATE TABLE "TenantFeePolicy" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "serviceFeeCents" INTEGER NOT NULL,
    "emergencyFeeCents" INTEGER NOT NULL DEFAULT 0,
    "creditWindowHours" INTEGER NOT NULL DEFAULT 24,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantFeePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantFeePolicy_id_tenantId_key" ON "TenantFeePolicy"("id", "tenantId");

-- CreateIndex
CREATE INDEX "TenantFeePolicy_tenantId_isActive_idx" ON "TenantFeePolicy"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "TenantFeePolicy_tenantId_effectiveAt_idx" ON "TenantFeePolicy"("tenantId", "effectiveAt");

-- AddForeignKey
ALTER TABLE "TenantFeePolicy" ADD CONSTRAINT "TenantFeePolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
