-- Subscription coupons: the coupon in force on each subscription.

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "couponCode" TEXT,
ADD COLUMN "couponPercentOff" INTEGER,
ADD COLUMN "couponMonthsLeft" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "couponFreeUntil" TIMESTAMP(3);
