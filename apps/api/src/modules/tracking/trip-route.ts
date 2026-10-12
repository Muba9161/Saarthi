import {
  ALTERNATE_LOOKBACK_MS,
  MOVING_TRIP_STATUSES,
  ROUTE_TRAIL_LEAVE_METRES,
  ROUTE_TRAIL_REJOIN_METRES,
  TrackRouteState,
  cumulativeDistances,
  distanceToPath,
  distanceToSegment,
  haversineDistance,
  isRoadRoute,
  nextRouteState,
  stillHeadingThere,
  type LatLng,
  type TripStatus,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';

/**
 * A trip's planned route, and where a position stands against it: how far
 * along, and how the covered-path trail colours it.
 */

export function routeOf(plannedRoute: Prisma.JsonValue | null): LatLng[] {
  if (!Array.isArray(plannedRoute)) return [];
  return (plannedRoute as unknown as LatLng[]).filter(
    (point) => point && typeof point.latitude === 'number' && typeof point.longitude === 'number',
  );
}

/**
 * Project the truck onto its planned route to work out how far along it is.
 *
 * The projection is onto the nearest *segment*, not the nearest vertex: a
 * two-point route (origin → destination) has no intermediate vertices, so a
 * vertex-based match would snap every position to 0% or 100%.
 *
 * Returns kilometres travelled along the route, or `null` when there is no
 * usable route to project onto.
 */
export function progressAlongRoute(route: LatLng[], position: LatLng): number | null {
  if (route.length < 2) return null;

  const cumulative = cumulativeDistances(route);

  let bestSegment = 0;
  let bestOffset = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1]!;
    const end = route[index]!;
    const segmentLength = haversineDistance(start, end);
    if (segmentLength === 0) continue;

    const perpendicular = distanceToSegment(position, start, end);
    if (perpendicular < bestDistance) {
      bestDistance = perpendicular;
      bestSegment = index - 1;

      // Scalar projection of the position onto this segment, clamped to it.
      const toPosition = haversineDistance(start, position);
      const along = Math.sqrt(
        Math.max(0, toPosition * toPosition - perpendicular * perpendicular),
      );
      bestOffset = Math.min(segmentLength, along);
    }
  }

  if (bestDistance === Number.POSITIVE_INFINITY) return null;

  const base = cumulative[bestSegment] ?? 0;
  return (base + bestOffset) / 1000;
}

/** The trip fields the trail colour depends on. */
export interface RouteStateTrip {
  id: string;
  status: string;
  adHoc: boolean;
  plannedRoute: Prisma.JsonValue | null;
  externalNavigation: string | null;
  destinationLatitude: number;
  destinationLongitude: number;
}

/**
 * How the covered-path trail colours this point.
 *
 * Only a dispatched trip that is moving counts as "on a trip": a service run to
 * a pump is the vehicle's own errand, and an assigned trip not yet started has
 * not begun. The previous point is read only inside the hysteresis band, where
 * it is the one thing that decides the answer — everywhere else the distance
 * alone does, and the read would be wasted on every fix.
 *
 * Off the planned road while the driver follows Google Maps, the stretch is an
 * alternate road for as long as the vehicle is still heading for the
 * destination — see {@link stillHeadingThere}. That costs one more read, and
 * only for a handed-off trip that is off its route.
 */
export async function routeStateFor(
  trip: RouteStateTrip | null,
  truckId: string,
  position: LatLng,
  recordedAt: Date,
): Promise<TrackRouteState> {
  const tripUnderway =
    trip !== null && !trip.adHoc && MOVING_TRIP_STATUSES.includes(trip.status as TripStatus);
  const route = tripUnderway ? routeOf(trip.plannedRoute) : null;

  let previous: TrackRouteState | null = null;
  if (tripUnderway && route && isRoadRoute(route)) {
    const offRouteMetres = distanceToPath(position, route);
    const inBand =
      offRouteMetres >= ROUTE_TRAIL_REJOIN_METRES && offRouteMetres <= ROUTE_TRAIL_LEAVE_METRES;
    if (inBand) {
      const last = await prisma.truckLocation.findFirst({
        where: { truckId, tripId: trip.id },
        orderBy: { recordedAt: 'desc' },
        select: { routeState: true },
      });
      previous = last?.routeState ?? null;
    }
  }

  const state = nextRouteState({ tripUnderway, route, position, previous });
  if (state !== TrackRouteState.OFF_ROUTE || !trip?.externalNavigation) return state;
  return (await headingForDestination(trip, truckId, position, recordedAt))
    ? TrackRouteState.ALTERNATE
    : state;
}

/** Whether the vehicle is no further from the destination than a few minutes ago. */
async function headingForDestination(
  trip: RouteStateTrip,
  truckId: string,
  position: LatLng,
  recordedAt: Date,
): Promise<boolean> {
  const destination = { latitude: trip.destinationLatitude, longitude: trip.destinationLongitude };
  const earlier = await prisma.truckLocation.findFirst({
    where: {
      truckId,
      tripId: trip.id,
      recordedAt: { lte: new Date(recordedAt.getTime() - ALTERNATE_LOOKBACK_MS) },
    },
    orderBy: { recordedAt: 'desc' },
    select: { latitude: true, longitude: true },
  });
  return stillHeadingThere(
    earlier ? haversineDistance(earlier, destination) : null,
    haversineDistance(position, destination),
  );
}
