import {
  bearing,
  boundingDeltas,
  compassDirection,
  distanceKm,
  type PetrolStation,
  type PetrolStationQuery,
  type PetrolStationSearchResult,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { cache } from '../../infra/cache';
import { isAppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  petrolStationProvider,
  type ProviderPetrolStation,
} from '../../providers/petrol-stations';

/**
 * Petrol station discovery.
 *
 * The map must stay responsive and must not pull a national directory into the
 * browser, so every request is bounded by the caller's point and radius and
 * passes through three layers:
 *
 *   viewport query → in-process cache → provider → mirror in PostgreSQL
 *
 * The mirror is what makes a directory outage survivable: if the provider
 * fails, previously seen stations for that area are returned with
 * `stale: true` so the UI can say so honestly instead of showing an empty map.
 */

const serviceLogger = logger.child({ module: 'petrol-stations' });
const SOURCE = petrolStationProvider.name;

/**
 * Cache key.
 *
 * Coordinates are rounded to ~1 km so a driver nudging the map re-uses one
 * entry instead of billing a fresh search for every pixel of pan.
 */
function cacheKey(query: PetrolStationQuery): string {
  return [
    'petrol-stations',
    query.latitude.toFixed(2),
    query.longitude.toFixed(2),
    query.radiusKm,
    query.limit,
    query.fuelType ?? '',
    (query.company ?? '').toLowerCase(),
  ].join(':');
}

/** Stable Saarthi id for a station, independent of the row's database id. */
function stationId(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

/**
 * Collapse duplicates.
 *
 * The directory can return the same site twice: once under its own id and
 * again under a dealer-level record at identical coordinates. The first
 * occurrence wins, which is also the closest one after sorting.
 */
function dedupe(stations: PetrolStation[]): PetrolStation[] {
  const byId = new Set<string>();
  const byIdentity = new Set<string>();
  const unique: PetrolStation[] = [];

  for (const station of stations) {
    const identity = [
      (station.name ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
      station.latitude.toFixed(5),
      station.longitude.toFixed(5),
    ].join('|');

    if (byId.has(station.id)) continue;
    if (identity !== '||' && byIdentity.has(identity)) continue;

    byId.add(station.id);
    byIdentity.add(identity);
    unique.push(station);
  }

  return unique;
}

function withGeometry(
  station: Omit<PetrolStation, 'distanceKm' | 'direction'>,
  origin: { latitude: number; longitude: number },
): PetrolStation {
  const target = { latitude: station.latitude, longitude: station.longitude };
  return {
    ...station,
    distanceKm: Number(distanceKm(origin, target).toFixed(2)),
    direction: compassDirection(bearing(origin, target)),
  };
}

function fromProvider(
  station: ProviderPetrolStation,
  origin: { latitude: number; longitude: number },
): PetrolStation {
  return withGeometry(
    {
      id: stationId(SOURCE, station.externalId),
      externalId: station.externalId,
      source: SOURCE,
      name: station.name,
      company: station.company,
      latitude: station.latitude,
      longitude: station.longitude,
      address: station.address,
      city: station.city,
      district: station.district,
      state: station.state,
      hasPetrol: station.hasPetrol,
      hasDiesel: station.hasDiesel,
      hasCng: station.hasCng,
      petrolPrice: station.petrolPrice,
      dieselPrice: station.dieselPrice,
      cngPrice: station.cngPrice,
      timings: station.timings,
      directionsUrl: station.directionsUrl,
    },
    origin,
  );
}

/**
 * Mirror the directory's answer into PostgreSQL.
 *
 * Best-effort by design: the caller already has their stations, so a write
 * failure is logged and swallowed rather than turned into a failed search.
 */
async function mirrorStations(stations: ProviderPetrolStation[]): Promise<void> {
  if (stations.length === 0) return;

  try {
    await Promise.all(
      stations.map((station) =>
        prisma.petrolStation.upsert({
          where: { source_externalId: { source: SOURCE, externalId: station.externalId } },
          create: {
            source: SOURCE,
            externalId: station.externalId,
            name: station.name,
            company: station.company,
            latitude: station.latitude,
            longitude: station.longitude,
            address: station.address,
            city: station.city,
            district: station.district,
            state: station.state,
            hasPetrol: station.hasPetrol,
            hasDiesel: station.hasDiesel,
            hasCng: station.hasCng,
            petrolPrice: station.petrolPrice,
            dieselPrice: station.dieselPrice,
            cngPrice: station.cngPrice,
            timings: station.timings,
            directionsUrl: station.directionsUrl,
            rawData: station.raw as object,
            refreshedAt: new Date(),
          },
          update: {
            name: station.name,
            company: station.company,
            latitude: station.latitude,
            longitude: station.longitude,
            address: station.address,
            city: station.city,
            district: station.district,
            state: station.state,
            hasPetrol: station.hasPetrol,
            hasDiesel: station.hasDiesel,
            hasCng: station.hasCng,
            petrolPrice: station.petrolPrice,
            dieselPrice: station.dieselPrice,
            cngPrice: station.cngPrice,
            timings: station.timings,
            directionsUrl: station.directionsUrl,
            rawData: station.raw as object,
            refreshedAt: new Date(),
          },
        }),
      ),
    );
  } catch (error) {
    serviceLogger.warn({ err: error }, 'Petrol stations could not be mirrored to the database');
  }
}

/** Previously mirrored stations for this area — the provider-outage fallback. */
async function storedStations(query: PetrolStationQuery): Promise<PetrolStation[]> {
  const { latDelta, lngDelta } = boundingDeltas(query.latitude, query.radiusKm * 1000);

  const rows = await prisma.petrolStation.findMany({
    where: {
      latitude: { gte: query.latitude - latDelta, lte: query.latitude + latDelta },
      longitude: { gte: query.longitude - lngDelta, lte: query.longitude + lngDelta },
      ...(query.company
        ? { company: { contains: query.company, mode: 'insensitive' as const } }
        : {}),
      ...(query.fuelType === 'petrol' ? { hasPetrol: true } : {}),
      ...(query.fuelType === 'diesel' ? { hasDiesel: true } : {}),
      ...(query.fuelType === 'cng' ? { hasCng: true } : {}),
    },
    take: 500,
  });

  const origin = { latitude: query.latitude, longitude: query.longitude };

  return rows
    .map((row) =>
      withGeometry(
        {
          id: stationId(row.source, row.externalId),
          externalId: row.externalId,
          source: row.source,
          name: row.name,
          company: row.company,
          latitude: row.latitude,
          longitude: row.longitude,
          address: row.address,
          city: row.city,
          district: row.district,
          state: row.state,
          hasPetrol: row.hasPetrol,
          hasDiesel: row.hasDiesel,
          hasCng: row.hasCng,
          petrolPrice: row.petrolPrice,
          dieselPrice: row.dieselPrice,
          cngPrice: row.cngPrice,
          timings: row.timings,
          directionsUrl: row.directionsUrl,
        },
        origin,
      ),
    )
    .filter((station) => station.distanceKm !== null && station.distanceKm <= query.radiusKm);
}

export async function searchPetrolStations(
  query: PetrolStationQuery,
): Promise<PetrolStationSearchResult> {
  const ttl = config.petrolStations.cacheTtlSeconds;
  const origin = { latitude: query.latitude, longitude: query.longitude };

  const compute = async (): Promise<Omit<PetrolStationSearchResult, 'cached'>> => {
    try {
      const response = await petrolStationProvider.search({
        latitude: query.latitude,
        longitude: query.longitude,
        radiusKm: query.radiusKm,
        limit: query.limit,
        fuelType: query.fuelType,
        company: query.company,
      });

      const stations = dedupe(
        response.stations
          .map((station) => fromProvider(station, origin))
          .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0)),
      ).slice(0, query.limit);

      await mirrorStations(response.stations);

      return {
        stations,
        totalWithinRadius: response.totalWithinRadius,
        radiusKm: query.radiusKm,
        stale: false,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      // Only an upstream outage is worth falling back for; a bad request from
      // the caller must still surface as a 4xx.
      const recoverable =
        isAppError(error) && (error.statusCode === 502 || error.statusCode === 503 || error.statusCode === 504);
      if (!recoverable) throw error;

      const fallback = dedupe(
        (await storedStations(query)).sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0)),
      ).slice(0, query.limit);

      if (fallback.length === 0) throw error;

      serviceLogger.warn(
        { count: fallback.length },
        'Petrol station directory unavailable — serving previously stored stations',
      );

      return {
        stations: fallback,
        totalWithinRadius: null,
        radiusKm: query.radiusKm,
        stale: true,
        retrievedAt: new Date().toISOString(),
      };
    }
  };

  if (ttl <= 0) return { ...(await compute()), cached: false };

  const key = cacheKey(query);
  const hit = await cache.get<Omit<PetrolStationSearchResult, 'cached'>>(key);
  if (hit) return { ...hit, cached: true };

  const fresh = await compute();
  // A stale (outage) answer is cached only briefly, so the map recovers as
  // soon as the directory does instead of holding the fallback for hours.
  await cache.set(key, fresh, fresh.stale ? Math.min(ttl, 120) : ttl);

  return { ...fresh, cached: false };
}
