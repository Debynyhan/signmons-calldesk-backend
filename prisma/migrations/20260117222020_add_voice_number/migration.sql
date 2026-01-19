/*
  Warnings:

  - The values [PENDING,SCHEDULED] on the enum `JobStatus` will be removed. If these variants are still used in the database, this will fail.
  - The primary key for the `Job` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `address` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `customerName` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `issueCategory` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `preferredTime` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the `CallLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Tenant` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[id,tenantId]` on the table `Job` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `customerId` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `customerTenantId` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `policySnapshot` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `pricingSnapshot` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `propertyAddressId` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `propertyAddressTenantId` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serviceCategoryId` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serviceCategoryTenantId` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `id` on the `Job` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenantId` on the `Job` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `urgency` on the `Job` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'CHURNED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ConnectOnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'DISPATCHER', 'TECH', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID');

-- CreateEnum
CREATE TYPE "ServiceAreaType" AS ENUM ('ZIP', 'RADIUS', 'POLYGON');

-- CreateEnum
CREATE TYPE "ServiceAreaStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CoverageStatus" AS ENUM ('IN_COVERAGE', 'OUT_OF_COVERAGE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CoverageReasonCode" AS ENUM ('NO_MATCH', 'AREA_INACTIVE', 'MISSING_GEO', 'OTHER');

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('VOICE', 'SMS', 'WEBCHAT');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ONGOING', 'COMPLETED', 'ABANDONED', 'FAILED_PAYMENT');

-- CreateEnum
CREATE TYPE "ConversationJobRelation" AS ENUM ('CREATED_FROM', 'ABOUT', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "JobUrgency" AS ENUM ('STANDARD', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "PreferredWindowLabel" AS ENUM ('ASAP', 'MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "JobOfferChannel" AS ENUM ('DASHBOARD', 'SMS', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "JobOfferStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AvailabilityBlockType" AS ENUM ('UNAVAILABLE', 'AVAILABLE_OVERRIDE');

-- CreateEnum
CREATE TYPE "ProficiencyLevel" AS ENUM ('JUNIOR', 'STANDARD', 'EXPERT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('NONE', 'PARTIAL', 'FULL');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CHARGE', 'PLATFORM_FEE', 'TENANT_PAYOUT', 'REFUND');

-- CreateEnum
CREATE TYPE "StripeEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('SMS', 'VOICE', 'WEBCHAT', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CommunicationProvider" AS ENUM ('TWILIO', 'SENDGRID', 'FCM', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "RedactionLevel" AS ENUM ('NONE', 'PARTIAL', 'FULL');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM_AI', 'WEBHOOK');

-- AlterEnum
BEGIN;
CREATE TYPE "JobStatus_new" AS ENUM ('CREATED', 'OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
ALTER TABLE "public"."Job" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Job" ALTER COLUMN "status" TYPE "JobStatus_new" USING ("status"::text::"JobStatus_new");
ALTER TYPE "JobStatus" RENAME TO "JobStatus_old";
ALTER TYPE "JobStatus_new" RENAME TO "JobStatus";
DROP TYPE "public"."JobStatus_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "CallLog" DROP CONSTRAINT "CallLog_jobId_fkey";

-- DropForeignKey
ALTER TABLE "CallLog" DROP CONSTRAINT "CallLog_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_tenantId_fkey";

-- DropIndex
DROP INDEX "Job_status_idx";

-- AlterTable
ALTER TABLE "Job" DROP CONSTRAINT "Job_pkey",
DROP COLUMN "address",
DROP COLUMN "customerName",
DROP COLUMN "issueCategory",
DROP COLUMN "metadata",
DROP COLUMN "phone",
DROP COLUMN "preferredTime",
ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "assignedUserId" UUID,
ADD COLUMN     "assignedUserTenantId" UUID,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "customerId" UUID NOT NULL,
ADD COLUMN     "customerTenantId" UUID NOT NULL,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "offerExpiresAt" TIMESTAMP(3),
ADD COLUMN     "policySnapshot" JSONB NOT NULL,
ADD COLUMN     "preferredWindowLabel" "PreferredWindowLabel",
ADD COLUMN     "pricingSnapshot" JSONB NOT NULL,
ADD COLUMN     "propertyAddressId" UUID NOT NULL,
ADD COLUMN     "propertyAddressTenantId" UUID NOT NULL,
ADD COLUMN     "serviceCategoryId" UUID NOT NULL,
ADD COLUMN     "serviceCategoryTenantId" UUID NOT NULL,
ADD COLUMN     "serviceWindowEnd" TIMESTAMP(3),
ADD COLUMN     "serviceWindowStart" TIMESTAMP(3),
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenantId",
ADD COLUMN     "tenantId" UUID NOT NULL,
DROP COLUMN "urgency",
ADD COLUMN     "urgency" "JobUrgency" NOT NULL,
ALTER COLUMN "status" DROP DEFAULT,
ADD CONSTRAINT "Job_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "CallLog";

-- DropTable
DROP TABLE "Tenant";

-- DropEnum
DROP TYPE "CallDirection";

-- DropEnum
DROP TYPE "CallOutcome";

-- CreateTable
CREATE TABLE "TenantOrganization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "voiceNumber" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "stripeCustomerId" TEXT,
    "stripeConnectAccountId" TEXT,
    "connectOnboardingStatus" "ConnectOnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "phone" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSubscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "planId" TEXT NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "basePriceCents" INTEGER NOT NULL DEFAULT 0,
    "emergencySurchargeCents" INTEGER NOT NULL DEFAULT 0,
    "estimatedDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "aiMetadata" JSONB,
    "consentToText" BOOLEAN NOT NULL DEFAULT false,
    "consentToTextAt" TIMESTAMP(3),
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "marketingOptInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyAddress" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerTenantId" UUID NOT NULL,
    "googlePlaceId" TEXT NOT NULL,
    "formattedAddress" TEXT NOT NULL,
    "addressComponents" JSONB NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accessNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PropertyAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceArea" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ServiceAreaType" NOT NULL,
    "definition" JSONB NOT NULL,
    "status" "ServiceAreaStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCoverageCheck" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "propertyAddressId" UUID NOT NULL,
    "propertyAddressTenantId" UUID NOT NULL,
    "serviceAreaId" UUID,
    "serviceAreaTenantId" UUID,
    "status" "CoverageStatus" NOT NULL,
    "reasonCode" "CoverageReasonCode" NOT NULL,
    "metadata" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCoverageCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerTenantId" UUID NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "status" "ConversationStatus" NOT NULL,
    "currentFSMState" TEXT NOT NULL,
    "collectedData" JSONB,
    "providerConversationId" TEXT,
    "twilioCallSid" TEXT,
    "twilioSmsSid" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationJobLink" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "conversationTenantId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "jobTenantId" UUID NOT NULL,
    "relationType" "ConversationJobRelation" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationJobLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOffer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "jobTenantId" UUID NOT NULL,
    "offeredToUserId" UUID,
    "offeredToUserTenantId" UUID,
    "channel" "JobOfferChannel" NOT NULL,
    "status" "JobOfferStatus" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAvailabilityBlock" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userTenantId" UUID NOT NULL,
    "type" "AvailabilityBlockType" NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "rrule" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAvailabilityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserServiceCapability" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userTenantId" UUID NOT NULL,
    "serviceCategoryId" UUID NOT NULL,
    "serviceCategoryTenantId" UUID NOT NULL,
    "proficiency" "ProficiencyLevel" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserServiceCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "jobTenantId" UUID NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "stripePaymentIntentId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "stripeChargeId" TEXT,
    "destinationAccountId" TEXT,
    "amountTotalCents" INTEGER NOT NULL,
    "applicationFeeAmountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "refundStatus" "RefundStatus" NOT NULL DEFAULT 'NONE',
    "refundAmountCents" INTEGER,
    "stripeRefundId" TEXT,
    "refundReason" TEXT,
    "transferGroup" TEXT,
    "transferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "jobId" UUID,
    "jobTenantId" UUID,
    "paymentId" UUID,
    "paymentTenantId" UUID,
    "type" "LedgerEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processingStatus" "StripeEventStatus" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID,
    "conversationTenantId" UUID,
    "jobId" UUID,
    "jobTenantId" UUID,
    "channel" "CommunicationChannel" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL,
    "provider" "CommunicationProvider" NOT NULL,
    "externalId" TEXT,
    "status" "CommunicationStatus" NOT NULL,
    "redactionLevel" "RedactionLevel" NOT NULL DEFAULT 'PARTIAL',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationContent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "communicationEventId" UUID NOT NULL,
    "communicationEventTenantId" UUID NOT NULL,
    "templateId" TEXT,
    "payload" JSONB NOT NULL,
    "encryptedRaw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" UUID,
    "actorUserTenantId" UUID,
    "actorId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantOrganization_voiceNumber_key" ON "TenantOrganization"("voiceNumber");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_tenantId_key" ON "User"("id", "tenantId");

-- CreateIndex
CREATE INDEX "TenantSubscription_tenantId_idx" ON "TenantSubscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSubscription_tenantId_stripeSubscriptionId_key" ON "TenantSubscription"("tenantId", "stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSubscription_id_tenantId_key" ON "TenantSubscription"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ServiceCategory_tenantId_idx" ON "ServiceCategory"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_id_tenantId_key" ON "ServiceCategory"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_phone_key" ON "Customer"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_tenantId_key" ON "Customer"("id", "tenantId");

-- CreateIndex
CREATE INDEX "PropertyAddress_tenantId_idx" ON "PropertyAddress"("tenantId");

-- CreateIndex
CREATE INDEX "PropertyAddress_customerId_customerTenantId_idx" ON "PropertyAddress"("customerId", "customerTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyAddress_tenantId_googlePlaceId_key" ON "PropertyAddress"("tenantId", "googlePlaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyAddress_id_tenantId_key" ON "PropertyAddress"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ServiceArea_tenantId_idx" ON "ServiceArea"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceArea_id_tenantId_key" ON "ServiceArea"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CustomerCoverageCheck_tenantId_propertyAddressId_checkedAt_idx" ON "CustomerCoverageCheck"("tenantId", "propertyAddressId", "checkedAt");

-- CreateIndex
CREATE INDEX "CustomerCoverageCheck_serviceAreaId_serviceAreaTenantId_idx" ON "CustomerCoverageCheck"("serviceAreaId", "serviceAreaTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCoverageCheck_id_tenantId_key" ON "CustomerCoverageCheck"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_idx" ON "Conversation"("tenantId");

-- CreateIndex
CREATE INDEX "Conversation_customerId_customerTenantId_idx" ON "Conversation"("customerId", "customerTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_id_tenantId_key" ON "Conversation"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ConversationJobLink_tenantId_idx" ON "ConversationJobLink"("tenantId");

-- CreateIndex
CREATE INDEX "ConversationJobLink_conversationId_conversationTenantId_idx" ON "ConversationJobLink"("conversationId", "conversationTenantId");

-- CreateIndex
CREATE INDEX "ConversationJobLink_jobId_jobTenantId_idx" ON "ConversationJobLink"("jobId", "jobTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationJobLink_tenantId_conversationId_jobId_key" ON "ConversationJobLink"("tenantId", "conversationId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationJobLink_id_tenantId_key" ON "ConversationJobLink"("id", "tenantId");

-- CreateIndex
CREATE INDEX "JobOffer_tenantId_idx" ON "JobOffer"("tenantId");

-- CreateIndex
CREATE INDEX "JobOffer_jobId_jobTenantId_status_idx" ON "JobOffer"("jobId", "jobTenantId", "status");

-- CreateIndex
CREATE INDEX "JobOffer_offeredToUserId_offeredToUserTenantId_status_idx" ON "JobOffer"("offeredToUserId", "offeredToUserTenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobOffer_tenantId_tokenHash_key" ON "JobOffer"("tenantId", "tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "JobOffer_id_tenantId_key" ON "JobOffer"("id", "tenantId");

-- CreateIndex
CREATE INDEX "UserAvailabilityBlock_tenantId_idx" ON "UserAvailabilityBlock"("tenantId");

-- CreateIndex
CREATE INDEX "UserAvailabilityBlock_userId_userTenantId_idx" ON "UserAvailabilityBlock"("userId", "userTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAvailabilityBlock_id_tenantId_key" ON "UserAvailabilityBlock"("id", "tenantId");

-- CreateIndex
CREATE INDEX "UserServiceCapability_tenantId_idx" ON "UserServiceCapability"("tenantId");

-- CreateIndex
CREATE INDEX "UserServiceCapability_userId_userTenantId_idx" ON "UserServiceCapability"("userId", "userTenantId");

-- CreateIndex
CREATE INDEX "UserServiceCapability_serviceCategoryId_serviceCategoryTena_idx" ON "UserServiceCapability"("serviceCategoryId", "serviceCategoryTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "UserServiceCapability_tenantId_userId_serviceCategoryId_key" ON "UserServiceCapability"("tenantId", "userId", "serviceCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UserServiceCapability_id_tenantId_key" ON "UserServiceCapability"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_stripePaymentIntentId_idx" ON "Payment"("tenantId", "stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_stripeCheckoutSessionId_idx" ON "Payment"("tenantId", "stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_stripeChargeId_idx" ON "Payment"("tenantId", "stripeChargeId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_stripeRefundId_idx" ON "Payment"("tenantId", "stripeRefundId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_transferId_idx" ON "Payment"("tenantId", "transferId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_idx" ON "Payment"("tenantId");

-- CreateIndex
CREATE INDEX "Payment_jobId_jobTenantId_idx" ON "Payment"("jobId", "jobTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_jobId_key" ON "Payment"("tenantId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_jobId_jobTenantId_key" ON "Payment"("jobId", "jobTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_id_tenantId_key" ON "Payment"("id", "tenantId");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_idx" ON "LedgerEntry"("tenantId");

-- CreateIndex
CREATE INDEX "LedgerEntry_jobId_jobTenantId_idx" ON "LedgerEntry"("jobId", "jobTenantId");

-- CreateIndex
CREATE INDEX "LedgerEntry_paymentId_paymentTenantId_idx" ON "LedgerEntry"("paymentId", "paymentTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_id_tenantId_key" ON "LedgerEntry"("id", "tenantId");

-- CreateIndex
CREATE INDEX "StripeEvent_tenantId_idx" ON "StripeEvent"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeEvent_tenantId_stripeEventId_key" ON "StripeEvent"("tenantId", "stripeEventId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeEvent_id_tenantId_key" ON "StripeEvent"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CommunicationEvent_tenantId_occurredAt_idx" ON "CommunicationEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommunicationEvent_conversationId_conversationTenantId_occu_idx" ON "CommunicationEvent"("conversationId", "conversationTenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommunicationEvent_jobId_jobTenantId_occurredAt_idx" ON "CommunicationEvent"("jobId", "jobTenantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationEvent_id_tenantId_key" ON "CommunicationEvent"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CommunicationContent_tenantId_idx" ON "CommunicationContent"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationContent_tenantId_communicationEventId_key" ON "CommunicationContent"("tenantId", "communicationEventId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationContent_communicationEventId_communicationEven_key" ON "CommunicationContent"("communicationEventId", "communicationEventTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationContent_id_tenantId_key" ON "CommunicationContent"("id", "tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_actorUserTenantId_idx" ON "AuditLog"("actorUserId", "actorUserTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_id_tenantId_key" ON "AuditLog"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Job_tenantId_idx" ON "Job"("tenantId");

-- CreateIndex
CREATE INDEX "Job_tenantId_status_urgency_idx" ON "Job"("tenantId", "status", "urgency");

-- CreateIndex
CREATE INDEX "Job_assignedUserId_assignedUserTenantId_idx" ON "Job"("assignedUserId", "assignedUserTenantId");

-- CreateIndex
CREATE INDEX "Job_customerId_customerTenantId_idx" ON "Job"("customerId", "customerTenantId");

-- CreateIndex
CREATE INDEX "Job_propertyAddressId_propertyAddressTenantId_idx" ON "Job"("propertyAddressId", "propertyAddressTenantId");

-- CreateIndex
CREATE INDEX "Job_serviceCategoryId_serviceCategoryTenantId_idx" ON "Job"("serviceCategoryId", "serviceCategoryTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_id_tenantId_key" ON "Job"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyAddress" ADD CONSTRAINT "PropertyAddress_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyAddress" ADD CONSTRAINT "PropertyAddress_customerId_customerTenantId_fkey" FOREIGN KEY ("customerId", "customerTenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceArea" ADD CONSTRAINT "ServiceArea_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCoverageCheck" ADD CONSTRAINT "CustomerCoverageCheck_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCoverageCheck" ADD CONSTRAINT "CustomerCoverageCheck_propertyAddressId_propertyAddressTen_fkey" FOREIGN KEY ("propertyAddressId", "propertyAddressTenantId") REFERENCES "PropertyAddress"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCoverageCheck" ADD CONSTRAINT "CustomerCoverageCheck_serviceAreaId_serviceAreaTenantId_fkey" FOREIGN KEY ("serviceAreaId", "serviceAreaTenantId") REFERENCES "ServiceArea"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_customerTenantId_fkey" FOREIGN KEY ("customerId", "customerTenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationJobLink" ADD CONSTRAINT "ConversationJobLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationJobLink" ADD CONSTRAINT "ConversationJobLink_conversationId_conversationTenantId_fkey" FOREIGN KEY ("conversationId", "conversationTenantId") REFERENCES "Conversation"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationJobLink" ADD CONSTRAINT "ConversationJobLink_jobId_jobTenantId_fkey" FOREIGN KEY ("jobId", "jobTenantId") REFERENCES "Job"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_customerId_customerTenantId_fkey" FOREIGN KEY ("customerId", "customerTenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_propertyAddressId_propertyAddressTenantId_fkey" FOREIGN KEY ("propertyAddressId", "propertyAddressTenantId") REFERENCES "PropertyAddress"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_serviceCategoryId_serviceCategoryTenantId_fkey" FOREIGN KEY ("serviceCategoryId", "serviceCategoryTenantId") REFERENCES "ServiceCategory"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_assignedUserId_assignedUserTenantId_fkey" FOREIGN KEY ("assignedUserId", "assignedUserTenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_jobId_jobTenantId_fkey" FOREIGN KEY ("jobId", "jobTenantId") REFERENCES "Job"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_offeredToUserId_offeredToUserTenantId_fkey" FOREIGN KEY ("offeredToUserId", "offeredToUserTenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAvailabilityBlock" ADD CONSTRAINT "UserAvailabilityBlock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAvailabilityBlock" ADD CONSTRAINT "UserAvailabilityBlock_userId_userTenantId_fkey" FOREIGN KEY ("userId", "userTenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserServiceCapability" ADD CONSTRAINT "UserServiceCapability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserServiceCapability" ADD CONSTRAINT "UserServiceCapability_userId_userTenantId_fkey" FOREIGN KEY ("userId", "userTenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserServiceCapability" ADD CONSTRAINT "UserServiceCapability_serviceCategoryId_serviceCategoryTen_fkey" FOREIGN KEY ("serviceCategoryId", "serviceCategoryTenantId") REFERENCES "ServiceCategory"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_jobId_jobTenantId_fkey" FOREIGN KEY ("jobId", "jobTenantId") REFERENCES "Job"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_jobId_jobTenantId_fkey" FOREIGN KEY ("jobId", "jobTenantId") REFERENCES "Job"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_paymentId_paymentTenantId_fkey" FOREIGN KEY ("paymentId", "paymentTenantId") REFERENCES "Payment"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeEvent" ADD CONSTRAINT "StripeEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationEvent" ADD CONSTRAINT "CommunicationEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationEvent" ADD CONSTRAINT "CommunicationEvent_conversationId_conversationTenantId_fkey" FOREIGN KEY ("conversationId", "conversationTenantId") REFERENCES "Conversation"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationEvent" ADD CONSTRAINT "CommunicationEvent_jobId_jobTenantId_fkey" FOREIGN KEY ("jobId", "jobTenantId") REFERENCES "Job"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationContent" ADD CONSTRAINT "CommunicationContent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationContent" ADD CONSTRAINT "CommunicationContent_communicationEventId_communicationEve_fkey" FOREIGN KEY ("communicationEventId", "communicationEventTenantId") REFERENCES "CommunicationEvent"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TenantOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_actorUserTenantId_fkey" FOREIGN KEY ("actorUserId", "actorUserTenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
