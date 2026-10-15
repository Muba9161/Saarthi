-- The paid full RC record: RC Details Advanced, merged with Lite. Priced at ₹20
-- by Sir's decision of 2026-10-15. providerCost is left NULL: Way2API's price
-- for Advanced (plus the Lite call it may need) is not recorded here yet.
INSERT INTO "verification_prices"
  ("id", "checkType", "provider", "providerCost", "providerCostCurrency", "customerPrice", "currency", "taxTreatment", "pricingVersion", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'VEHICLE_RC_DETAILS', 'WAY2API', NULL, 'USD', 20.00, 'INR', 'INCLUSIVE', 'V1', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
