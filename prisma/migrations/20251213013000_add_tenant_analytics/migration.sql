-- CreateTable
CREATE TABLE "TenantAnalytics" (
    "tenantId" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "jobsCreated" INTEGER NOT NULL DEFAULT 0,
    "toolUsage" JSONB,
    "totalInfoCollectionMs" BIGINT NOT NULL DEFAULT 0,
    "completedSessions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantAnalytics_pkey" PRIMARY KEY ("tenantId"),
    CONSTRAINT "TenantAnalytics_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
