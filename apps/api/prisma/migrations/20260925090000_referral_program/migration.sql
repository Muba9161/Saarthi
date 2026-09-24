-- Refer & Earn — the generic referral program.
--
-- One Saarthi user bringing another. Separate from the salesman/GODID tables:
-- its own codes and its own referral rows, and no commission. The reward rule
-- is not decided yet, so a qualified referral records only the payment it
-- qualified on. Purely additive: no existing row changes.

-- CreateEnum
CREATE TYPE "UserReferralStatus" AS ENUM ('SIGNED_UP', 'QUALIFIED');

-- CreateTable
CREATE TABLE "referral_program_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_program_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_referrals" (
    "id" UUID NOT NULL,
    "referrerUserId" UUID NOT NULL,
    "referredUserId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "UserReferralStatus" NOT NULL DEFAULT 'SIGNED_UP',
    "signedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualifiedAt" TIMESTAMP(3),
    "qualifyingPaymentReference" TEXT,
    "qualifyingAmount" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_program_codes_userId_key" ON "referral_program_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_program_codes_code_key" ON "referral_program_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "user_referrals_referredUserId_key" ON "user_referrals"("referredUserId");

-- CreateIndex
CREATE UNIQUE INDEX "user_referrals_organizationId_key" ON "user_referrals"("organizationId");

-- CreateIndex
CREATE INDEX "user_referrals_referrerUserId_status_idx" ON "user_referrals"("referrerUserId", "status");

-- AddForeignKey
ALTER TABLE "referral_program_codes" ADD CONSTRAINT "referral_program_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_referrals" ADD CONSTRAINT "user_referrals_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_referrals" ADD CONSTRAINT "user_referrals_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_referrals" ADD CONSTRAINT "user_referrals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
