-- Handover codes: the customer's 4-digit code the driver enters to finish a
-- delivery or start a ride, with the fleet owner's written override when the
-- customer cannot give it.

-- CreateEnum
CREATE TYPE "HandoverPurpose" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateTable
CREATE TABLE "handover_codes" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "purpose" "HandoverPurpose" NOT NULL,
    "orderId" UUID,
    "bookingId" UUID,
    "customerOrganizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" UUID,
    "overriddenAt" TIMESTAMP(3),
    "overriddenByUserId" UUID,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handover_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "handover_codes_tripId_purpose_key" ON "handover_codes"("tripId", "purpose");

-- CreateIndex
CREATE INDEX "handover_codes_orderId_idx" ON "handover_codes"("orderId");

-- CreateIndex
CREATE INDEX "handover_codes_bookingId_idx" ON "handover_codes"("bookingId");

-- AddForeignKey
ALTER TABLE "handover_codes" ADD CONSTRAINT "handover_codes_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
