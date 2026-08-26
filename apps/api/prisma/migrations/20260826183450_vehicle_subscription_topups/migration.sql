-- CreateEnum
CREATE TYPE "TopUpStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED', 'PAYMENT_FAILED');

-- CreateTable
CREATE TABLE "vehicle_subscription_topups" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "TopUpStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "priceMonthly" DECIMAL(10,2) NOT NULL,
    "paymentReference" TEXT,
    "purchasedById" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_subscription_topups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_subscription_topups_organizationId_status_idx" ON "vehicle_subscription_topups"("organizationId", "status");

-- CreateIndex
CREATE INDEX "vehicle_subscription_topups_status_expiresAt_idx" ON "vehicle_subscription_topups"("status", "expiresAt");
