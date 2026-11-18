-- When a coupon was last entered: coupons stay locked for three months after.

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "couponAppliedAt" TIMESTAMP(3);
