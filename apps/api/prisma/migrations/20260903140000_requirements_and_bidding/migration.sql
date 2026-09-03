-- Requirements and bidding: the customer's single front door.
--
-- Until now a customer could post exactly one thing: a freight load. A tour, a
-- taxi or a lorry-load of cement had no way in, so demand for those was
-- invisible to the suppliers and mobility operators who could have served it —
-- they could only publish a catalogue and wait to be found.
--
-- A `requirement` is that missing envelope. The customer states what they need,
-- the businesses whose organization type qualifies them bid against it, and an
-- awarded bid becomes a row on a pipeline that already exists: an `order` for
-- goods and freight, a `travel_booking` for cabs and tours. Nothing downstream
-- of the award changed — trips, tracking, delivery and rating are the same code
-- paths they were before.
--
-- Three shapes worth noting:
--
--   * The kind-specific columns are typed, not a JSON blob. The provider board
--     filters and sorts on tonnage, passenger count and truck type, and a board
--     that cannot query those is a list.
--
--   * `awardedMaterialBidId` and `awardedTransportBidId` are separate because a
--     material requirement usually settles twice — the yard that sells the
--     cement and the fleet that carries it are rarely the same business. The
--     PARTIALLY_AWARDED status is exactly the gap between those two awards.
--
--   * `travel_packages.sourceRequirementId` marks a package an operator minted
--     by winning a bespoke requirement. It is never PUBLISHED, so it stays out
--     of customer search while still giving the booking a package to hang from,
--     which is what let the whole travel pipeline be reused unchanged.

-- CreateEnum
CREATE TYPE "RequirementKind" AS ENUM ('MATERIAL_SUPPLY', 'FREIGHT_TRANSPORT', 'CAB_HIRE', 'TOUR_PACKAGE');

-- CreateEnum
CREATE TYPE "RequirementBidScope" AS ENUM ('MATERIAL', 'TRANSPORT', 'TRAVEL');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('OPEN', 'BIDDING', 'PARTIALLY_AWARDED', 'AWARDED', 'FULFILLED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RequirementBidStatus" AS ENUM ('OFFERED', 'SHORTLISTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RequirementEventType" AS ENUM ('CREATED', 'UPDATED', 'BID_PLACED', 'BID_UPDATED', 'BID_WITHDRAWN', 'BID_SHORTLISTED', 'BID_ACCEPTED', 'BID_REJECTED', 'AWARDED', 'ORDER_CREATED', 'BOOKING_CREATED', 'FULFILLED', 'CANCELLED', 'EXPIRED', 'NOTE');

-- CreateEnum
CREATE TYPE "HireBasis" AS ENUM ('ONE_WAY', 'ROUND_TRIP', 'HOURLY', 'DAILY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REQUIREMENT_POSTED';
ALTER TYPE "NotificationType" ADD VALUE 'REQUIREMENT_BID_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'REQUIREMENT_BID_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'REQUIREMENT_BID_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'REQUIREMENT_AWARDED';
ALTER TYPE "NotificationType" ADD VALUE 'REQUIREMENT_CANCELLED';

-- AlterTable
ALTER TABLE "travel_packages" ADD COLUMN     "sourceRequirementId" UUID;

-- CreateTable
CREATE TABLE "requirements" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "RequirementKind" NOT NULL,
    "customerId" UUID NOT NULL,
    "customerOrganizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "originAddress" TEXT NOT NULL,
    "originLatitude" DOUBLE PRECISION NOT NULL,
    "originLongitude" DOUBLE PRECISION NOT NULL,
    "originCity" TEXT,
    "originState" TEXT,
    "destinationAddress" TEXT,
    "destinationLatitude" DOUBLE PRECISION,
    "destinationLongitude" DOUBLE PRECISION,
    "destinationCity" TEXT,
    "destinationState" TEXT,
    "distanceKm" DOUBLE PRECISION,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "scheduleNotes" TEXT,
    "budgetAmount" DECIMAL(12,2),
    "budgetIsPublic" BOOLEAN NOT NULL DEFAULT false,
    "bidsCloseAt" TIMESTAMP(3) NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "materialId" UUID,
    "materialName" TEXT,
    "materialCategory" TEXT,
    "specification" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" "MaterialUnit",
    "needsTransport" BOOLEAN NOT NULL DEFAULT false,
    "goodsDescription" TEXT,
    "requiredCapacityTons" DOUBLE PRECISION,
    "requiredTruckType" "TruckType",
    "handlingNotes" TEXT,
    "hireBasis" "HireBasis",
    "passengers" INTEGER,
    "preferredVehicleType" "VehicleType",
    "durationHours" INTEGER,
    "durationDays" INTEGER,
    "durationNights" INTEGER,
    "luggageCount" INTEGER,
    "acRequired" BOOLEAN,
    "destinations" TEXT[],
    "requiredInclusions" TEXT[],
    "accommodationNeeded" BOOLEAN,
    "mealsNeeded" BOOLEAN,
    "status" "RequirementStatus" NOT NULL DEFAULT 'OPEN',
    "bidCount" INTEGER NOT NULL DEFAULT 0,
    "lowestBid" DECIMAL(12,2),
    "awardedMaterialBidId" UUID,
    "awardedTransportBidId" UUID,
    "awardedTravelBidId" UUID,
    "orderId" UUID,
    "bookingId" UUID,
    "cancellationReason" TEXT,
    "createdById" UUID NOT NULL,
    "awardedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_bids" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "scope" "RequirementBidScope" NOT NULL,
    "bidderOrganizationId" UUID NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "priceBreakdown" TEXT,
    "message" TEXT,
    "validUntil" TIMESTAMP(3),
    "vehicleId" UUID,
    "driverId" UUID,
    "estimatedPickupAt" TIMESTAMP(3),
    "estimatedArrivalAt" TIMESTAMP(3),
    "distanceToPickupKm" DOUBLE PRECISION,
    "materialId" UUID,
    "includesDelivery" BOOLEAN NOT NULL DEFAULT false,
    "availableQuantity" DOUBLE PRECISION,
    "leadTimeDays" INTEGER,
    "offeredVehicleType" "VehicleType",
    "inclusions" TEXT[],
    "exclusions" TEXT[],
    "itinerarySummary" TEXT,
    "driverIncluded" BOOLEAN NOT NULL DEFAULT true,
    "fuelIncluded" BOOLEAN NOT NULL DEFAULT true,
    "status" "RequirementBidStatus" NOT NULL DEFAULT 'OFFERED',
    "rejectionReason" TEXT,
    "createdById" UUID NOT NULL,
    "shortlistedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirement_bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_events" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "type" "RequirementEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "requirements_reference_key" ON "requirements"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "requirements_awardedMaterialBidId_key" ON "requirements"("awardedMaterialBidId");

-- CreateIndex
CREATE UNIQUE INDEX "requirements_awardedTransportBidId_key" ON "requirements"("awardedTransportBidId");

-- CreateIndex
CREATE UNIQUE INDEX "requirements_awardedTravelBidId_key" ON "requirements"("awardedTravelBidId");

-- CreateIndex
CREATE UNIQUE INDEX "requirements_orderId_key" ON "requirements"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "requirements_bookingId_key" ON "requirements"("bookingId");

-- CreateIndex
CREATE INDEX "requirements_customerOrganizationId_status_createdAt_idx" ON "requirements"("customerOrganizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "requirements_status_kind_startAt_idx" ON "requirements"("status", "kind", "startAt");

-- CreateIndex
CREATE INDEX "requirements_kind_status_createdAt_idx" ON "requirements"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "requirements_bidsCloseAt_status_idx" ON "requirements"("bidsCloseAt", "status");

-- CreateIndex
CREATE INDEX "requirements_originLatitude_originLongitude_idx" ON "requirements"("originLatitude", "originLongitude");

-- CreateIndex
CREATE INDEX "requirement_bids_requirementId_status_price_idx" ON "requirement_bids"("requirementId", "status", "price");

-- CreateIndex
CREATE INDEX "requirement_bids_bidderOrganizationId_status_createdAt_idx" ON "requirement_bids"("bidderOrganizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "requirement_bids_vehicleId_idx" ON "requirement_bids"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "requirement_bids_requirementId_bidderOrganizationId_scope_key" ON "requirement_bids"("requirementId", "bidderOrganizationId", "scope");

-- CreateIndex
CREATE INDEX "requirement_events_requirementId_createdAt_idx" ON "requirement_events"("requirementId", "createdAt");

-- CreateIndex
CREATE INDEX "travel_packages_sourceRequirementId_idx" ON "travel_packages"("sourceRequirementId");

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_bids" ADD CONSTRAINT "requirement_bids_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_bids" ADD CONSTRAINT "requirement_bids_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "trucks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_bids" ADD CONSTRAINT "requirement_bids_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_events" ADD CONSTRAINT "requirement_events_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_packages" ADD CONSTRAINT "travel_packages_sourceRequirementId_fkey" FOREIGN KEY ("sourceRequirementId") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

