-- Navigating with Google Maps, and stop arrival from the vehicle's own GPS.
--
--  * `trips.externalNavigation` marks a trip the driver is following in Google
--    Maps instead of Saarthi's own navigation. That app picks its own roads and
--    cannot say which, so leaving the planned route while still heading for the
--    destination is recorded as an alternate road, not a deviation.
--  * `truck_locations.routeState` gains ALTERNATE for those stretches: drawn in
--    amber on the trail, never counted against the driver.
--  * `trip_stops.reachedAt` / `leftAt` are measured from the reported positions
--    — reached once the vehicle stays inside the stop's radius, left at the
--    first position back outside it. A stop is never marked arrived from them
--    alone; the driver confirms. `reachingSince` holds the wait in between.
--  * Four timeline entries for the trip: the handoff, the alternate road, and
--    the stop reached and left.

-- AlterEnum
ALTER TYPE "TrackRouteState" ADD VALUE 'ALTERNATE';

-- AlterEnum
ALTER TYPE "TripEventType" ADD VALUE 'NAVIGATION_HANDOFF';
ALTER TYPE "TripEventType" ADD VALUE 'ALTERNATE_ROUTE';
ALTER TYPE "TripEventType" ADD VALUE 'STOP_REACHED';
ALTER TYPE "TripEventType" ADD VALUE 'STOP_LEFT';

-- CreateEnum
CREATE TYPE "ExternalNavigationApp" AS ENUM ('GOOGLE_MAPS');

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "externalNavigation" "ExternalNavigationApp",
ADD COLUMN     "externalNavigationSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "trip_stops" ADD COLUMN     "reachingSince" TIMESTAMP(3),
ADD COLUMN     "reachedAt" TIMESTAMP(3),
ADD COLUMN     "leftAt" TIMESTAMP(3);
