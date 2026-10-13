import {
  DistanceBasis,
  FuelType,
  VehicleCapability,
  VehicleType,
  distanceKm,
  haversineDistance,
  vehicleSupports,
  type LatLng,
  type MeasuredDistance,
  type TerminalPlaceMatch,
  type TerminalRouteView,
  type TerminalServiceResult,
  type TerminalServicesResponse,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { searchNearbyPlaces } from '../nearby/nearby.service';
import { searchPhoton } from '../../providers/places/photon-place-search';
import {
  RoutingError,
  isRoutingConfigured,
  routingProvider,
  type PlaceMatch,
  type RoutingProfile,
} from '../../providers/routing';
import type { NearbyPlaceResult } from '../nearby/nearby.service';
import { pumpFuelFor } from './driver-extras.service';
import { mergePumps, pumpsNear } from './nearby-pumps';

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

/** A tag value from the directory's own bag, trimmed, or null. */
function tag(attributes: unknown, key: string): string | null {
  if (!attributes || typeof attributes !== 'object') return null;
  const value = (attributes as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** OpenStreetMap's `yes`/`designated` and `no` for a tag, or null when it is silent. */
function yesNo(value: string | null): boolean | null {
  if (value === null) return null;
  if (['yes', 'designated', 'only'].includes(value)) return true;
  if (value === 'no') return false;
  return null;
}

/** The fuels a pump declares, from its `fuel:*` tags. */
function fuelsOf(attributes: unknown): string[] {
  const declared: [string, string][] = [
    ['fuel:diesel', 'DIESEL'],
    ['fuel:octane_91', 'PETROL'],
    ['fuel:octane_95', 'PETROL'],
    ['fuel:HGV_diesel', 'TRUCK_DIESEL'],
    ['fuel:cng', 'CNG'],
    ['fuel:lpg', 'LPG'],
  ];
  return [
    ...new Set(declared.filter(([key]) => tag(attributes, key) === 'yes').map(([, fuel]) => fuel)),
  ];
}

function toResult(
  place: NearbyPlaceResult,
  distance: MeasuredDistance,
): TerminalServiceResult {
  const brand = tag(place.attributes, 'brand');
  const operator = tag(place.attributes, 'operator');
  return {
    brand,
    operator: operator && operator !== brand ? operator : null,
    website: tag(place.attributes, 'website') ?? tag(place.attributes, 'contact:website'),
    fuels: fuelsOf(place.attributes),
    hgv: yesNo(tag(place.attributes, 'hgv')),
    stale: place.stale,
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
/**
 * What "fuel" means for the vehicle actually asking.
 *
 * The terminal's `FUEL` key has always mapped to both petrol pumps and charging
 * points, for every vehicle — so an electric van was shown a list of diesel
 * pumps it cannot use, and a forty-tonne truck was shown car chargers. Both are
 * the same fault: the category was chosen by the button, not by the vehicle.
 *
 * Only the refuelling key is narrowed. A mechanic, a weighbridge or a hospital
 * means the same thing whatever the vehicle burns, and narrowing those would be
 * inventing a rule nobody asked for.
 *
 * Hybrids keep both on purpose — that is exactly what a hybrid is, and a driver
 * of one is the only driver for whom either answer may be the right one.
 * Unknown fuel keeps both too: showing a driver too much is recoverable, and
 * hiding the only station they can use is not.
 */
export function refuellingCategoriesFor(
  service: string | null,
  fuelType: FuelType | null | undefined,
  requested: readonly string[],
): readonly string[] {
  if (service !== 'FUEL') return requested;

  switch (fuelType) {
    case FuelType.ELECTRIC:
      return ['CHARGING'];
    case FuelType.DIESEL:
    case FuelType.PETROL:
    case FuelType.CNG:
    case FuelType.LNG:
      return ['FUEL'];
    default:
      // HYBRID, and anything the fleet has not recorded.
      return requested;
  }
}

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
    select: { vehicleType: true, fuelType: true },
  });

  const categories = refuellingCategoriesFor(input.service, vehicle?.fuelType, input.categories);

  const from: LatLng = { latitude: input.latitude, longitude: input.longitude };
  const fuel = pumpFuelFor(vehicle?.fuelType ?? null);
  const wantsPumps = categories.includes('FUEL');

  // More than the page by straight line, so the road re-rank chooses the page
  // from the nearest dozens rather than only re-ordering the first twenty. The
  // map and the pump directory are asked together; for fuel, either alone is an
  // answer, so one being down must not empty the list.
  const [mapped, pumps] = await Promise.all([
    searchNearbyPlaces({
      latitude: input.latitude,
      longitude: input.longitude,
      radiusKm: input.radiusKm,
      category: [...categories] as never,
      limit: Math.max(input.limit, MAX_ROAD_MEASURED),
      openNow: undefined,
    }).then(
      (found) => ({ found, failure: null }),
      (failure: unknown) => ({ found: [] as NearbyPlaceResult[], failure }),
    ),
    wantsPumps ? pumpsNear(from, input.radiusKm, fuel) : Promise.resolve([]),
  ]);
  if (mapped.failure !== null && pumps.length === 0) throw mapped.failure;

  const places = mergePumps(mapped.found, pumps, fuel).slice(
    0,
    Math.max(input.limit, MAX_ROAD_MEASURED),
  );

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
      places: places.slice(0, input.limit).map((place) => toResult(place, straightLine(place))),
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
    // wrong entry first while showing the right number beside it. Road-measured
    // places come first: a straight-line figure is always the shorter one, so
    // mixing the two would float an unreachable place above a real drive.
    results.sort((a, b) => {
      const aRoad = a.distance.basis === DistanceBasis.ROAD ? 0 : 1;
      const bRoad = b.distance.basis === DistanceBasis.ROAD ? 0 : 1;
      return aRoad - bRoad || a.distance.km - b.distance.km;
    });

    const anyRoad = results.some((result) => result.distance.basis === DistanceBasis.ROAD);

    return {
      service: input.service,
      from,
      places: results.slice(0, input.limit),
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
      places: places.slice(0, input.limit).map((place) => toResult(place, straightLine(place))),
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
 * Two searches, merged: Photon over OpenStreetMap first, which knows India's
 * named places — the hospitals, colleges and malls a driver types — and the
 * routing geocoder after it for anything Photon missed. The same place found
 * by both is listed once.
 *
 * Requires one of them to be configured, and says so plainly when neither is.
 * A search box that silently returns nothing is indistinguishable from a place
 * that does not exist, and a driver would conclude the wrong one.
 */
export async function searchPlaces(input: {
  query: string;
  from: LatLng;
  limit: number;
}): Promise<TerminalPlaceMatch[]> {
  if (!routingProvider && !config.placeSearch.photonUrl) {
    throw errors.providerNotConfigured(
      'routing',
      'Place search is not configured on this Saarthi instance. ' +
        'Use the service categories, or ask your fleet for the coordinates.',
    );
  }

  const [photon, routed] = await Promise.all([
    searchPhoton(input.query, input.from, input.limit),
    routingProvider
      ? routingProvider.searchPlaces(input.query, input.from, input.limit).catch((error: unknown) => {
          // Photon may still have answered; only with nothing at all is the router's refusal the answer.
          if (error instanceof RoutingError) return error;
          throw error;
        })
      : Promise.resolve([] as PlaceMatch[]),
  ]);
  if (routed instanceof RoutingError && photon.length === 0) throw errors.businessRule(routed.message);

  const matches = mergePlaceMatches(photon, routed instanceof RoutingError ? [] : routed).slice(0, input.limit);

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

/** Closer than this, two results with the same name are the same place. */
const SAME_PLACE_METRES = 150;

/**
 * `first`, then whatever of `second` it does not already have — the same name
 * within a short walk of each other being one place found twice.
 */
export function mergePlaceMatches(first: readonly PlaceMatch[], second: readonly PlaceMatch[]): PlaceMatch[] {
  const merged = [...first];
  for (const candidate of second) {
    const name = candidate.name.trim().toLowerCase();
    const duplicate = merged.some(
      (kept) =>
        haversineDistance(kept, candidate) <= SAME_PLACE_METRES &&
        (kept.name.trim().toLowerCase().includes(name) || name.includes(kept.name.trim().toLowerCase())),
    );
    if (!duplicate) merged.push(candidate);
  }
  return merged;
}
