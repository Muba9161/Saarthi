import type { LatLng } from '@saarthi/shared';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import {
  RoutingError,
  type PlaceMatch,
  type RoadDistance,
  type Route,
  type RouteRequest,
  type RouteStep,
  type RoutingProfile,
  type RoutingProvider,
} from './routing.provider';

/**
 * OpenRouteService.
 *
 * The same router the web app already uses, moved server-side for the terminal.
 * That move is the point: the browser can hold the key because the key is
 * scoped to a browser session and the user could read it from devtools anyway,
 * but a tablet bolted into a truck is a device that gets sold, stolen and
 * factory-reset, and section 6 of the terminal specification is explicit that
 * backend secrets must not be embedded in the APK. So the terminal asks Saarthi,
 * and Saarthi asks ORS.
 *
 * Free-flow durations only. ORS has no traffic model, and this provider does not
 * invent one — an ETA here is "how long this takes on an empty road", and the
 * terminal labels it as an estimate rather than a promise.
 */

const ROUTING_LOGGER = logger.child({ module: 'routing:ors' });

/** ORS manoeuvre codes → the vocabulary the UI already speaks. */
const MANEUVER_BY_CODE: Record<number, { maneuver: string; modifier: string | null }> = {
  0: { maneuver: 'turn', modifier: 'left' },
  1: { maneuver: 'turn', modifier: 'right' },
  2: { maneuver: 'turn', modifier: 'sharp left' },
  3: { maneuver: 'turn', modifier: 'sharp right' },
  4: { maneuver: 'turn', modifier: 'slight left' },
  5: { maneuver: 'turn', modifier: 'slight right' },
  6: { maneuver: 'continue', modifier: 'straight' },
  7: { maneuver: 'roundabout', modifier: null },
  8: { maneuver: 'exit roundabout', modifier: null },
  9: { maneuver: 'turn', modifier: 'uturn' },
  10: { maneuver: 'arrive', modifier: null },
  11: { maneuver: 'depart', modifier: null },
  12: { maneuver: 'fork', modifier: 'slight left' },
  13: { maneuver: 'fork', modifier: 'slight right' },
};

interface RawStep {
  distance?: number;
  duration?: number;
  type?: number;
  instruction?: string;
  name?: string;
  way_points?: number[];
}

interface RawResponse {
  features?: {
    geometry?: { coordinates?: unknown[] };
    properties?: {
      summary?: { distance?: number; duration?: number };
      segments?: { distance?: number; duration?: number; steps?: RawStep[] }[];
    };
  }[];
  error?: { message?: string };
}

/** Only the fields used. ORS returns a full GeoJSON feature collection. */
interface RawGeocodeResponse {
  features?: {
    geometry?: { coordinates?: [number, number] };
    properties?: {
      name?: string;
      label?: string;
      street?: string;
      locality?: string;
      region?: string;
      /** Kilometres from `focus.point`, when ORS chose to compute one. */
      distance?: number;
    };
  }[];
}

interface RawMatrixResponse {
  distances?: (number | null)[][];
  durations?: (number | null)[][];
  error?: { message?: string };
}

export class OrsRoutingProvider implements RoutingProvider {
  readonly name = 'openrouteservice';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = config.maps.routingBaseUrl.replace(/\/+$/, '');
    this.timeoutMs = config.maps.routingTimeoutMs;
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  async route(request: RouteRequest): Promise<Route> {
    const body: Record<string, unknown> = {
      coordinates: [pair(request.from), pair(request.to)],
      instructions: true,
      instructions_format: 'text',
      language: 'en',
      units: 'm',
      preference: 'recommended',
      // Simplification drops vertices, and the terminal projects the vehicle's
      // position onto this line to decide which turn is next.
      geometry_simplify: false,
    };

    if (request.avoid?.length) {
      body.options = {
        avoid_features: request.avoid.map((feature) =>
          feature === 'toll' ? 'tollways' : feature === 'ferry' ? 'ferries' : 'highways',
        ),
      };
    }

    const raw = await this.post<RawResponse>(
      `/v2/directions/${request.profile}/geojson`,
      body,
      'application/geo+json',
    );

    const feature = raw.features?.[0];
    if (!feature) {
      throw new RoutingError('NO_ROUTE', 'No drivable route connects those points.');
    }

    return parseRoute(feature, request.profile);
  }

  // -------------------------------------------------------------------------
  // Matrix
  // -------------------------------------------------------------------------

  /**
   * One request, many destinations.
   *
   * This is why a services list can show road distances at all. Twenty
   * directions calls would spend twenty times the daily budget to produce
   * twenty polylines the driver never asked to see; one matrix call answers the
   * only question the list is asking — how far is each of these, really.
   */
  async distances(
    from: LatLng,
    to: readonly LatLng[],
    profile: RoutingProfile,
  ): Promise<RoadDistance[]> {
    if (to.length === 0) return [];

    const capped = to.slice(0, MAX_MATRIX_DESTINATIONS);

    const raw = await this.post<RawMatrixResponse>(`/v2/matrix/${profile}`, {
      locations: [pair(from), ...capped.map(pair)],
      sources: [0],
      destinations: capped.map((_, index) => index + 1),
      metrics: ['distance', 'duration'],
      units: 'm',
    });

    const distanceRow = raw.distances?.[0] ?? [];
    const durationRow = raw.durations?.[0] ?? [];

    // One entry per destination *as supplied*, including the ones past the cap.
    // A caller zipping this against its own list has to be able to trust the
    // positions, so a short array is never returned — the overflow is null,
    // which the caller renders as "not measured" rather than as a distance.
    return to.map((_, index) => {
      if (index >= capped.length) {
        return { index, distanceMeters: null, durationSeconds: null };
      }
      const distance = distanceRow[index];
      const duration = durationRow[index];
      return {
        index,
        distanceMeters: typeof distance === 'number' ? distance : null,
        durationSeconds: typeof duration === 'number' ? duration : null,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  /**
   * Named places near the driver.
   *
   * `/geocode/autocomplete` rather than `/geocode/search`: it is built for
   * partial input, which is what a driver typing on a tablet in a moving cab
   * actually produces. `focus.point` biases towards them without excluding
   * anything, so "MG Road" finds the one in this city first while a genuinely
   * distant match is still reachable.
   *
   * `boundary.country=IND` is deliberate. Saarthi runs Indian fleets, and
   * without it a search for a common name returns half of it from other
   * continents — results a driver has to read past every time.
   */
  async searchPlaces(query: string, near: LatLng, limit: number): Promise<PlaceMatch[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const params = new URLSearchParams({
      api_key: this.apiKey,
      text: trimmed,
      'focus.point.lat': near.latitude.toFixed(6),
      'focus.point.lon': near.longitude.toFixed(6),
      'boundary.country': 'IND',
      size: String(Math.min(Math.max(limit, 1), 20)),
    });

    const raw = await this.get<RawGeocodeResponse>(`/geocode/autocomplete?${params.toString()}`);

    return (raw.features ?? []).flatMap((feature) => {
      const [longitude, latitude] = feature.geometry?.coordinates ?? [];
      if (typeof latitude !== 'number' || typeof longitude !== 'number') return [];

      const properties = feature.properties ?? {};
      // `label` carries the locality; `name` alone is ambiguous between the six
      // places in a city that share it.
      const name = properties.name ?? properties.label ?? trimmed;
      const address = [properties.street, properties.locality, properties.region]
        .filter((part): part is string => Boolean(part) && part !== name)
        .join(', ');

      return [
        {
          name,
          address: address || properties.label || null,
          latitude,
          longitude,
          distanceMeters:
            typeof properties.distance === 'number'
              ? Math.round(properties.distance * 1000)
              : null,
        },
      ];
    });
  }

  private async post<T>(
    path: string,
    body: unknown,
    accept = 'application/json',
  ): Promise<T> {
    return this.send<T>(path, {
      method: 'POST',
      headers: {
        authorization: this.apiKey,
        'content-type': 'application/json',
        accept,
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * A GET, for the endpoints that only take one.
   *
   * The geocoder authenticates by query parameter rather than by header, so the
   * key is already in the path and nothing is added here.
   */
  private async get<T>(path: string): Promise<T> {
    return this.send<T>(path, { method: 'GET', headers: { accept: 'application/json' } });
  }

  /**
   * One request, and one place that knows what each failure means.
   *
   * Split out from `post` when the geocoder arrived: a rejected key, an
   * exhausted quota and an unroutable pair have to read the same whichever
   * endpoint produced them, and two copies of that mapping would have drifted
   * the first time one of them was corrected.
   */
  private async send<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      // A timeout or a DNS failure. Reported as unavailable rather than as "no
      // route": the difference is whether the driver should try again.
      ROUTING_LOGGER.warn({ err: (error as Error).name, path }, 'Routing request failed');
      throw new RoutingError('UNAVAILABLE', 'The routing service could not be reached.');
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      /*
       * A key was supplied and refused — which is a different fault from no key
       * at all, and the two must not read the same.
       *
       * "Routing is not available on this Saarthi instance" was the old wording,
       * and it sent somebody looking for an unconfigured feature while a
       * perfectly configured key sat in the environment being rejected on every
       * request. ORS answers a wrong, revoked or plan-restricted key with
       * `Access to this API has been disallowed`, and repeating its own words is
       * what turns a silent fallback into something fixable.
       */
      const body = (await response.json().catch(() => ({}))) as {
        error?: string | { message?: string };
      };
      const reason =
        typeof body.error === 'string' ? body.error : body.error?.message ?? 'no reason given';

      ROUTING_LOGGER.error(
        { status: response.status, reason },
        'OpenRouteService rejected the configured API key — check ORS_API_KEY',
      );
      throw new RoutingError(
        'UNAUTHORISED',
        `The routing key was rejected by OpenRouteService (${reason}). ` +
          'Distances shown are straight-line until it is replaced.',
      );
    }

    if (response.status === 429) {
      ROUTING_LOGGER.warn('OpenRouteService daily routing quota reached');
      throw new RoutingError(
        'RATE_LIMITED',
        'The daily routing allowance has been used up. Distances shown are straight-line.',
      );
    }

    if (response.status === 400 || response.status === 404) {
      // ORS reports an unroutable pair as a 4xx with its own error body.
      const failure = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new RoutingError(
        'NO_ROUTE',
        failure.error?.message ?? 'No drivable route connects those points.',
      );
    }

    if (!response.ok) {
      throw new RoutingError('UNAVAILABLE', `The routing service answered ${response.status}.`);
    }

    /*
     * A 200 is not a promise of JSON.
     *
     * ORS sits behind a gateway that occasionally answers a perfectly good
     * request with an HTML holding page carrying a 200, and `response.json()`
     * throws a SyntaxError on it. That escaped as an unhandled error, and the
     * driver's search box — which had returned the same query correctly a
     * moment earlier — reported a server fault. Everything else in this method
     * turns a failure into a `RoutingError` the caller can phrase for a
     * driver; this was the one exit that did not.
     *
     * The first part of the body is logged because the status alone says
     * nothing about which gateway answered, and it is the only way to tell an
     * outage page from a truncated response.
     */
    const body = await response.text();
    try {
      return JSON.parse(body) as T;
    } catch {
      ROUTING_LOGGER.warn(
        { path: path.split('?')[0], body: body.slice(0, 200) },
        'OpenRouteService answered 200 with something that is not JSON',
      );
      throw new RoutingError(
        'UNAVAILABLE',
        'The routing service gave an unreadable answer. Please try again.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * ORS caps a matrix at 3,500 routed pairs on the free plan, but the real
 * constraint here is smaller and different: a services list a driver reads at a
 * glance is a dozen entries, and asking for a hundred spends budget on rows
 * nobody scrolls to.
 */
const MAX_MATRIX_DESTINATIONS = 25;

/** ORS takes [longitude, latitude]. Six decimals is about 11 cm. */
function pair(point: LatLng): [number, number] {
  return [Number(point.longitude.toFixed(6)), Number(point.latitude.toFixed(6))];
}

function toLatLng(value: unknown): LatLng | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { latitude, longitude };
}

/** ORS uses "-" for an unnamed way. */
function roadName(value: string | undefined): string {
  const trimmed = value?.trim();
  return !trimmed || trimmed === '-' ? 'Unnamed road' : trimmed;
}

function parseRoute(
  feature: NonNullable<RawResponse['features']>[number],
  profile: RoutingProfile,
): Route {
  const geometry = (feature.geometry?.coordinates ?? [])
    .map(toLatLng)
    .filter((point): point is LatLng => point !== null);

  const properties = feature.properties ?? {};
  const steps: RouteStep[] = [];
  const roadNames: string[] = [];

  for (const segment of properties.segments ?? []) {
    for (const rawStep of segment.steps ?? []) {
      const code = typeof rawStep.type === 'number' ? rawStep.type : Number.NaN;
      const { maneuver, modifier } = MANEUVER_BY_CODE[code] ?? {
        maneuver: 'continue',
        modifier: 'straight',
      };

      const waypoints = rawStep.way_points ?? [];
      const from = Math.max(0, Number(waypoints[0] ?? 0));

      const name = roadName(rawStep.name);
      if (name !== 'Unnamed road') roadNames.push(name);

      steps.push({
        distanceMeters: Number(rawStep.distance ?? 0),
        durationSeconds: Number(rawStep.duration ?? 0),
        name,
        instruction: rawStep.instruction?.trim() || 'Continue',
        maneuver,
        modifier,
        at: geometry[from] ?? geometry[0] ?? { latitude: 0, longitude: 0 },
      });
    }
  }

  // The most-used road names read best as a summary — "NH 48 · Ring Road" tells
  // a driver more about a route than its length does.
  const counts = new Map<string, number>();
  for (const name of roadNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  const summary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name)
    .join(' · ');

  return {
    distanceMeters: Number(properties.summary?.distance ?? 0),
    durationSeconds: Number(properties.summary?.duration ?? 0),
    geometry,
    steps,
    summary,
    profile,
  };
}
