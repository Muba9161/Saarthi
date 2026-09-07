-- CreateEnum
CREATE TYPE "IdentityDocumentKind" AS ENUM ('AADHAAR', 'PAN', 'VOTER_ID', 'GST');

-- CreateEnum
CREATE TYPE "IdentityVerificationOutcome" AS ENUM ('VERIFIED', 'NOT_FOUND', 'MISMATCH', 'INVALID_FORMAT', 'UNCONFIRMED');

-- AlterTable
-- Every column is nullable with no default, so existing driver rows are
-- untouched and no backfill is needed.
ALTER TABLE "drivers"
  ADD COLUMN "aadhaarLast4" TEXT,
  ADD COLUMN "aadhaarVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "panNumber" TEXT,
  ADD COLUMN "panVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "voterIdNumber" TEXT,
  ADD COLUMN "voterIdVerifiedAt" TIMESTAMP(3);

-- AlterTable
-- `taxNumber` is deliberately left in place: it is free text captured at
-- registration and is not the same fact as a verified GSTIN.
ALTER TABLE "organizations"
  ADD COLUMN "gstin" TEXT,
  ADD COLUMN "gstLegalName" TEXT,
  ADD COLUMN "gstTradeName" TEXT,
  ADD COLUMN "gstStatus" TEXT,
  ADD COLUMN "gstVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "identity_verifications" (
    "id" UUID NOT NULL,
    "kind" "IdentityDocumentKind" NOT NULL,
    "subjectType" "VerificationSubjectType" NOT NULL,
    "subjectId" UUID NOT NULL,
    "organizationId" UUID,
    "documentId" UUID,
    "numberHash" TEXT NOT NULL,
    "maskedNumber" TEXT NOT NULL,
    "encryptedNumber" TEXT,
    "outcome" "IdentityVerificationOutcome" NOT NULL,
    "reason" TEXT,
    "holderName" TEXT,
    "provider" TEXT,
    "providerReference" TEXT,
    "responseData" JSONB,
    "requestedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drivers_panNumber_idx" ON "drivers"("panNumber");

-- CreateIndex
CREATE INDEX "organizations_gstin_idx" ON "organizations"("gstin");

-- CreateIndex
CREATE UNIQUE INDEX "identity_verifications_subjectType_subjectId_kind_key" ON "identity_verifications"("subjectType", "subjectId", "kind");

-- CreateIndex
CREATE INDEX "identity_verifications_numberHash_kind_idx" ON "identity_verifications"("numberHash", "kind");

-- CreateIndex
CREATE INDEX "identity_verifications_organizationId_kind_idx" ON "identity_verifications"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "identity_verifications_documentId_idx" ON "identity_verifications"("documentId");

-- CreateIndex
CREATE INDEX "identity_verifications_checkedAt_idx" ON "identity_verifications"("checkedAt");
