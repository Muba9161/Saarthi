-- CreateEnum
CREATE TYPE "LoanType" AS ENUM ('TERM_LOAN', 'HYPOTHECATION', 'LEASE', 'HIRE_PURCHASE', 'REFINANCE', 'TOP_UP', 'WORKING_CAPITAL', 'OTHER');

-- CreateEnum
CREATE TYPE "InterestType" AS ENUM ('FLAT', 'REDUCING_BALANCE', 'FLOATING');

-- CreateEnum
CREATE TYPE "EmiFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ON_HOLD', 'CLOSED', 'FORECLOSED', 'DEFAULTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('UPCOMING', 'DUE_SOON', 'DUE_TODAY', 'PAID', 'OVERDUE', 'PARTIALLY_PAID', 'WAIVED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FinanceDataSource" AS ENUM ('MANUAL', 'IMPORT', 'PROVIDER_SYNC', 'DOCUMENT_EXTRACTION', 'CALCULATED', 'SIMULATED');

-- CreateEnum
CREATE TYPE "FinanceVerificationStatus" AS ENUM ('UNVERIFIED', 'PROVIDER_REPORTED', 'PENDING_REVIEW', 'VERIFIED', 'CONFLICT', 'REJECTED');

-- CreateEnum
CREATE TYPE "LoanPaymentMethod" AS ENUM ('AUTO_DEBIT', 'NACH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CASH', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "LoanPaymentKind" AS ENUM ('INSTALLMENT', 'PART_PREPAYMENT', 'FORECLOSURE', 'PENALTY', 'CHARGES');

-- CreateEnum
CREATE TYPE "LoanEventType" AS ENUM ('CREATED', 'UPDATED', 'SCHEDULE_GENERATED', 'SCHEDULE_REGENERATED', 'PAYMENT_RECORDED', 'PAYMENT_REVERSED', 'INSTALLMENT_WAIVED', 'REMINDER_SENT', 'MARKED_OVERDUE', 'PROVIDER_SYNCED', 'PROVIDER_SYNC_FAILED', 'CONFLICT_RAISED', 'CONFLICT_RESOLVED', 'STATUS_CHANGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "LoanReminderKind" AS ENUM ('ADVANCE', 'IMMINENT', 'OVERDUE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'LOAN_EMI_DUE_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'LOAN_EMI_DUE_TODAY';
ALTER TYPE "NotificationType" ADD VALUE 'LOAN_EMI_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'LOAN_PAYMENT_RECORDED';
ALTER TYPE "NotificationType" ADD VALUE 'LOAN_CLOSED';
ALTER TYPE "NotificationType" ADD VALUE 'LOAN_SYNC_CONFLICT';

-- CreateTable
CREATE TABLE "vehicle_loans" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "loanNumber" TEXT NOT NULL,
    "lenderName" TEXT NOT NULL,
    "lenderBranch" TEXT,
    "borrowerName" TEXT,
    "loanType" "LoanType" NOT NULL DEFAULT 'TERM_LOAN',
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "principal" DECIMAL(14,2) NOT NULL,
    "disbursedAmount" DECIMAL(14,2),
    "annualRatePercent" DECIMAL(6,3) NOT NULL,
    "interestType" "InterestType" NOT NULL DEFAULT 'REDUCING_BALANCE',
    "tenureMonths" INTEGER NOT NULL,
    "frequency" "EmiFrequency" NOT NULL DEFAULT 'MONTHLY',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "firstDueDate" DATE NOT NULL,
    "emiAmount" DECIMAL(14,2) NOT NULL,
    "emiFromLender" BOOLEAN NOT NULL DEFAULT false,
    "autoDebitDay" INTEGER,
    "mandateReference" TEXT,
    "accountNumber" TEXT,
    "reminderOffsets" INTEGER[],
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "source" "FinanceDataSource" NOT NULL DEFAULT 'MANUAL',
    "verificationStatus" "FinanceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "providerName" TEXT,
    "providerReference" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "notes" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_installments" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "interest" DECIMAL(14,2) NOT NULL,
    "totalDue" DECIMAL(14,2) NOT NULL,
    "openingBalance" DECIMAL(14,2),
    "closingBalance" DECIMAL(14,2),
    "status" "InstallmentStatus" NOT NULL DEFAULT 'UPCOMING',
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "penaltyPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedById" UUID,
    "waiveReason" TEXT,
    "source" "FinanceDataSource" NOT NULL DEFAULT 'CALCULATED',
    "verificationStatus" "FinanceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "conflictNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_payments" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "installmentId" UUID,
    "organizationId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "penalty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "kind" "LoanPaymentKind" NOT NULL DEFAULT 'INSTALLMENT',
    "method" "LoanPaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "source" "FinanceDataSource" NOT NULL DEFAULT 'MANUAL',
    "verificationStatus" "FinanceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "reversedAt" TIMESTAMP(3),
    "reversedById" UUID,
    "reverseReason" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_events" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "eventType" "LoanEventType" NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_reminders" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "installmentId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "LoanReminderKind" NOT NULL,
    "dueDate" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_loans_organizationId_status_idx" ON "vehicle_loans"("organizationId", "status");

-- CreateIndex
CREATE INDEX "vehicle_loans_vehicleId_status_idx" ON "vehicle_loans"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "vehicle_loans_organizationId_lenderName_idx" ON "vehicle_loans"("organizationId", "lenderName");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_loans_organizationId_loanNumber_key" ON "vehicle_loans"("organizationId", "loanNumber");

-- CreateIndex
CREATE INDEX "loan_installments_organizationId_status_dueDate_idx" ON "loan_installments"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "loan_installments_loanId_dueDate_idx" ON "loan_installments"("loanId", "dueDate");

-- CreateIndex
CREATE INDEX "loan_installments_dueDate_status_idx" ON "loan_installments"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "loan_installments_loanId_number_key" ON "loan_installments"("loanId", "number");

-- CreateIndex
CREATE INDEX "loan_payments_loanId_paidAt_idx" ON "loan_payments"("loanId", "paidAt");

-- CreateIndex
CREATE INDEX "loan_payments_organizationId_paidAt_idx" ON "loan_payments"("organizationId", "paidAt");

-- CreateIndex
CREATE INDEX "loan_payments_installmentId_idx" ON "loan_payments"("installmentId");

-- CreateIndex
CREATE INDEX "loan_events_loanId_createdAt_idx" ON "loan_events"("loanId", "createdAt");

-- CreateIndex
CREATE INDEX "loan_events_organizationId_createdAt_idx" ON "loan_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "loan_reminders_organizationId_sentAt_idx" ON "loan_reminders"("organizationId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "loan_reminders_installmentId_kind_key" ON "loan_reminders"("installmentId", "kind");

-- AddForeignKey
ALTER TABLE "vehicle_loans" ADD CONSTRAINT "vehicle_loans_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "vehicle_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "vehicle_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "loan_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_events" ADD CONSTRAINT "loan_events_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "vehicle_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_reminders" ADD CONSTRAINT "loan_reminders_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "vehicle_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
