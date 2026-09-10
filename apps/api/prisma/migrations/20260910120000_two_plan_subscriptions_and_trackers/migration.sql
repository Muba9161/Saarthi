-- Two subscriptions (Personal, Business) and the one-time tracker add-on.
--
-- The four sold tiers collapse to two. Existing rows are mapped rather than
-- dropped, so no tenant loses their subscription over a pricing change:
--
--   BASIC                            -> PERSONAL   (a single-vehicle account)
--   PRO / INTELLIGENCE / ENTERPRISE  -> BUSINESS   (a commercial account)
--
-- Mapping upward is deliberate. A fleet that paid for Intelligence must not
-- wake up with fewer capabilities than it had yesterday, and BUSINESS is the
-- only tier that still carries the commercial surface those plans included.
-- BASIC maps down to PERSONAL because that is the same product: one vehicle,
-- own-use features, no marketplace.

-- ---------------------------------------------------------------------------
-- PlanTier: BASIC/PRO/INTELLIGENCE/ENTERPRISE -> PERSONAL/BUSINESS
-- ---------------------------------------------------------------------------

CREATE TYPE "PlanTier_new" AS ENUM ('PERSONAL', 'BUSINESS');

-- `subscription_plans.tier` is UNIQUE, and PRO, INTELLIGENCE and ENTERPRISE
-- all map to BUSINESS. Collapsing them in place would violate that constraint,
-- so the subscriptions pointing at the retired plan rows are re-pointed first
-- and the retired rows are then deleted.
--
-- The surviving BUSINESS plan is whichever of the three the tenants were
-- mostly on; PRO is preferred because it is the default a new organization was
-- put on. `plan_features` follows its plan row via ON DELETE CASCADE, and is
-- re-seeded from the shared catalogue on the next `db:seed` regardless.
DO $$
DECLARE
  business_plan_id UUID;
  personal_plan_id UUID;
BEGIN
  SELECT id INTO business_plan_id
  FROM "subscription_plans"
  WHERE tier IN ('PRO', 'INTELLIGENCE', 'ENTERPRISE')
  ORDER BY CASE tier
    WHEN 'PRO' THEN 0
    WHEN 'INTELLIGENCE' THEN 1
    ELSE 2
  END
  LIMIT 1;

  SELECT id INTO personal_plan_id FROM "subscription_plans" WHERE tier = 'BASIC';

  IF business_plan_id IS NOT NULL THEN
    UPDATE "subscriptions"
    SET "planId" = business_plan_id
    WHERE "planId" IN (
      SELECT id FROM "subscription_plans"
      WHERE tier IN ('PRO', 'INTELLIGENCE', 'ENTERPRISE') AND id <> business_plan_id
    );

    DELETE FROM "subscription_plans"
    WHERE tier IN ('PRO', 'INTELLIGENCE', 'ENTERPRISE') AND id <> business_plan_id;
  END IF;

  -- A deployment with no BASIC plan row but subscriptions on one is not
  -- possible (the foreign key forbids it), so nothing to re-point here.
  PERFORM personal_plan_id;
END $$;

ALTER TABLE "subscription_plans"
  ALTER COLUMN "tier" TYPE "PlanTier_new"
  USING (
    CASE "tier"::text
      WHEN 'BASIC' THEN 'PERSONAL'
      ELSE 'BUSINESS'
    END
  )::"PlanTier_new";

DROP TYPE "PlanTier";
ALTER TYPE "PlanTier_new" RENAME TO "PlanTier";

-- ---------------------------------------------------------------------------
-- Billing period on the subscription
-- ---------------------------------------------------------------------------

CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'YEARLY');

ALTER TABLE "subscriptions"
  ADD COLUMN "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY';

-- ---------------------------------------------------------------------------
-- The tracker add-on
-- ---------------------------------------------------------------------------

CREATE TYPE "TrackerStatus" AS ENUM ('ACTIVE', 'RETIRED', 'PAYMENT_FAILED', 'REFUNDED');

CREATE TABLE "vehicle_trackers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "TrackerStatus" NOT NULL DEFAULT 'ACTIVE',
    "truckId" UUID,
    "pricePaid" DECIMAL(10,2) NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "purchasedById" UUID,
    "serialNumber" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_trackers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vehicle_trackers_organizationId_status_idx"
  ON "vehicle_trackers"("organizationId", "status");

CREATE INDEX "vehicle_trackers_truckId_idx" ON "vehicle_trackers"("truckId");

-- ---------------------------------------------------------------------------
-- Top-up price
-- ---------------------------------------------------------------------------
--
-- Existing rows keep the price they were charged: `priceMonthly` is per-row
-- precisely so a price change does not rewrite history. Only new purchases
-- take the new ₹75 figure, which lives in the shared catalogue.
