-- Backhaul — the owner's consent to the backhaul commission, and the bids and
-- quotes placed on a vehicle's return leg.

-- AlterTable
ALTER TABLE "return_load_requests" ADD COLUMN     "commissionRate" DECIMAL(6,4),
ADD COLUMN     "commissionRuleVersion" TEXT,
ADD COLUMN     "commissionAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "commissionAcceptedBy" UUID;

-- AlterTable
ALTER TABLE "requirement_bids" ADD COLUMN     "returnLoadRequestId" UUID;

-- AlterTable
ALTER TABLE "order_quotes" ADD COLUMN     "returnLoadRequestId" UUID;

-- CreateIndex
CREATE INDEX "return_load_requests_outboundTripId_idx" ON "return_load_requests"("outboundTripId");

-- CreateIndex
CREATE INDEX "requirement_bids_returnLoadRequestId_idx" ON "requirement_bids"("returnLoadRequestId");
