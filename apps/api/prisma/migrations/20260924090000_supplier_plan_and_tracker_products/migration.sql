-- The Supplier plan and the two tracker products.
--
-- A materials supplier was sold the Business plan, which is priced for an
-- account that runs vehicles. `SUPPLIER` is its own commercial plan: no
-- vehicle, no fleet setup, no telemetry. See `PlanTier` in @saarthi/shared.
--
-- Added in its own migration because a new enum value cannot be used in the
-- transaction that creates it; the data that uses it follows in
-- `20260924090100_final_plan_pricing`.
ALTER TYPE "PlanTier" ADD VALUE IF NOT EXISTS 'SUPPLIER' BEFORE 'BUSINESS';

-- Trackers are now sold as two products. Every existing row predates the
-- split and is recorded as the Bluetooth OBD unit; `pricePaid` on each row
-- still says what was actually charged.
CREATE TYPE "TrackerProduct" AS ENUM ('OBD_BLUETOOTH', 'CONNECTED_4G');

ALTER TABLE "vehicle_trackers"
  ADD COLUMN "product" "TrackerProduct" NOT NULL DEFAULT 'OBD_BLUETOOTH';
