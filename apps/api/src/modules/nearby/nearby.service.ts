import {
  type NearbyCategory,
  SOS_ELIGIBLE_TRUCK_STATUSES,
  type TruckStatus,
  boundingDeltas,
  compassDirection,
  bearing,
  distanceKm,
  type NearbySearchInput,
  type NearbyTrucksInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { cached } from '../../infra/cache';
import type { AuthContext } from '../../auth/context';

/**
 * Nearby services and nearby Saarthi trucks.
 *
 * The local POI dataset lives in PostgreSQL; in production the same interface
 * is served by a map provider's places API. Queries use an indexed bounding
 * box first, then an exact haversine pass — so the database does the coarse
 * filtering and only a small candidate set is measured precisely.
 */

export interface NearbyPlaceResult {
  id: string;
  category: NearbyCategory;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  rating: number | null;
  open24Hours: boolean;
  attributes: unknown;
  distanceKm: number;
  direction: string;
}

export async function searchNearbyPlaces(
  input: NearbySearchInput,
): Promise<NearbyPlaceResult[]> {
  const radiusMeters = input.radiusKm * 1000;
  const { latDelta, lngDelta } = boundingDeltas(input.latitude, radiusMeters);

  // Cache identical searches briefly — a driver panning the map re-issues the
  // same query many times and the POI dataset barely changes.
  const cacheKey = `nearby:${input.latitude.toFixed(2)}:${input.longitude.toFixed(2)}:${input.radiusKm}:${(input.category ?? []).join(',')}:${input.openNow ?? ''}`;

  return cached(cacheKey, 60, async () => {
    const candidates = await prisma.nearbyPlace.findMany({
      where: {
        active: true,
        ...(input.category ? { category: { in: input.category as NearbyCategory[] } } : {}),
        ...(input.openNow ? { open24Hours: true } : {}),
        latitude: { gte: input.latitude - latDelta, lte: input.latitude + latDelta },
        longitude: { gte: input.longitude - lngDelta, lte: input.longitude + lngDelta },
      },
      take: 2000,
    });

    const origin = { latitude: input.latitude, longitude: input.longitude };

    return candidates
      .map((place) => {
        const target = { latitude: place.latitude, longitude: place.longitude };
        return {
          id: place.id,
          category: place.category as NearbyCategory,
          name: place.name,
          address: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
          phone: place.phone,
          rating: place.rating,
          open24Hours: place.open24Hours,
          attributes: place.attributes,
          distanceKm: Number(distanceKm(origin, target).toFixed(2)),
          direction: compassDirection(bearing(origin, target)),
        };
      })
      .filter((place) => place.distanceKm <= input.radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, input.limit);
  });
}

/** Category counts within the radius, for the driver's quick-filter chips. */
export async function nearbyCategoryCounts(
  latitude: number,
  longitude: number,
  radiusKm: number,
): Promise<Record<string, number>> {
  const { latDelta, lngDelta } = boundingDeltas(latitude, radiusKm * 1000);

  const places = await prisma.nearbyPlace.findMany({
    where: {
      active: true,
      latitude: { gte: latitude - latDelta, lte: latitude + latDelta },
      longitude: { gte: longitude - lngDelta, lte: longitude + lngDelta },
    },
    select: { category: true, latitude: true, longitude: true },
    take: 5000,
  });

  const origin = { latitude, longitude };
  const counts: Record<string, number> = {};
  for (const place of places) {
    const distance = distanceKm(origin, {
      latitude: place.latitude,
      longitude: place.longitude,
    });
    if (distance > radiusKm) continue;
    counts[place.category] = (counts[place.category] ?? 0) + 1;
  }
  return counts;
}

export interface NearbyTruckResult {
  truckId: string;
  registrationNumber: string;
  truckType: string;
  capacityTons: number;
  status: string;
  /** Same fleet gets exact detail; other fleets get a privacy-safe summary. */
  sameFleet: boolean;
  fleetName: string | null;
  driverName: string | null;
  driverScore: number | null;
  contactPhone: string | null;
  distanceKm: number;
  direction: string;
  latitude: number;
  longitude: number;
  lastSeenAt: string;
}

const NEARBY_TRUCK_MAX_AGE_MS = 30 * 60_000;
/** Coordinates shown for other fleets are rounded to ~1 km. */
const PRIVACY_PRECISION = 2;

/**
 * Nearby active Saarthi trucks.
 *
 * Privacy rules: a truck only appears if its owner has enabled location
 * sharing. Trucks from the caller's own fleet show exact position, driver name
 * and phone; trucks from other fleets show an approximate position, no driver
 * identity and no contact number.
 */
export async function findNearbyTrucks(
  auth: AuthContext,
  input: NearbyTrucksInput,
): Promise<NearbyTruckResult[]> {
  const radiusMeters = input.radiusKm * 1000;
  const { latDelta, lngDelta } = boundingDeltas(input.latitude, radiusMeters);
  const since = new Date(Date.now() - NEARBY_TRUCK_MAX_AGE_MS);

  const trucks = await prisma.truck.findMany({
    where: {
      archivedAt: null,
      shareLocation: true,
      status: { in: SOS_ELIGIBLE_TRUCK_STATUSES as TruckStatus[] },
      lastLocationAt: { gte: since },
      lastLatitude: { gte: input.latitude - latDelta, lte: input.latitude + latDelta },
      lastLongitude: { gte: input.longitude - lngDelta, lte: input.longitude + lngDelta },
      ...(input.includeOtherFleets
        ? {}
        : { organizationId: auth.organizationId ?? '__none__' }),
    },
    include: {
      assignments: {
        where: { status: 'ACTIVE' },
        take: 1,
        include: {
          driver: { include: { user: { select: { firstName: true, lastName: true, phone: true } } } },
        },
      },
    },
    take: 500,
  });

  const organizationIds = [...new Set(trucks.map((truck) => truck.organizationId))];
  const organizations = await prisma.organization.findMany({
    where: { id: { in: organizationIds } },
    select: { id: true, name: true },
  });
  const orgMap = new Map(organizations.map((organization) => [organization.id, organization.name]));

  const origin = { latitude: input.latitude, longitude: input.longitude };

  return trucks
    .map((truck) => {
      const position = { latitude: truck.lastLatitude!, longitude: truck.lastLongitude! };
      const sameFleet = truck.organizationId === auth.organizationId;
      const assignment = truck.assignments[0];

      return {
        truckId: truck.id,
        registrationNumber: sameFleet
          ? truck.registrationNumber
          : // Partially mask another fleet's plate.
            `${truck.registrationNumber.slice(0, 4)}••${truck.registrationNumber.slice(-2)}`,
        truckType: truck.truckType,
        capacityTons: truck.capacityTons,
        status: truck.status,
        sameFleet,
        fleetName: sameFleet ? (orgMap.get(truck.organizationId) ?? null) : null,
        driverName: sameFleet && assignment
          ? `${assignment.driver.user.firstName} ${assignment.driver.user.lastName}`.trim()
          : null,
        driverScore: assignment?.driver.overallScore ?? null,
        contactPhone: sameFleet ? (assignment?.driver.user.phone ?? null) : null,
        distanceKm: Number(distanceKm(origin, position).toFixed(2)),
        direction: compassDirection(bearing(origin, position)),
        latitude: sameFleet
          ? position.latitude
          : Number(position.latitude.toFixed(PRIVACY_PRECISION)),
        longitude: sameFleet
          ? position.longitude
          : Number(position.longitude.toFixed(PRIVACY_PRECISION)),
        lastSeenAt: (truck.lastLocationAt ?? truck.updatedAt).toISOString(),
      };
    })
    .filter((truck) => truck.distanceKm <= input.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, input.limit);
}
