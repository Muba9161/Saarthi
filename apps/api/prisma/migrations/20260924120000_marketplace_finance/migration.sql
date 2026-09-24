-- Marketplace finance.
--
-- Penny-validated payout accounts, the 30/70 money of fleet-sourced freight
-- orders, Saarthi's 2%-of-profit commission, an idempotent ledger and the
-- settlements routed to providers. Purely additive: no existing row changes.

-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('NOT_CONNECTED', 'PENDING_VERIFICATION', 'VERIFIED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "OrderFinanceStage" AS ENUM ('PAYMENT_30_REQUIRED', 'PAYMENT_30_PAID', 'PROCUREMENT_PAID', 'PAYMENT_70_REQUIRED', 'PAYMENT_70_PAID', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MarketplaceCommissionStatus" AS ENUM ('CALCULATED', 'SETTLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "MarketplaceLedgerType" AS ENUM ('CUSTOMER_PAYMENT', 'PROCUREMENT_PAYMENT', 'COMMISSION', 'PROVIDER_SETTLEMENT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MarketplaceSettlementStatus" AS ENUM ('PENDING', 'REQUESTED', 'SETTLED', 'FAILED');

-- AlterTable
ALTER TABLE "requirement_bids" ADD COLUMN     "procurementReference" DECIMAL(12,2),
ADD COLUMN     "sourceMaterialId" UUID;

-- AlterTable
ALTER TABLE "travel_bookings" ADD COLUMN     "costBreakdown" JSONB,
ADD COLUMN     "costsFinalizedAt" TIMESTAMP(3),
ADD COLUMN     "providerCost" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "payout_accounts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT,
    "nameAtBank" TEXT,
    "status" "BankAccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verificationReference" TEXT,
    "failureReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "vendorId" TEXT,
    "vendorStatus" TEXT,
    "connectedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_finances" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "sellerOrganizationId" UUID NOT NULL,
    "supplierOrganizationId" UUID,
    "customerOrganizationId" UUID NOT NULL,
    "agreedAmount" DECIMAL(12,2) NOT NULL,
    "confirmationAmount" DECIMAL(12,2) NOT NULL,
    "orderedQuantity" DOUBLE PRECISION NOT NULL,
    "deliveredQuantity" DOUBLE PRECISION,
    "finalAmount" DECIMAL(12,2),
    "procurementReference" DECIMAL(12,2),
    "procurementAmount" DECIMAL(12,2),
    "stage" "OrderFinanceStage" NOT NULL DEFAULT 'PAYMENT_30_REQUIRED',
    "deliveryConfirmedAt" TIMESTAMP(3),
    "deliveryNote" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_finances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_commissions" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MARKETPLACE_PROFIT',
    "kind" TEXT NOT NULL,
    "orderId" UUID,
    "bookingId" UUID,
    "providerOrganizationId" UUID NOT NULL,
    "revenueAmount" DECIMAL(12,2) NOT NULL,
    "costAmount" DECIMAL(12,2) NOT NULL,
    "profitBasis" DECIMAL(12,2) NOT NULL,
    "rate" DECIMAL(6,4) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "status" "MarketplaceCommissionStatus" NOT NULL DEFAULT 'CALCULATED',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,

    CONSTRAINT "marketplace_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_ledger_entries" (
    "id" UUID NOT NULL,
    "entryKey" TEXT NOT NULL,
    "type" "MarketplaceLedgerType" NOT NULL,
    "orderId" UUID,
    "bookingId" UUID,
    "organizationId" UUID NOT NULL,
    "counterpartyOrganizationId" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "stage" TEXT,
    "paymentReference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_settlements" (
    "id" UUID NOT NULL,
    "settlementKey" TEXT NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "orderId" UUID,
    "bookingId" UUID,
    "recipientOrganizationId" UUID NOT NULL,
    "vendorId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "MarketplaceSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "providerReference" TEXT,
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_accounts_organizationId_key" ON "payout_accounts"("organizationId");

-- CreateIndex
CREATE INDEX "payout_accounts_status_idx" ON "payout_accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "order_finances_orderId_key" ON "order_finances"("orderId");

-- CreateIndex
CREATE INDEX "order_finances_sellerOrganizationId_stage_idx" ON "order_finances"("sellerOrganizationId", "stage");

-- CreateIndex
CREATE INDEX "order_finances_customerOrganizationId_stage_idx" ON "order_finances"("customerOrganizationId", "stage");

-- CreateIndex
CREATE INDEX "order_finances_supplierOrganizationId_idx" ON "order_finances"("supplierOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_commissions_orderId_key" ON "marketplace_commissions"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_commissions_bookingId_key" ON "marketplace_commissions"("bookingId");

-- CreateIndex
CREATE INDEX "marketplace_commissions_providerOrganizationId_calculatedAt_idx" ON "marketplace_commissions"("providerOrganizationId", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_ledger_entries_entryKey_key" ON "marketplace_ledger_entries"("entryKey");

-- CreateIndex
CREATE INDEX "marketplace_ledger_entries_orderId_createdAt_idx" ON "marketplace_ledger_entries"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "marketplace_ledger_entries_bookingId_createdAt_idx" ON "marketplace_ledger_entries"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "marketplace_ledger_entries_organizationId_createdAt_idx" ON "marketplace_ledger_entries"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_settlements_settlementKey_key" ON "marketplace_settlements"("settlementKey");

-- CreateIndex
CREATE INDEX "marketplace_settlements_status_updatedAt_idx" ON "marketplace_settlements"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "marketplace_settlements_recipientOrganizationId_createdAt_idx" ON "marketplace_settlements"("recipientOrganizationId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_finances" ADD CONSTRAINT "order_finances_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

