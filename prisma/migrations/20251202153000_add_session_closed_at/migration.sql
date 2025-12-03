-- Add sessionClosedAt column to track session lifecycle without deleting logs
ALTER TABLE "CallLog"
ADD COLUMN "sessionClosedAt" TIMESTAMP(3);
