-- Final plan pricing.
--
-- 1. Suppliers move onto the Supplier plan. The plan row is created here if
--    the seed has not run yet; `npm run db:seed` then syncs its name, price
--    and features from the shared catalogue exactly as for the other plans.
INSERT INTO "subscription_plans" ("id", "tier", "name", "description", "priceMonthly", "active", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), 'SUPPLIER', 'Saarthi Supplier',
       'For material suppliers. Catalogue, stock, requirements and orders — no vehicle or fleet setup needed.',
       179, true, 2, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "subscription_plans" WHERE "tier" = 'SUPPLIER');

UPDATE "subscriptions" AS s
   SET "planId" = (SELECT "id" FROM "subscription_plans" WHERE "tier" = 'SUPPLIER'),
       "updatedAt" = CURRENT_TIMESTAMP
  FROM "organizations" AS o
 WHERE o."id" = s."organizationId"
   AND o."type" = 'SUPPLIER';

-- 2. Billing is monthly only. Yearly subscriptions renew monthly from now on;
--    the enum value is kept so historical rows and audit entries stay valid.
UPDATE "subscriptions"
   SET "billingPeriod" = 'MONTHLY', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "billingPeriod" = 'YEARLY';

UPDATE "subscription_plans" SET "priceYearly" = NULL WHERE "priceYearly" IS NOT NULL;
