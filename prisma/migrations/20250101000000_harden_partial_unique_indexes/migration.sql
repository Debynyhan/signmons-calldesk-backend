-- USER phone uniqueness only when phone is present
CREATE UNIQUE INDEX IF NOT EXISTS "User_tenant_phone_unique_not_null"
ON "User" ("tenantId", "phone")
WHERE "phone" IS NOT NULL;

-- PAYMENT Stripe identifiers uniqueness only when present
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_tenant_pi_unique_not_null"
ON "Payment" ("tenantId", "stripePaymentIntentId")
WHERE "stripePaymentIntentId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_tenant_cs_unique_not_null"
ON "Payment" ("tenantId", "stripeCheckoutSessionId")
WHERE "stripeCheckoutSessionId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_tenant_charge_unique_not_null"
ON "Payment" ("tenantId", "stripeChargeId")
WHERE "stripeChargeId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_tenant_refund_unique_not_null"
ON "Payment" ("tenantId", "stripeRefundId")
WHERE "stripeRefundId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_tenant_transfer_unique_not_null"
ON "Payment" ("tenantId", "transferId")
WHERE "transferId" IS NOT NULL;

-- transferGroup should be NON-UNIQUE (it is a grouping key)
-- 1) drop the old UNIQUE index if it exists
DROP INDEX IF EXISTS "Payment_tenant_transfer_group_unique_not_null";

-- 2) create a NON-UNIQUE partial index for lookup speed
CREATE INDEX IF NOT EXISTS "Payment_tenant_transfer_group_idx_not_null"
ON "Payment" ("tenantId", "transferGroup")
WHERE "transferGroup" IS NOT NULL;
