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
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { cache, cached } from '../../infra/cache';
import { isAppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { placeProvider, type ProviderPlace } from '../../providers/places';
import type { AuthContext } from '../../auth/context';

/**
 * Nearby services and nearby Saarthi trucks.
 *
 * Places flow through the same three layers the petrol station directory uses:
 *
 *   viewport query → cache → provider → mirror in PostgreSQL
 *
 * The provider (OpenStreetMap via Overpass by default) is the source of truth
 * for what is actually on the ground. The `nearby_places` table is a mirror, so
 * a directory outage costs freshness rather than the feature, and an air-gapped
 * install can run on the mirror alone with `PLACES_PROVIDER=local`.
 *
 * Distance and compass direction are always measured here against the caller's
 * exact point — never taken from the provider — so a card that says "2.5 km NW"
 * says it about the driver's own position.
 */

const serviceLogger = logger.child({ module: 'nearby' });

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
  /** Opening hours exactly as the directory publishes them. */
  openingHours: string | null;
  attributes: unknown;
  distanceKm: number;
  direction: string;
  /**
   * Which directory the record came from — `osm` for OpenStreetMap, `local` for
   * Saarthi's own seeded corridor dataset. The UI needs this to credit the
   * source, which the ODbL requires wherever OSM data is shown.
   */
  source: string;
  /** True when the live directory could not be reached and the mirror answered. */
  stale: boolean;
}

interface StoredPlaceRow {
  id: string;
  externalId: string | null;
  category: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  rating: number | null;
  open24Hours: boolean;
  attributes: unknown;
  source: string;
}

/** Stable Saarthi id for a place, independent of the mirror row's database id. */
function placeId(source: string, externalId: string | null, fallback: string): string {
  return externalId ? `${source}:${externalId}` : `${source}:${fallback}`;
}

/**
 * `attributes` carries the directory's own tags. Opening hours are promoted to
 * their own field on the result, so read them back out of the bag for a
 * mirrored row rather than storing the same fact twice.
 */
function openingHoursOf(attributes: unknown): string | null {
  if (!attributes || typeof attributes !== 'object') return null;
  const value = (attributes as Record<string, unknown>).opening_hours;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** A place before it is measured from anybody — what the cache holds. */
type PlaceRecord = Omit<NearbyPlaceResult, 'distanceKm' | 'direction'>;

function measure(
  place: PlaceRecord,
  origin: { latitude: number; longitude: number },
): NearbyPlaceResult {
  const target = { latitude: place.latitude, longitude: place.longitude };
  return {
    ...place,
    distanceKm: Number(distanceKm(origin, target).toFixed(2)),
    direction: compassDirection(bearing(origin, target)),
  };
}

function fromProvider(place: ProviderPlace, source: string): PlaceRecord {
  return {
      id: placeId(source, place.externalId, place.externalId),
      category: place.category,
      name: place.name,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      phone: place.phone,
      // OpenStreetMap publishes no ratings, and a plausible invented number is
      // worse than none on a screen a driver acts on.
      rating: null,
      open24Hours: place.open24Hours,
      openingHours: place.openingHours,
      attributes: {
        ...place.attributes,
        ...(place.openingHours ? { opening_hours: place.openingHours } : {}),
      },
      source,
      stale: false,
  };
}

function fromStored(row: StoredPlaceRow, stale: boolean): PlaceRecord {
  return {
      id: placeId(row.source, row.externalId, row.id),
      category: row.category as NearbyCategory,
      name: row.name,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      phone: row.phone,
      rating: row.rating,
      open24Hours: row.open24Hours,
      openingHours: openingHoursOf(row.attributes),
      attributes: row.attributes,
      source: row.source,
      stale,
  };
}

/** How many of a search's places are kept in the mirror, nearest first. */
const MIRROR_LIMIT = 150;

/** Upserts in flight at once while mirroring, so a search never starves the pool. */
const MIRROR_BATCH = 10;

/**
 * Mirror the directory's answer into PostgreSQL, in the background.
 *
 * Best-effort by design and never awaited by a search: the caller already has
 * their places, and making a driver wait on a few hundred upserts before the
 * list appears is how the request used to outlast the app's own timeout. The
 * writes go in small batches for the same reason a search used to starve the
 * connection pool — hundreds of concurrent upserts for one query.
 */
function mirrorPlaces(source: string, places: ProviderPlace[]): void {
  if (places.length === 0) return;

  const record = (place: ProviderPlace) => ({
    category: place.category,
    name: place.name,
    address: place.address,
    city: place.city,
    state: place.state,
    latitude: place.latitude,
    longitude: place.longitude,
    phone: place.phone,
    open24Hours: place.open24Hours,
    attributes: {
      ...place.attributes,
      ...(place.openingHours ? { opening_hours: place.openingHours } : {}),
    } as object,
    active: true,
  });

  void (async () => {
    for (let start = 0; start < places.length; start += MIRROR_BATCH) {
      await Promise.all(
        places.slice(start, start + MIRROR_BATCH).map((place) =>
          prisma.nearbyPlace.upsert({
            where: { source_externalId: { source, externalId: place.externalId } },
            create: { source, externalId: place.externalId, ...record(place) },
            update: record(place),
          }),
        ),
      );
    }
  })().catch((error: unknown) => {
    serviceLogger.warn({ err: error }, 'Nearby places could not be mirrored to the database');
  });
}

interface AreaQuery {
  center: { latitude: number; longitude: number };
  radiusKm: number;
  categories: NearbyCategory[] | undefined;
  openNow: boolean | undefined;
}

/**
 * Previously mirrored places for this area — the provider-outage fallback, and
 * what an air-gapped install runs on permanently.
 *
 * `sources` narrows the read: while the live directory is answering, only its
 * own mirrored rows are blended in, so a seeded demo corridor never mixes
 * fictional dhabas into a list of real ones.
 */
async function storedPlaces(
  area: AreaQuery,
  options: { sources?: string[]; stale: boolean },
): Promise<PlaceRecord[]> {
  const { latDelta, lngDelta } = boundingDeltas(area.center.latitude, area.radiusKm * 1000);

  const rows = await prisma.nearbyPlace.findMany({
    where: {
      active: true,
      ...(options.sources ? { source: { in: options.sources } } : {}),
      ...(area.categories ? { category: { in: area.categories } } : {}),
      ...(area.openNow ? { open24Hours: true } : {}),
      latitude: { gte: area.center.latitude - latDelta, lte: area.center.latitude + latDelta },
      longitude: { gte: area.center.longitude - lngDelta, lte: area.center.longitude + lngDelta },
    },
    take: 2000,
  });

  return rows
    .filter((row) => distanceKm(area.center, row) <= area.radiusKm)
    .map((row) => fromStored(row, options.stale));
}

/** One copy of each place. The live copy is passed first and wins — it is the fresher. */
function unique(places: PlaceRecord[]): PlaceRecord[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    if (seen.has(place.id)) return false;
    seen.add(place.id);
    return true;
  });
}

/** Measured from the caller, inside their radius, nearest first. */
function rank(
  places: PlaceRecord[],
  origin: { latitude: number; longitude: number },
  radiusKm: number,
): NearbyPlaceResult[] {
  return places
    .map((place) => measure(place, origin))
    .filter((place) => place.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * The search tile a caller falls in: coordinates rounded to two places, ~1 km.
 *
 * The directory is asked from the tile's centre rather than the caller's exact
 * point, so the cached answer belongs to the tile and serves everybody in it.
 */
function tileOf(input: { latitude: number; longitude: number }) {
  return {
    latitude: Number(input.latitude.toFixed(2)),
    longitude: Number(input.longitude.toFixed(2)),
  };
}

/**
 * How much wider than the caller's radius a tile is searched.
 *
 * A caller can stand up to ~0.8 km from their tile's centre, so the tile is
 * searched that much wider; every place inside any caller's own radius is then
 * in the cached set, and the exact cut is made per caller.
 */
const TILE_PADDING_KM = 1;

/**
 * Cache key.
 *
 * Keyed on the tile, never the caller's exact point, and holding *unmeasured*
 * places. The cache used to hold distances and directions measured from
 * whichever driver asked first, and serve them for three hours to everyone in
 * the same square kilometre — so a second driver read "0.4 km NE" for a pump
 * that was 1.2 km to their south. `limit` is deliberately absent: the cached
 * list is the whole answer and callers take the head of it.
 */
function cacheKey(area: AreaQuery): string {
  return [
    'nearby-places:v2',
    placeProvider?.name ?? 'local',
    area.center.latitude.toFixed(2),
    area.center.longitude.toFixed(2),
    area.radiusKm,
    (area.categories ?? []).join(','),
    area.openNow ? '1' : '',
  ].join(':');
}

/** Every place in the tile's padded area, unmeasured, and whether it came from the mirror. */
async function placesInArea(
  area: AreaQuery,
  limit: number,
): Promise<{ places: PlaceRecord[]; stale: boolean }> {
  const provider = placeProvider;
  if (!provider) {
    // `PLACES_PROVIDER=local`: the mirror is the whole dataset, and it is not
    // stale — it is the configured source.
    return { places: await storedPlaces(area, { stale: false }), stale: false };
  }

  try {
    const response = await provider.search({
      latitude: area.center.latitude,
      longitude: area.center.longitude,
      radiusKm: area.radiusKm,
      categories: area.categories,
      limit,
    });

    const live = response.places
      .filter((place) => distanceKm(area.center, place) <= area.radiusKm)
      .map((place) => fromProvider(place, provider.name));

    // The provider caps how wide it will search (see OVERPASS_MAX_RADIUS_KM).
    // Its own mirrored rows cover the rest of the requested radius, and they
    // are the same data measured the same way — so the list stays whole
    // without ever mixing in another source.
    const beyondProviderReach = area.radiusKm > config.places.maxRadiusKm;
    const mirrored = beyondProviderReach
      ? await storedPlaces(area, { sources: [provider.name], stale: false })
      : [];

    // The nearest of the live answer, which is what an outage would need.
    mirrorPlaces(
      provider.name,
      [...response.places]
        .sort((a, b) => distanceKm(area.center, a) - distanceKm(area.center, b))
        .slice(0, MIRROR_LIMIT),
    );

    return { places: unique([...live, ...mirrored]), stale: false };
  } catch (error) {
    // Only an upstream outage is worth falling back for; a bad request from
    // the caller must still surface as a 4xx.
    const recoverable =
      isAppError(error) &&
      (error.statusCode === 502 || error.statusCode === 503 || error.statusCode === 504);
    if (!recoverable) throw error;

    /**
     * The outage fallback reads only the configured provider's own mirrored
     * rows — never Saarthi's seeded corridor dataset.
     *
     * That dataset is generated: invented names, invented phone numbers,
     * invented ratings. Showing a driver "Apollo Pharmacy 1" with a
     * fabricated number beside real survey data is worse than showing them a
     * short list, and far worse in an emergency. If the mirror is cold the
     * honest answer is nothing, and the UI says so.
     */
    const fallback = await storedPlaces(area, { sources: [provider.name], stale: true });

    // Nothing on record either. Surfacing the outage is the honest answer: an
    // empty list reads as "there is nothing around you", which is a very
    // different and possibly dangerous claim.
    if (fallback.length === 0) throw error;

    serviceLogger.warn(
      { count: fallback.length, source: provider.name },
      'Places directory unavailable — serving previously stored places',
    );

    return { places: fallback, stale: true };
  }
}

/**
 * Every place around the caller, nearest first — the whole answer, unsliced.
 *
 * Both the list and the category counts read from this, so a chip can never
 * promise more results than the list is able to show.
 */
async function collectNearbyPlaces(input: NearbySearchInput): Promise<NearbyPlaceResult[]> {
  const origin = { latitude: input.latitude, longitude: input.longitude };
  const area: AreaQuery = {
    center: tileOf(input),
    radiusKm: input.radiusKm + TILE_PADDING_KM,
    categories: input.category as NearbyCategory[] | undefined,
    openNow: input.openNow,
  };

  const ttl = config.places.cacheTtlSeconds;
  if (ttl <= 0) return rank((await placesInArea(area, input.limit)).places, origin, input.radiusKm);

  const key = cacheKey(area);
  const hit = await cache.get<PlaceRecord[]>(key);
  if (hit) return rank(hit, origin, input.radiusKm);

  const fresh = await placesInArea(area, input.limit);
  // A fallback answer is held only briefly, so the list recovers as soon as the
  // directory does instead of staying on the mirror for hours.
  await cache.set(key, fresh.places, fresh.stale ? Math.min(ttl, 120) : ttl);

  return rank(fresh.places, origin, input.radiusKm);
}

/**
 * Fill an unfiltered page so it answers "what services are around me".
 *
 * Straight distance order does not, once the data is real. A town centre can
 * put nine clinics inside 600 m, and the honest nearest-twelve is then twelve
 * clinics — every one of them correct, and useless to a driver who wanted to
 * know whether there is fuel, food or a tyre shop nearby. (The seeded corridor
 * dataset hid this by construction: it spread categories evenly, which real
 * geography does not.)
 *
 * So each category first contributes its nearest few, the remaining slots go to
 * whatever is closest regardless of category, and the result is sorted by
 * distance again — the page stays a distance-ordered list, it just cannot be
 * monopolised. A caller filtering to one category has already said what they
 * want and gets pure distance order.
 */
function diversify(places: NearbyPlaceResult[], limit: number): NearbyPlaceResult[] {
  if (places.length <= limit) return places;

  const categories = new Set(places.map((place) => place.category));
  // Two apiece at minimum: one is too thin to judge a category by.
  const perCategory = Math.max(2, Math.ceil(limit / Math.max(1, categories.size)));

  const taken = new Set<string>();
  const counts = new Map<NearbyCategory, number>();

  // `places` is already nearest-first, so the first ones seen per category are
  // that category's nearest.
  for (const place of places) {
    if (taken.size >= limit) break;
    const used = counts.get(place.category) ?? 0;
    if (used >= perCategory) continue;
    counts.set(place.category, used + 1);
    taken.add(place.id);
  }

  for (const place of places) {
    if (taken.size >= limit) break;
    taken.add(place.id);
  }

  return places.filter((place) => taken.has(place.id)).slice(0, limit);
}

export async function searchNearbyPlaces(
  input: NearbySearchInput,
): Promise<NearbyPlaceResult[]> {
  const places = await collectNearbyPlaces(input);

  const filteredToOneKind = (input.category ?? []).length > 0;
  return filteredToOneKind ? places.slice(0, input.limit) : diversify(places, input.limit);
}

/**
 * Category counts within the radius, for the driver's quick-filter chips.
 *
 * Counted from the same search the list is built from, so a chip never promises
 * results the list cannot show.
 */
export async function nearbyCategoryCounts(
  latitude: number,
  longitude: number,
  radiusKm: number,
): Promise<Record<string, number>> {
  const key = `nearby-counts:${placeProvider?.name ?? 'local'}:${latitude.toFixed(2)}:${longitude.toFixed(2)}:${radiusKm}`;

  return cached(key, Math.max(60, Math.min(config.places.cacheTtlSeconds, 900)), async () => {
    // The unsliced list: a chip counting only the first page would under-report
    // every category the page happened not to reach.
    const places = await collectNearbyPlaces({
      latitude,
      longitude,
      radiusKm,
      limit: 100,
      category: undefined,
      openNow: undefined,
    });

    const counts: Record<string, number> = {};
    for (const place of places) {
      counts[place.category] = (counts[place.category] ?? 0) + 1;
    }
    return counts;
  });
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
      const exact = { latitude: truck.lastLatitude!, longitude: truck.lastLongitude! };
      const sameFleet = truck.organizationId === auth.organizationId;
      const assignment = truck.assignments[0];
      // Another fleet's truck is placed, measured and bearing-ed from the same
      // rounded point it is drawn at. An exact distance beside a rounded pin
      // gives the pin away: measure from three spots and the truck is found.
      const position = sameFleet
        ? exact
        : {
            latitude: Number(exact.latitude.toFixed(PRIVACY_PRECISION)),
            longitude: Number(exact.longitude.toFixed(PRIVACY_PRECISION)),
          };

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
        latitude: position.latitude,
        longitude: position.longitude,
        lastSeenAt: (truck.lastLocationAt ?? truck.updatedAt).toISOString(),
      };
    })
    .filter((truck) => truck.distanceKm <= input.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, input.limit);
}
