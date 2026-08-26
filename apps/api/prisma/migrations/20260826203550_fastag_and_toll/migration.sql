-- CreateEnum
CREATE TYPE "FastagStatus" AS ENUM ('ACTIVE', 'LOW_BALANCE', 'BLACKLISTED', 'EXCEPTION', 'HOTLISTED', 'CLOSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TollDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TollDataSource" AS ENUM ('MANUAL', 'IMPORT', 'PROVIDER_SYNC', 'DOCUMENT_EXTRACTION', 'SIMULATED');

-- CreateEnum
CREATE TYPE "TollPaymentMode" AS ENUM ('FASTAG', 'CASH', 'UPI', 'CARD', 'EXEMPT', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'FASTAG_LOW_BALANCE';
ALTER TYPE "NotificationType" ADD VALUE 'FASTAG_BLACKLISTED';
ALTER TYPE "NotificationType" ADD VALUE 'TOLL_SYNC_CONFLICT';

-- CreateTable
CREATE TABLE "fastag_accounts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "tagId" TEXT NOT NULL,
    "issuerBank" TEXT NOT NULL,
    "issuerCode" TEXT,
    "vehicleClass" TEXT,
    "status" "FastagStatus" NOT NULL DEFAULT 'UNKNOWN',
    "balance" DECIMAL(12,2),
    "balanceUpdatedAt" TIMESTAMP(3),
    "lowBalanceThreshold" DECIMAL(12,2),
    "linkedAccountRef" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "source" "TollDataSource" NOT NULL DEFAULT 'MANUAL',
    "providerName" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fastag_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toll_transactions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "fastagId" UUID,
    "tripId" UUID,
    "driverId" UUID,
    "plazaName" TEXT NOT NULL,
    "plazaCode" TEXT,
    "laneId" TEXT,
    "highway" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "direction" "TollDirection" NOT NULL DEFAULT 'UNKNOWN',
    "paymentMode" "TollPaymentMode" NOT NULL DEFAULT 'FASTAG',
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2),
    "crossedAt" TIMESTAMP(3) NOT NULL,
    "externalReference" TEXT,
    "source" "TollDataSource" NOT NULL DEFAULT 'MANUAL',
    "verificationStatus" "FinanceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "conflictNote" TEXT,
    "notes" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "toll_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fastag_accounts_organizationId_status_idx" ON "fastag_accounts"("organizationId", "status");

-- CreateIndex
CREATE INDEX "fastag_accounts_vehicleId_closedAt_idx" ON "fastag_accounts"("vehicleId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "fastag_accounts_organizationId_tagId_key" ON "fastag_accounts"("organizationId", "tagId");

-- CreateIndex
CREATE INDEX "toll_transactions_organizationId_crossedAt_idx" ON "toll_transactions"("organizationId", "crossedAt");

-- CreateIndex
CREATE INDEX "toll_transactions_vehicleId_crossedAt_idx" ON "toll_transactions"("vehicleId", "crossedAt");

-- CreateIndex
CREATE INDEX "toll_transactions_tripId_idx" ON "toll_transactions"("tripId");

-- CreateIndex
CREATE INDEX "toll_transactions_fastagId_crossedAt_idx" ON "toll_transactions"("fastagId", "crossedAt");

-- CreateIndex
CREATE UNIQUE INDEX "toll_transactions_organizationId_externalReference_key" ON "toll_transactions"("organizationId", "externalReference");

-- AddForeignKey
ALTER TABLE "fastag_accounts" ADD CONSTRAINT "fastag_accounts_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toll_transactions" ADD CONSTRAINT "toll_transactions_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toll_transactions" ADD CONSTRAINT "toll_transactions_fastagId_fkey" FOREIGN KEY ("fastagId") REFERENCES "fastag_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
