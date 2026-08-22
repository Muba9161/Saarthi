import { cumulativeDistances, type LatLng } from '@saarthi/shared';
import { ORS_API_KEY, ORS_BASE_URL, isRoutingConfigured } from './map-config';

/**
 * Navigation services — OpenRouteService.
 *
 * ORS is open-source routing over OpenStreetMap with a free, card-free API key.
 * For a trucking platform its `driving-hgv` profile matters: it routes for a
 * heavy goods vehicle and respects weight, height and access restrictions that a
 * car profile happily ignores.
 *
 * The free plan allows a bounded number of requests per day, so every call goes
 * through a TTL cache plus an in-flight de-duplicator. Two components asking for
 * the same route in the same tick issue one HTTP request, and a route that has
 * not changed is never re-fetched while it is still warm.
 *
 * What ORS does not provide, and this module therefore does not pretend to:
 * live traffic. Durations are free-flow estimates, so nothing here reports a
 * traffic delay or a congestion colour.
 */

const API_BASE = ORS_BASE_URL;

/** `driving-hgv` is the truck profile and the right default for Saarthi. */
export type RoutingProfile =
  | 'driving-hgv'
  | 'driving-car'
  | 'cycling-regular'
  | 'foot-walking';

/** ORS accepts up to 50 coordinates per directions request. */
const MAX_WAYPOINTS = 50;

export class DirectionsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DirectionsError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface RouteManeuver {
  /** `turn`, `roundabout`, `arrive`, `depart`, `fork`, `continue`. */
  type: string;
  /** `left`, `slight right`, `uturn`, … or null when not a turn. */
  modifier: string | null;
  instruction: string;
  location: LatLng;
  bearingBefore: number;
  bearingAfter: number;
  /** Which exit to take out of a roundabout. */
  exit: number | null;
}

export interface RouteStep {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  /** Road name, e.g. "NH 48". */
  name: string;
  /** Route shield reference where the router supplies one. */
  ref: string | null;
  instruction: string;
  maneuver: RouteManeuver;
  /** Cumulative distance from the route origin to the END of this step. */
  distanceFromStartMeters: number;
  geometry: LatLng[];
}

export interface RouteLeg {
  summary: string;
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
}

export interface NavigationRoute {
  id: string;
  /** Full-resolution polyline, ready to hand to a GeoJSON source. */
  geometry: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  /**
   * Free-flow comparison duration. Always null on ORS, which has no traffic
   * model — kept on the type so a traffic-aware provider can fill it later.
   */
  durationTypicalSeconds: number | null;
  legs: RouteLeg[];
  /** Cumulative distance at each geometry vertex — reused for progress maths. */
  distancesAlong: number[];
  profile: RoutingProfile;
  /** Human summary of the roads used, e.g. "NH 48 · Ring Road". */
  summary: string;
}

export interface DirectionsResult {
  routes: NavigationRoute[];
  profile: RoutingProfile;
  fetchedAt: number;
}

export interface DirectionsOptions {
  profile?: RoutingProfile;
  /** Ask for alternatives alongside the primary route. */
  alternatives?: boolean;
  /** Road classes to avoid — trucks routinely exclude tolls or ferries. */
  exclude?: ('toll' | 'motorway' | 'ferry' | 'unpaved')[];
  language?: string;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Cache + de-duplication
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_LIMIT = 120;

class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(private readonly ttlMs: number) {}

  async resolve(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.entries.delete(key);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        // Bound the cache so a long session cannot grow it without limit.
        if (this.entries.size >= CACHE_LIMIT) {
          const oldest = this.entries.keys().next();
          if (!oldest.done) this.entries.delete(oldest.value);
        }
        this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Routing geometry is stable without a traffic model — hold it a good while. */
const routeCache = new TtlCache<DirectionsResult>(30 * 60 * 1000);
const geocodeCache = new TtlCache<GeocodeFeature[]>(60 * 60 * 1000);
/** A recorded trail never changes, so a snapped result stays valid all session. */
const snapCache = new TtlCache<LatLng[]>(6 * 60 * 60 * 1000);

/** Exposed for tests and for a manual "recalculate route" action. */
export function clearDirectionsCache(): void {
  routeCache.clear();
  snapCache.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireKey(): string {
  if (!isRoutingConfigured) {
    throw new DirectionsError(
      'MISSING_TOKEN',
      'Routing is not configured. Set VITE_ORS_API_KEY to a free OpenRouteService key.',
    );
  }
  return ORS_API_KEY;
}

/** ORS takes [longitude, latitude]. Six decimals is ~11 cm. */
function coordinatePair(point: LatLng): [number, number] {
  return [Number(point.longitude.toFixed(6)), Number(point.latitude.toFixed(6))];
}

function toLatLng(pair: unknown): LatLng | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const longitude = Number(pair[0]);
  const latitude = Number(pair[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { latitude, longitude };
}

interface RequestFailure {
  error?: { code?: number; message?: string };
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, signal ? { ...init, signal } : init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new DirectionsError('NETWORK', 'Could not reach the routing service.');
  }

  if (response.status === 401 || response.status === 403) {
    throw new DirectionsError('UNAUTHORISED', 'OpenRouteService rejected the API key.');
  }
  if (response.status === 429) {
    throw new DirectionsError(
      'RATE_LIMITED',
      'Daily routing quota reached — it resets 24 hours after your first request.',
    );
  }
  if (response.status === 400 || response.status === 404) {
    // ORS reports an unroutable pair as a 4xx carrying its own error body.
    const body = (await response.json().catch(() => ({}))) as RequestFailure;
    throw new DirectionsError(
      'NO_ROUTE',
      body.error?.message ?? 'No drivable route connects those points.',
    );
  }
  if (!response.ok) {
    throw new DirectionsError('HTTP_ERROR', `Routing request failed (${response.status}).`);
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Manoeuvre translation
// ---------------------------------------------------------------------------

/**
 * ORS encodes manoeuvres as integers. Translating them into the same
 * type/modifier vocabulary the UI already speaks keeps the icon mapping and the
 * navigation panel provider-agnostic.
 */
const MANEUVER_BY_TYPE: Record<number, { type: string; modifier: string | null }> = {
  0: { type: 'turn', modifier: 'left' },
  1: { type: 'turn', modifier: 'right' },
  2: { type: 'turn', modifier: 'sharp left' },
  3: { type: 'turn', modifier: 'sharp right' },
  4: { type: 'turn', modifier: 'slight left' },
  5: { type: 'turn', modifier: 'slight right' },
  6: { type: 'continue', modifier: 'straight' },
  7: { type: 'roundabout', modifier: null },
  8: { type: 'exit roundabout', modifier: null },
  9: { type: 'turn', modifier: 'uturn' },
  10: { type: 'arrive', modifier: null },
  11: { type: 'depart', modifier: null },
  12: { type: 'fork', modifier: 'slight left' },
  13: { type: 'fork', modifier: 'slight right' },
};

function translateManeuver(type: unknown): { type: string; modifier: string | null } {
  const code = typeof type === 'number' ? type : Number.NaN;
  return MANEUVER_BY_TYPE[code] ?? { type: 'continue', modifier: 'straight' };
}

/** Bearing between two vertices, because ORS supplies no per-step bearings. */
function bearingBetween(from: LatLng | undefined, to: LatLng | undefined): number {
  if (!from || !to) return 0;
  const toRadians = (value: number): number => (value * Math.PI) / 180;
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

interface RawOrsStep {
  distance?: number;
  duration?: number;
  type?: number;
  instruction?: string;
  name?: string;
  exit_number?: number;
  /** [firstGeometryIndex, lastGeometryIndex] into the route geometry. */
  way_points?: number[];
}

interface RawOrsSegment {
  distance?: number;
  duration?: number;
  steps?: RawOrsStep[];
}

interface RawOrsFeature {
  geometry?: { coordinates?: unknown[] };
  properties?: {
    summary?: { distance?: number; duration?: number };
    segments?: RawOrsSegment[];
  };
}

interface RawOrsResponse {
  features?: RawOrsFeature[];
  error?: { message?: string };
}

/** ORS uses "-" as its placeholder for an unnamed way. */
function roadName(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '-') return 'Unnamed road';
  return trimmed;
}

function parseFeature(
  feature: RawOrsFeature,
  index: number,
  profile: RoutingProfile,
): NavigationRoute {
  const geometry = (feature.geometry?.coordinates ?? [])
    .map(toLatLng)
    .filter((point): point is LatLng => point !== null);

  const properties = feature.properties ?? {};
  const legs: RouteLeg[] = [];
  const roadNames: string[] = [];

  let runningDistance = 0;
  let stepOrdinal = 0;

  for (const segment of properties.segments ?? []) {
    const steps: RouteStep[] = [];

    for (const rawStep of segment.steps ?? []) {
      const distanceMeters = Number(rawStep.distance ?? 0);
      const { type, modifier } = translateManeuver(rawStep.type);

      const waypoints = rawStep.way_points ?? [];
      const from = Math.max(0, Number(waypoints[0] ?? 0));
      const to = Math.max(from, Number(waypoints[1] ?? from));

      const location = geometry[from] ?? geometry[0] ?? { latitude: 0, longitude: 0 };
      const instruction = rawStep.instruction?.trim() || 'Continue';
      const name = roadName(rawStep.name);
      if (name !== 'Unnamed road') roadNames.push(name);

      runningDistance += distanceMeters;
      steps.push({
        id: `step-${stepOrdinal}`,
        distanceMeters,
        durationSeconds: Number(rawStep.duration ?? 0),
        name,
        ref: null,
        instruction,
        maneuver: {
          type,
          modifier,
          instruction,
          location,
          bearingBefore: bearingBetween(geometry[Math.max(0, from - 1)], geometry[from]),
          bearingAfter: bearingBetween(
            geometry[from],
            geometry[Math.min(to, Math.max(0, geometry.length - 1))],
          ),
          exit: typeof rawStep.exit_number === 'number' ? rawStep.exit_number : null,
        },
        distanceFromStartMeters: runningDistance,
        geometry: geometry.slice(from, to + 1),
      });
      stepOrdinal += 1;
    }

    legs.push({
      summary: '',
      distanceMeters: Number(segment.distance ?? 0),
      durationSeconds: Number(segment.duration ?? 0),
      steps,
    });
  }

  // The most-used road names read best as a route summary.
  const counts = new Map<string, number>();
  for (const name of roadNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  const summary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name)
    .join(' · ');

  return {
    id: `route-${index}`,
    geometry,
    distanceMeters: Number(properties.summary?.distance ?? 0),
    durationSeconds: Number(properties.summary?.duration ?? 0),
    durationTypicalSeconds: null,
    legs,
    distancesAlong: cumulativeDistances(geometry),
    profile,
    summary,
  };
}

/** ORS names its avoidance classes differently from the UI vocabulary. */
function toAvoidFeature(value: 'toll' | 'motorway' | 'ferry' | 'unpaved'): string {
  switch (value) {
    case 'toll':
      return 'tollways';
    case 'motorway':
      return 'highways';
    case 'ferry':
      return 'ferries';
    case 'unpaved':
      return 'steps';
  }
}

/** Keep first and last waypoint, spread the remainder evenly across the middle. */
function thinWaypoints(points: readonly LatLng[], limit: number): LatLng[] {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (limit <= 2) return [first, last];

  const middleSlots = limit - 2;
  const middle: LatLng[] = [];
  const step = (points.length - 1) / (middleSlots + 1);
  for (let index = 1; index <= middleSlots; index += 1) {
    const candidate = points[Math.round(index * step)];
    if (candidate) middle.push(candidate);
  }
  return [first, ...middle, last];
}

/**
 * Road-network route between two or more points, with turn-by-turn steps.
 * Defaults to the heavy-goods-vehicle profile, which is what a truck should be
 * routed on.
 */
export async function fetchDirections(
  waypoints: readonly LatLng[],
  options: DirectionsOptions = {},
): Promise<DirectionsResult> {
  const usable = waypoints.filter(
    (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
  );
  if (usable.length < 2) {
    throw new DirectionsError('TOO_FEW_WAYPOINTS', 'Routing needs at least two waypoints.');
  }

  const key = requireKey();
  const profile = options.profile ?? 'driving-hgv';
  const trimmed = usable.length <= MAX_WAYPOINTS ? usable : thinWaypoints(usable, MAX_WAYPOINTS);

  const body: Record<string, unknown> = {
    coordinates: trimmed.map(coordinatePair),
    instructions: true,
    instructions_format: 'text',
    language: options.language ?? 'en',
    units: 'm',
    preference: 'recommended',
    // Simplification would drop the vertices the progress maths projects onto.
    geometry_simplify: false,
  };

  // ORS only offers alternatives for a plain origin-to-destination request.
  if ((options.alternatives ?? true) && trimmed.length === 2) {
    body.alternative_routes = { target_count: 3, share_factor: 0.6, weight_factor: 1.6 };
  }
  if (options.exclude?.length) {
    body.options = { avoid_features: options.exclude.map(toAvoidFeature) };
  }

  const url = `${API_BASE}/v2/directions/${profile}/geojson`;
  const cacheKey = `${url}|${JSON.stringify(body)}`;

  return routeCache.resolve(cacheKey, async () => {
    const raw = await requestJson<RawOrsResponse>(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: key,
          'Content-Type': 'application/json',
          Accept: 'application/geo+json',
        },
        body: JSON.stringify(body),
      },
      options.signal,
    );

    const routes = (raw.features ?? []).map((feature, index) =>
      parseFeature(feature, index, profile),
    );
    if (routes.length === 0) {
      throw new DirectionsError('NO_ROUTE', 'No drivable route connects those points.');
    }

    return { routes, profile, fetchedAt: Date.now() };
  });
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

export interface GeocodeFeature {
  id: string;
  name: string;
  /** Full formatted address. */
  address: string;
  position: LatLng;
  /** `address`, `street`, `locality`, `venue`, … */
  kind: string;
}

interface RawGeocodeResponse {
  features?: {
    geometry?: { coordinates?: unknown };
    properties?: {
      id?: string;
      gid?: string;
      name?: string;
      label?: string;
      layer?: string;
    };
  }[];
}

function parseGeocodeFeatures(raw: RawGeocodeResponse): GeocodeFeature[] {
  return (raw.features ?? []).flatMap((feature, index) => {
    const position = toLatLng(feature.geometry?.coordinates);
    if (!position) return [];

    const properties = feature.properties ?? {};
    const name = properties.name?.trim() || properties.label?.trim() || 'Unnamed place';
    return [
      {
        id: properties.gid || properties.id || `geocode-${index}`,
        name,
        address: properties.label?.trim() || name,
        position,
        kind: properties.layer || 'place',
      },
    ];
  });
}

export interface GeocodeOptions {
  /** Bias results towards this point — usually the current map centre. */
  proximity?: LatLng;
  /** ISO 3166-1 alpha-3 code, which is what ORS geocoding expects. */
  country?: string;
  limit?: number;
  signal?: AbortSignal;
}

/** Place search — powers the map search box and address lookup on trip forms. */
export async function geocodeForward(
  query: string,
  options: GeocodeOptions = {},
): Promise<GeocodeFeature[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];
  const key = requireKey();

  const parameters = new URLSearchParams({
    api_key: key,
    text: trimmed,
    size: String(Math.min(10, Math.max(1, options.limit ?? 6))),
    'boundary.country': options.country ?? 'IND',
  });
  if (options.proximity) {
    parameters.set('focus.point.lon', options.proximity.longitude.toFixed(6));
    parameters.set('focus.point.lat', options.proximity.latitude.toFixed(6));
  }

  const url = `${API_BASE}/geocode/search?${parameters.toString()}`;
  return geocodeCache.resolve(url, async () =>
    parseGeocodeFeatures(
      await requestJson<RawGeocodeResponse>(url, { method: 'GET' }, options.signal),
    ),
  );
}

/** Address for a coordinate — used to label SOS incidents and trip stops. */
export async function geocodeReverse(
  position: LatLng,
  options: Pick<GeocodeOptions, 'signal'> = {},
): Promise<GeocodeFeature | null> {
  const key = requireKey();
  const parameters = new URLSearchParams({
    api_key: key,
    'point.lon': position.longitude.toFixed(6),
    'point.lat': position.latitude.toFixed(6),
    size: '1',
  });

  const url = `${API_BASE}/geocode/reverse?${parameters.toString()}`;
  const features = await geocodeCache.resolve(url, async () =>
    parseGeocodeFeatures(
      await requestJson<RawGeocodeResponse>(url, { method: 'GET' }, options.signal),
    ),
  );
  return features[0] ?? null;
}

// ---------------------------------------------------------------------------
// Map matching
// ---------------------------------------------------------------------------

interface RawSnapResponse {
  locations?: ({ location?: unknown; snapped_distance?: number } | null)[];
}

/** ORS Snap accepts up to 5,000 locations, but keep the payload sane. */
const MAX_SNAP_LOCATIONS = 500;

/**
 * Snap a raw GPS trail onto the road network.
 *
 * Consumer-grade GPS wanders across lanes and through buildings. ORS Snap V2
 * pulls each fix onto the nearest road within `radiusMeters`, which is what
 * makes a trip replay look credible instead of drunken.
 *
 * Note the limit honestly: this snaps points, it does not reconstruct the path
 * driven between them. Two fixes either side of a flyover still join with a
 * straight line — for true path reconstruction you want an OSRM `/match`
 * service, which this function is shaped to accept as a drop-in replacement.
 *
 * A fix with no road inside the radius comes back unsnapped rather than
 * dropped, so the trail never develops holes.
 */
export async function matchToRoads(
  trail: readonly LatLng[],
  options: { profile?: RoutingProfile; radiusMeters?: number; signal?: AbortSignal } = {},
): Promise<LatLng[]> {
  const usable = trail.filter(
    (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
  );
  if (usable.length < 2 || !isRoutingConfigured) return usable;

  const sampled =
    usable.length <= MAX_SNAP_LOCATIONS ? usable : thinWaypoints(usable, MAX_SNAP_LOCATIONS);

  const profile = options.profile ?? 'driving-hgv';
  const url = `${API_BASE}/v2/snap/${profile}/json`;
  const body = {
    locations: sampled.map(coordinatePair),
    radius: options.radiusMeters ?? 350,
  };

  try {
    const raw = await snapCache.resolve(`${url}|${JSON.stringify(body)}`, async () => {
      const response = await requestJson<RawSnapResponse>(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: ORS_API_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        },
        options.signal,
      );

      // Snap preserves input order and returns null where nothing was in range.
      return sampled.map((original, index) => {
        const snapped = toLatLng(response.locations?.[index]?.location);
        return snapped ?? original;
      });
    });
    return raw;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // Snapping is a polish step — never let it cost the user their trail.
    return sampled;
  }
}

/** Whether road-snapping is available, so callers can hide the option. */
export const isMapMatchingAvailable = isRoutingConfigured;
