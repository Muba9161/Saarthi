-- Saarthi wallet — Refer & Earn rewards and cash-out.
--
-- A ledger of wallet entries (rewards, cash-out debits and reversals), the one
-- penny-validated bank account each person cashes out to, and the cash-outs
-- themselves. Purely additive: no existing row changes.

-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('REFERRAL_REWARD', 'CASHOUT', 'CASHOUT_REVERSAL');

-- CreateEnum
CREATE TYPE "WalletEntryStatus" AS ENUM ('HELD', 'AVAILABLE', 'VOID');

-- CreateEnum
CREATE TYPE "WalletCashoutStatus" AS ENUM ('PROCESSING', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "status" "WalletEntryStatus" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "entryKey" TEXT NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "userReferralId" UUID,
    "cashoutId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_bank_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT,
    "nameAtBank" TEXT,
    "accountFingerprint" TEXT NOT NULL,
    "status" "BankAccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verificationReference" TEXT,
    "failureReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "beneficiaryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_cashouts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "WalletCashoutStatus" NOT NULL DEFAULT 'PROCESSING',
    "transferId" TEXT NOT NULL,
    "providerReference" TEXT,
    "failureReason" TEXT,
    "accountLast4" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_cashouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_entryKey_key" ON "wallet_entries"("entryKey");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_userReferralId_key" ON "wallet_entries"("userReferralId");

-- CreateIndex
CREATE INDEX "wallet_entries_userId_status_idx" ON "wallet_entries"("userId", "status");

-- CreateIndex
CREATE INDEX "wallet_entries_status_availableAt_idx" ON "wallet_entries"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_bank_accounts_userId_key" ON "wallet_bank_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_bank_accounts_accountFingerprint_key" ON "wallet_bank_accounts"("accountFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_cashouts_transferId_key" ON "wallet_cashouts"("transferId");

-- CreateIndex
CREATE INDEX "wallet_cashouts_userId_requestedAt_idx" ON "wallet_cashouts"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "wallet_cashouts_status_requestedAt_idx" ON "wallet_cashouts"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_userReferralId_fkey" FOREIGN KEY ("userReferralId") REFERENCES "user_referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_cashoutId_fkey" FOREIGN KEY ("cashoutId") REFERENCES "wallet_cashouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_bank_accounts" ADD CONSTRAINT "wallet_bank_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_cashouts" ADD CONSTRAINT "wallet_cashouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

