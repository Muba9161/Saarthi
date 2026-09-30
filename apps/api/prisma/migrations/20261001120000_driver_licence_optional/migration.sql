-- A driver may register without a driving licence number ("I'll do it later")
-- and add it afterwards from the app (`PUT /api/v1/drivers/me/licence`).
--
-- Existing rows all carry a licence and are untouched. The
-- "drivers_organizationId_licenseNumber_key" unique index stays as it is:
-- PostgreSQL treats NULLs as distinct, so any number of drivers in one fleet
-- may be waiting to add theirs while two recorded licences still cannot clash.

-- AlterTable
ALTER TABLE "drivers" ALTER COLUMN "licenseNumber" DROP NOT NULL;
