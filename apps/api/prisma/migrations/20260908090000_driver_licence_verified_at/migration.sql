-- AlterTable
--
-- When the licensing authority last confirmed this driver's licence.
--
-- Joins the three identity timestamps already on the row so that all four
-- checks a driver must pass — licence, Aadhaar, PAN and Voter ID — are asked
-- the same way and read from the same place.
--
-- Nullable with no default, so every existing driver row is untouched and no
-- backfill runs. An existing driver already marked VERIFIED keeps that status;
-- it is only re-evaluated the next time one of their four checks is run, which
-- is deliberate — this migration must not un-verify a working fleet overnight.
ALTER TABLE "drivers"
  ADD COLUMN "licenceVerifiedAt" TIMESTAMP(3);
