-- Verification fees.
--
-- A customer pays Saarthi a fixed fee, through the existing Cashfree payment
-- flow, before any billable verification check is sent to a provider. Adds the
-- VERIFICATION_FEE payment purpose, the versioned price list, the per-attempt
-- charge record, and PAN columns for the account holder and the business.
-- Purely additive: no existing row changes.
-- CreateEnum
CREATE TYPE "VerificationCheckType" AS ENUM ('AADHAAR', 'PAN', 'VOTER_ID', 'GST', 'DRIVING_LICENCE', 'VEHICLE_RC');

-- CreateEnum
CREATE TYPE "VerificationChargeStatus" AS ENUM ('PAYMENT_PROCESSING', 'PAYMENT_FAILED', 'PAID', 'VERIFYING', 'VERIFIED', 'FAILED', 'RETRY_REQUIRED');

-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'VERIFICATION_FEE';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "panNumber" TEXT,
ADD COLUMN     "panVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "panNumber" TEXT,
ADD COLUMN     "panVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "verification_prices" (
    "id" UUID NOT NULL,
    "checkType" "VerificationCheckType" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCost" DECIMAL(12,4),
    "providerCostCurrency" TEXT NOT NULL DEFAULT 'USD',
    "customerPrice" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "taxTreatment" TEXT NOT NULL DEFAULT 'INCLUSIVE',
    "pricingVersion" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_charges" (
    "id" UUID NOT NULL,
    "checkType" "VerificationCheckType" NOT NULL,
    "subjectType" "VerificationSubjectType" NOT NULL,
    "subjectId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "status" "VerificationChargeStatus" NOT NULL DEFAULT 'PAYMENT_PROCESSING',
    "paymentReference" TEXT NOT NULL,
    "customerPrice" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "provider" TEXT NOT NULL,
    "providerCost" DECIMAL(12,4),
    "providerCostCurrency" TEXT NOT NULL DEFAULT 'USD',
    "pricingVersion" TEXT NOT NULL,
    "maskedNumber" TEXT,
    "numberHash" TEXT,
    "encryptedRequest" TEXT,
    "providerBilled" BOOLEAN,
    "providerReference" TEXT,
    "resultId" UUID,
    "reason" TEXT,
    "consumedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_prices_checkType_active_idx" ON "verification_prices"("checkType", "active");

-- CreateIndex
CREATE UNIQUE INDEX "verification_prices_checkType_pricingVersion_key" ON "verification_prices"("checkType", "pricingVersion");

-- CreateIndex
CREATE UNIQUE INDEX "verification_charges_paymentReference_key" ON "verification_charges"("paymentReference");

-- CreateIndex
CREATE INDEX "verification_charges_subjectType_subjectId_checkType_create_idx" ON "verification_charges"("subjectType", "subjectId", "checkType", "createdAt");

-- CreateIndex
CREATE INDEX "verification_charges_organizationId_createdAt_idx" ON "verification_charges"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "verification_charges_status_updatedAt_idx" ON "verification_charges"("status", "updatedAt");


-- Seed: pricing version V1.
--
-- Customer price is ₹10 for every check, tax included. Provider cost is the
-- per-call price on Saarthi's Way2API account (USD), kept internal.
INSERT INTO "verification_prices"
  ("id", "checkType", "provider", "providerCost", "providerCostCurrency", "customerPrice", "currency", "taxTreatment", "pricingVersion", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'AADHAAR',         'WAY2API', 0.0215, 'USD', 10.00, 'INR', 'INCLUSIVE', 'V1', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PAN',             'WAY2API', 0.0341, 'USD', 10.00, 'INR', 'INCLUSIVE', 'V1', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'VOTER_ID',        'WAY2API', 0.0215, 'USD', 10.00, 'INR', 'INCLUSIVE', 'V1', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GST',             'WAY2API', 0.0089, 'USD', 10.00, 'INR', 'INCLUSIVE', 'V1', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DRIVING_LICENCE', 'WAY2API', 0.0215, 'USD', 10.00, 'INR', 'INCLUSIVE', 'V1', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'VEHICLE_RC',      'WAY2API', 0.0230, 'USD', 10.00, 'INR', 'INCLUSIVE', 'V1', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
