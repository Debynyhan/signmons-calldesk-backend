-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "emergencySurchargeAmount" INTEGER NOT NULL DEFAULT 75,
ADD COLUMN     "emergencySurchargeEnabled" BOOLEAN NOT NULL DEFAULT false;
