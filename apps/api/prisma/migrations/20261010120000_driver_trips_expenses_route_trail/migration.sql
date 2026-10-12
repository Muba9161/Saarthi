-- Driver-raised trips, road expense slips, and the coloured covered-path trail.
--
-- Three additions that arrive together because they all come from the driver
-- app's shift screen:
--
--  * `trips.driverCreated` marks a trip the signed-on driver added themselves.
--    A fleet trip always outranks one: a driver trip made while a fleet trip is
--    open waits as a DRAFT until the vehicle is free.
--  * `expenses` holds the slips a driver photographs on the road other than
--    fuel — tolls, parking, repairs, food, loading, challans. Fuel stays in
--    `fuel_records`, because litres drive efficiency figures a toll does not.
--  * `truck_locations.routeState` records, once at ingest, whether each point
--    was driven with no trip, on the trip's planned route, or off it. Judging it
--    once is what lets the web, the app and the replay draw the same colours.

-- CreateEnum
CREATE TYPE "TrackRouteState" AS ENUM ('NO_TRIP', 'ON_ROUTE', 'OFF_ROUTE');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('TOLL', 'PARKING', 'REPAIR', 'FOOD', 'LOADING', 'CHALLAN', 'OTHER');

-- AlterEnum
ALTER TYPE "MediaOwnerType" ADD VALUE 'EXPENSE';

-- AlterTable
ALTER TABLE "truck_locations" ADD COLUMN     "routeState" "TrackRouteState" NOT NULL DEFAULT 'NO_TRIP';

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "driverCreated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "truckId" UUID NOT NULL,
    "tripId" UUID,
    "driverId" UUID,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "vendorName" TEXT,
    "notes" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_organizationId_recordedAt_idx" ON "expenses"("organizationId", "recordedAt");

-- CreateIndex
CREATE INDEX "expenses_truckId_recordedAt_idx" ON "expenses"("truckId", "recordedAt");

-- CreateIndex
CREATE INDEX "expenses_tripId_idx" ON "expenses"("tripId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
