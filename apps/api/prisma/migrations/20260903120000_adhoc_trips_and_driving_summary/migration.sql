-- Ad-hoc service runs, and the driving summary every trip now carries.
--
-- Two things arrive together because they exist for the same reason: a vehicle
-- that drives to a petrol pump with no dispatched trip against it used to leave
-- no record at all. The distance, the speeds and the braking were measured, the
-- odometer moved, and none of it was ever written down.
--
-- `adHoc` marks a trip the terminal opened on its own — a run to a nearby
-- service rather than a movement a dispatcher planned. It is also what lets a
-- real trip be created for a vehicle that is mid-service-run: the service run is
-- closed rather than the dispatch refused.
--
-- The summary columns are on the trip rather than derived from the telemetry
-- series on demand, because the series is pruned on a retention schedule and
-- the figures a fleet reports on are not.

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "adHoc" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "topSpeedKph" DOUBLE PRECISION,
ADD COLUMN     "averageSpeedKph" DOUBLE PRECISION,
ADD COLUMN     "harshBrakingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "harshAccelerationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startOdometerKm" DOUBLE PRECISION,
ADD COLUMN     "endOdometerKm" DOUBLE PRECISION;

-- CreateIndex
--
-- The terminal asks "is there a service run open on this vehicle" on every
-- navigation start, and the fleet trip list filters dispatched movements from
-- service runs. Both are this index.
CREATE INDEX "trips_truckId_adHoc_status_idx" ON "trips"("truckId", "adHoc", "status");
