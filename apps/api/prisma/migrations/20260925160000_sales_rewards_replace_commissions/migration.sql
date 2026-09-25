-- Salesperson rewards replace commissions.
--
-- Business decision: every successful referral earns a flat reward paid into
-- the Saarthi wallet, for salespeople as for Refer & Earn. Commission rules,
-- per-sale commission rows and their approval workflow are removed.
--
-- DESTRUCTIVE: drops `commissions` and `commission_rules`. Export any rows you
-- need to keep before applying this to a database that has them.

-- DropForeignKey
ALTER TABLE "commissions" DROP CONSTRAINT "commissions_attributionId_fkey";

-- DropForeignKey
ALTER TABLE "commissions" DROP CONSTRAINT "commissions_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "commissions" DROP CONSTRAINT "commissions_ruleId_fkey";

-- DropForeignKey
ALTER TABLE "commissions" DROP CONSTRAINT "commissions_salesmanId_fkey";

-- AlterTable
ALTER TABLE "wallet_entries" ADD COLUMN     "referralAttributionId" UUID,
ADD COLUMN     "referredOrganizationId" UUID;

-- DropTable
DROP TABLE "commission_rules";

-- DropTable
DROP TABLE "commissions";

-- DropEnum
DROP TYPE "CommissionStatus";

-- DropEnum
DROP TYPE "CommissionTrigger";

-- DropEnum
DROP TYPE "CommissionType";

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_referralAttributionId_key" ON "wallet_entries"("referralAttributionId");

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_referralAttributionId_fkey" FOREIGN KEY ("referralAttributionId") REFERENCES "referral_attributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: Refer & Earn rewards already credited record which organization
-- they were for, which is what a held reward's release is now checked against.
UPDATE "wallet_entries" AS e
SET "referredOrganizationId" = ur."organizationId"
FROM "user_referrals" AS ur
WHERE e."userReferralId" = ur."id" AND e."referredOrganizationId" IS NULL;
