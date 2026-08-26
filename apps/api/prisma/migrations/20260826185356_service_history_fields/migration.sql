-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('ROUTINE', 'ENGINE', 'TRANSMISSION', 'BRAKES', 'SUSPENSION', 'STEERING', 'TYRES', 'ELECTRICAL', 'BODY', 'HVAC', 'FUEL_SYSTEM', 'COOLING', 'EXHAUST', 'CHASSIS', 'ACCIDENT_REPAIR', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceDataSource" AS ENUM ('MANUAL', 'IMPORT', 'PROVIDER_SYNC', 'DOCUMENT_EXTRACTION', 'TELEMETRY_DERIVED', 'SIMULATED');

-- CreateEnum
CREATE TYPE "ServiceVerificationStatus" AS ENUM ('UNVERIFIED', 'PROVIDER_REPORTED', 'PENDING_REVIEW', 'VERIFIED', 'CONFLICT', 'REJECTED');

-- AlterTable
ALTER TABLE "maintenance_records" ADD COLUMN     "category" "ServiceCategory",
ADD COLUMN     "conflictNote" TEXT,
ADD COLUMN     "diagnosticCodes" TEXT[],
ADD COLUMN     "engineHours" DOUBLE PRECISION,
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "labourCost" DECIMAL(12,2),
ADD COLUMN     "mechanicName" TEXT,
ADD COLUMN     "parts" JSONB,
ADD COLUMN     "partsCost" DECIMAL(12,2),
ADD COLUMN     "providerName" TEXT,
ADD COLUMN     "providerReference" TEXT,
ADD COLUMN     "replacedComponents" TEXT[],
ADD COLUMN     "retrievedAt" TIMESTAMP(3),
ADD COLUMN     "source" "ServiceDataSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "taxAmount" DECIMAL(12,2),
ADD COLUMN     "verificationStatus" "ServiceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "warrantyUntil" TIMESTAMP(3),
ADD COLUMN     "workshopAddress" TEXT,
ADD COLUMN     "workshopName" TEXT,
ADD COLUMN     "workshopPhone" TEXT;

-- CreateIndex
CREATE INDEX "maintenance_records_truckId_completedAt_idx" ON "maintenance_records"("truckId", "completedAt");

-- CreateIndex
CREATE INDEX "maintenance_records_organizationId_verificationStatus_idx" ON "maintenance_records"("organizationId", "verificationStatus");
