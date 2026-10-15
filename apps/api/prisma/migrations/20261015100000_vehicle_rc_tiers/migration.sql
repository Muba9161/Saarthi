-- AlterEnum
-- Kept apart from the price row in the next migration: Postgres will not use a
-- new enum value inside the transaction that adds it.
ALTER TYPE "VerificationCheckType" ADD VALUE 'VEHICLE_RC_DETAILS';

-- CreateEnum
CREATE TYPE "VehicleRcService" AS ENUM ('LITE', 'TEXT_PDF', 'ADVANCED');

-- AlterTable
ALTER TABLE "vehicle_lookups" ADD COLUMN "service" "VehicleRcService" NOT NULL DEFAULT 'TEXT_PDF';

-- Backfill. Every lookup used Text + PDF until 2026-10-07, when RC Details Lite
-- became its fallback; Lite produces no certificate, so a record stored without
-- one is taken to be Lite's.
UPDATE "vehicle_lookups" SET "service" = 'LITE' WHERE "pdfStorageKey" IS NULL;
