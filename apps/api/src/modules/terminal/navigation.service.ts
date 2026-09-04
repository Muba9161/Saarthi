import {
  DistanceBasis,
  VehicleCapability,
  VehicleType,
  distanceKm,
  vehicleSupports,
  type LatLng,
  type MeasuredDistance,
  type TerminalPlaceMatch,
  type TerminalRouteView,
  type TerminalServiceResult,
  type TerminalServicesResponse,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { searchNearbyPlaces } from '../nearby/nearby.service';
import {
  RoutingError,
  isRoutingConfigured,
  routingProvider,
  type RoutingProfile,
} from '../../providers/routing';
import type { NearbyPlaceResult } from '../nearby/nearby.service';

/**
 * How far, and by which road.
 *
 * Section 29 of the terminal specification is about a driver saying "I'm on low
 * fuel, take me to the nearest petrol pump" — and the word doing the work in
 * that sentence is **nearest**. Straight-line distance answers a different
 * question. A pump 800 m away across a motorway with no junction for six
 * kilometres is not the nearest pump, and a driver sent to it on a quarter tank
 * has been actively misled.
 *
 * So this module does two things:
 *
 *  1. **Re-ranks a services list by road distance**, using one matrix call for
 *     the whole list rather than one routing call per place. That is the
 *     difference between spending a fleet's daily routing allowance on a single
 *     search and spending one request on it.
 *
 *  2. **Routes to the one the driver picked**, on the *vehicle's* profile. A
 *     40-tonne truck is routed as a truck, so the answer respects the weight,
 *     height and access limits a car profile ignores.
 *
 * When routing is unavailable — no key configured, quota spent, the service
 * down — everything still works and every distance says `STRAIGHT_LINE`. The
 * terminal renders that as "3.2 km direct" and shows a note. Degrading quietly,
 * so that a crow-flies figure reads as a road distance, is the one outcome this
 * module must never produce.
 */

const navigationLogger = logger.child({ module: 'terminal-navigation' });

/**
 * How many places to measure by road.
 *
 * A driver reads the first few entries of a list and picks one. Measuring
 * twenty-five is generous; measuring a hundred would spend budget on rows
 * nobody scrolls to.
 */
const MAX_ROAD_MEASURED = 25;

/**
 * The routing profile for a vehicle.
 *
 * `driving-hgv` for anything that carries freight, `driving-car` for a taxi or a
 * passenger vehicle. Getting this wrong in either direction is a real cost: a
 * car routed as a lorry takes a needlessly long way round, and a lorry routed as
 * a car is sent under a bridge it does not fit beneath.
 */
export function profileForVehicle(vehicleType: VehicleType): RoutingProfile {
  return vehicleSupports(vehicleType, VehicleCapability.FREIGHT)
    ? 'driving-hgv'
    : 'driving-car';
}

function straightLine(place: NearbyPlaceResult): MeasuredDistance {
  return {
    km: place.distanceKm,
    basis: DistanceBasis.STRAIGHT_LINE,
    // No duration. A straight-line "time" would be a number invented from a
    // speed nobody chose, and it would look exactly like a real ETA.
    durationMinutes: null,
  };
}

function toResult(
  place: NearbyPlaceResult,
  distance: MeasuredDistance,
): TerminalServiceResult {
  return {
    id: place.id,
    category: place.category,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    phone: place.phone,
    open24Hours: place.open24Hours,
    openingHours: place.openingHours,
    direction: place.direction,
    straightLineKm: place.distanceKm,
    distance,
    source: place.source,
  };
}

/**
 * Nearby services, ranked by the distance the driver will actually cover.
 *
 * The ordering change is the point. `searchNearbyPlaces` returns crow-flies
 * order; once road distances are known the list is re-sorted, and the top entry
 * becomes the one that is genuinely closest to drive to. Without the re-sort
 * this would be a list in the wrong order with the right numbers on it, which
 * is arguably worse than the wrong numbers.
 */
export async function findServices(input: {
  organizationId: string;
  vehicleId: string;
  service: string | null;
  categories: readonly string[];
  latitude: number;
  longitude: number;
  radiusKm: number;
  limit: number;
}): Promise<TerminalServicesResponse> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: input.vehicleId },
    select: { vehicleType: true },
  });

  const places = await searchNearbyPlaces({
    latitude: input.latitude,
    longitude: input.longitude,
    radiusKm: input.radiusKm,
    category: [...input.categories] as never,
    limit: input.limit,
    openNow: undefined,
  });

  const from: LatLng = { latitude: input.latitude, longitude: input.longitude };

  if (places.length === 0) {
    return {
      service: input.service,
      from,
      places: [],
      roadDistancesAvailable: isRoutingConfigured,
      routingNote: null,
    };
  }

  if (!routingProvider) {
    return {
      service: input.service,
      from,
      places: places.map((place) => toResult(place, straightLine(place))),
      roadDistancesAvailable: false,
      routingNote:
        'Showing direct distances. Road routing is not configured on this Saarthi instance, so the drive will be longer than the figures shown.',
    };
  }

  const profile = profileForVehicle((vehicle?.vehicleType as VehicleType) ?? VehicleType.TRUCK);
  const measurable = places.slice(0, MAX_ROAD_MEASURED);

  try {
    const distances = await roadDistances(
      from,
      measurable.map((place) => ({ latitude: place.latitude, longitude: place.longitude })),
      profile,
    );

    const results = places.map((place, index) => {
      const measured = distances[index];
      if (!measured || measured.distanceMeters === null) {
        // The router could not connect this pair — an island, a private road, a
        // place mapped fifty metres inside a compound. Straight-line, labelled.
        return toResult(place, straightLine(place));
      }
      return toResult(place, {
        km: Math.round((measured.distanceMeters / 1000) * 10) / 10,
        basis: DistanceBasis.ROAD,
        durationMinutes:
          measured.durationSeconds === null
            ? null
            : Math.max(1, Math.round(measured.durationSeconds / 60)),
      });
    });

    // Re-rank. A list with road distances in crow-flies order would put the
    // wrong entry first while showing the right number beside it.
    results.sort((a, b) => a.distance.km - b.distance.km);

    const anyRoad = results.some((result) => result.distance.basis === DistanceBasis.ROAD);

    return {
      service: input.service,
      from,
      places: results,
      roadDistancesAvailable: anyRoad,
      routingNote: anyRoad
        ? null
        : 'Showing direct distances — the router could not reach any of these by road.',
    };
  } catch (error) {
    // Routing failing must never fail the search. A driver looking for fuel
    // gets a list with honest straight-line distances and a note, which is far
    // better than an error screen.
    const note =
      error instanceof RoutingError
        ? error.message
        : 'Road distances are unavailable right now.';

    navigationLogger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'Road distances unavailable; falling back to straight-line',
    );

    return {
      service: input.service,
      from,
      places: places.map((place) => toResult(place, straightLine(place))),
      roadDistancesAvailable: false,
      routingNote: `Showing direct distances. ${note}`,
    };
  }
}

/**
 * Road distances, cached.
 *
 * Keyed on the origin rounded to ~100 m and the destination set. A vehicle
 * creeping through a yard would otherwise issue a fresh matrix call every few
 * seconds for an answer that has not meaningfully changed, and the daily
 * allowance would be gone before lunch.
 */
async function roadDistances(
  from: LatLng,
  to: LatLng[],
  profile: RoutingProfile,
) {
  if (!routingProvider) return [];

  const key = cacheKeys.terminalRoadDistances(
    `${profile}:${round(from.latitude)},${round(from.longitude)}:` +
      to.map((point) => `${round(point.latitude)},${round(point.longitude)}`).join('|'),
  );

  const hit = await cache.get<Awaited<ReturnType<typeof routingProvider.distances>>>(key);
  if (hit) return hit;

  const distances = await routingProvider.distances(from, to, profile);
  await cache.set(key, distances, cacheTtl.terminalRoute);
  return distances;
}

/** ~100 m. Enough to cache across a vehicle idling, not across a junction. */
function round(value: number): string {
  return value.toFixed(3);
}

/**
 * Places matching what the driver typed.
 *
 * Straight through to the geocoder — nothing is stored, and nothing is mixed in
 * from the local `nearby_places` table. That table holds generated demonstration
 * rows, and a search that quietly blended them with real results would send
 * somebody to an address that does not exist.
 *
 * Requires routing to be configured, and says so plainly when it is not. A
 * search box that silently returns nothing is indistinguishable from a place
 * that does not exist, and a driver would conclude the wrong one.
 */
export async function searchPlaces(input: {
  query: string;
  from: LatLng;
  limit: number;
}): Promise<TerminalPlaceMatch[]> {
  if (!routingProvider) {
    throw errors.providerNotConfigured(
      'routing',
      'Place search is not configured on this Saarthi instance. ' +
        'Use the service categories, or ask your fleet for the coordinates.',
    );
  }

  const matches = await routingProvider
    .searchPlaces(input.query, input.from, input.limit)
    .catch((error: unknown) => {
      if (error instanceof RoutingError) throw errors.businessRule(error.message);
      throw error;
    });

  return matches.map((match, index) => ({
    // The geocoder has no stable id, and the cockpit needs one to key a list.
    // Position plus name is unique within a single set of results, which is the
    // only scope this id ever has to survive.
    id: `${match.latitude.toFixed(5)},${match.longitude.toFixed(5)}:${index}`,
    name: match.name,
    address: match.address,
    latitude: match.latitude,
    longitude: match.longitude,
    straightLineKm:
      match.distanceMeters !== null
        ? Math.round((match.distanceMeters / 1000) * 10) / 10
        : Math.round(distanceKm(input.from, {
            latitude: match.latitude,
            longitude: match.longitude,
          }) * 10) / 10,
  }));
}

/**
 * The route to one destination.
 *
 * Fetched only when the driver picks somewhere — one routing call for one
 * decision, rather than a polyline per row in a list they scrolled past.
 */
export async function routeTo(input: {
  vehicleId: string;
  from: LatLng;
  to: LatLng;
  destinationName: string;
  avoidTolls: boolean;
}): Promise<TerminalRouteView> {
  if (!routingProvider) {
    throw errors.providerNotConfigured(
      'routing',
      'Turn-by-turn routing is not configured on this Saarthi instance. The map still shows where you and the destination are.',
    );
  }

  const vehicle = await prisma.truck.findUnique({
    where: { id: input.vehicleId },
    select: { vehicleType: true },
  });
  const profile = profileForVehicle((vehicle?.vehicleType as VehicleType) ?? VehicleType.TRUCK);

  const key = cacheKeys.terminalRoute(
    `${profile}:${input.avoidTolls ? 'notoll' : 'any'}:` +
      `${round(input.from.latitude)},${round(input.from.longitude)}:` +
      `${input.to.latitude.toFixed(5)},${input.to.longitude.toFixed(5)}`,
  );

  const cached = await cache.get<TerminalRouteView>(key);
  if (cached) {
    // The geometry is still right; only the arrival time has moved on.
    return { ...cached, etaAt: etaFrom(cached.durationMinutes) };
  }

  let route;
  try {
    route = await routingProvider.route({
      from: input.from,
      to: input.to,
      profile,
      ...(input.avoidTolls ? { avoid: ['toll'] as const } : {}),
    });
  } catch (error) {
    if (error instanceof RoutingError) {
      // Passed through in the router's own words. "No drivable route connects
      // those points" is a useful thing for a driver to read; "routing failed"
      // is not.
      throw errors.businessRule(error.message);
    }
    throw error;
  }

  const view: TerminalRouteView = {
    distanceKm: Math.round((route.distanceMeters / 1000) * 10) / 10,
    durationMinutes: Math.max(1, Math.round(route.durationSeconds / 60)),
    summary: route.summary,
    profile: route.profile,
    geometry: route.geometry.map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude,
    })),
    steps: route.steps.map((step) => ({
      distanceMeters: Math.round(step.distanceMeters),
      durationSeconds: Math.round(step.durationSeconds),
      name: step.name,
      instruction: step.instruction,
      maneuver: step.maneuver,
      modifier: step.modifier,
      latitude: step.at.latitude,
      longitude: step.at.longitude,
    })),
    destination: {
      name: input.destinationName,
      latitude: input.to.latitude,
      longitude: input.to.longitude,
    },
    etaAt: etaFrom(Math.max(1, Math.round(route.durationSeconds / 60))),
  };

  await cache.set(key, view, cacheTtl.terminalRoute);

  navigationLogger.info(
    {
      vehicleId: input.vehicleId,
      profile,
      distanceKm: view.distanceKm,
      durationMinutes: view.durationMinutes,
    },
    'Route computed for a terminal',
  );

  return view;
}

/**
 * Arrival time, computed server-side.
 *
 * A tablet whose clock has drifted — which, on cheap hardware that has been
 * powered down for a week, is most of them — would otherwise show an ETA
 * confidently in the past.
 */
function etaFrom(durationMinutes: number): string {
  return new Date(Date.now() + durationMinutes * 60_000).toISOString();
}
