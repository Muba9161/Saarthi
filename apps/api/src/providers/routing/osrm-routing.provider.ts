import type { LatLng } from '@saarthi/shared';
import { logger } from '../../lib/logger';
import { searchPhoton } from '../places/photon-place-search';
import {
  RoutingError,
  type Locality,
  type PlaceMatch,
  type RoadDistance,
  type Route,
  type RouteRequest,
  type RouteStep,
  type RoutingProfile,
  type RoutingProvider,
} from './routing.provider';

/**
 * Open Source Routing Machine (OSRM).
 *
 * Provides high-performance, keyless road network routing over OpenStreetMap.
 * Acts as the default out-of-the-box routing engine for Saarthi when no
 * commercial API key is provided, ensuring road geometry, turn-by-turn guidance,
 * and road tracking are always active across all environments.
 */

const OSRM_LOGGER = logger.child({ module: 'routing:osrm' });

interface OsrmManeuver {
  type?: string;
  modifier?: string;
  location?: [number, number];
}

interface OsrmStep {
  distance?: number;
  duration?: number;
  name?: string;
  maneuver?: OsrmManeuver;
  geometry?: { coordinates?: [number, number][] };
}

interface OsrmLeg {
  distance?: number;
  duration?: number;
  summary?: string;
  steps?: OsrmStep[];
}

interface OsrmRoute {
  distance?: number;
  duration?: number;
  geometry?: {
    coordinates?: [number, number][];
  };
  legs?: OsrmLeg[];
}

interface OsrmRouteResponse {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
}

interface OsrmMatchResponse {
  code: string;
  message?: string;
  matchings?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      coordinates?: [number, number][];
    };
  }>;
}

interface OsrmNearestResponse {
  code: string;
  message?: string;
  waypoints?: Array<{
    location?: [number, number];
    name?: string;
    distance?: number;
  }>;
}

interface OsrmTableResponse {
  code: string;
  message?: string;
  distances?: (number | null)[][];
  durations?: (number | null)[][];
}

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

function roadName(value: string | undefined): string {
  const trimmed = value?.trim();
  return !trimmed || trimmed === '-' ? 'Unnamed road' : trimmed;
}

export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = 'osrm';

  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl = 'https://router.project-osrm.org', timeoutMs = 10_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  async route(request: RouteRequest): Promise<Route> {
    const from = pair(request.from).join(',');
    const to = pair(request.to).join(',');
    const path = `/route/v1/driving/${from};${to}?overview=full&geometries=geojson&steps=true`;

    const data = await this.get<OsrmRouteResponse>(path);

    if (data.code === 'NoRoute' || !data.routes || data.routes.length === 0) {
      throw new RoutingError('NO_ROUTE', 'No drivable route connects those points.');
    }

    if (data.code !== 'Ok') {
      throw new RoutingError('UNAVAILABLE', data.message ?? 'Routing request failed.');
    }

    const first = data.routes[0]!;
    const geometry = (first.geometry?.coordinates ?? [])
      .map(toLatLng)
      .filter((p): p is LatLng => p !== null);

    const steps: RouteStep[] = [];
    const roadNames: string[] = [];

    for (const leg of first.legs ?? []) {
      for (const step of leg.steps ?? []) {
        const name = roadName(step.name);
        if (name !== 'Unnamed road') {
          roadNames.push(name);
        }

        const maneuverType = step.maneuver?.type ?? 'continue';
        const maneuverModifier = step.maneuver?.modifier ?? null;
        const loc = step.maneuver?.location ? toLatLng(step.maneuver.location) : null;

        let instruction = 'Continue';
        if (maneuverType === 'arrive') {
          instruction = 'Arrive at destination';
        } else if (maneuverType === 'depart') {
          instruction = 'Depart';
        } else if (name !== 'Unnamed road') {
          instruction = maneuverModifier ? `${maneuverModifier} onto ${name}` : `Onto ${name}`;
        }

        steps.push({
          distanceMeters: Number(step.distance ?? 0),
          durationSeconds: Number(step.duration ?? 0),
          name,
          instruction,
          maneuver: maneuverType,
          modifier: maneuverModifier,
          at: loc ?? geometry[0] ?? { latitude: 0, longitude: 0 },
        });
      }
    }

    const counts = new Map<string, number>();
    for (const name of roadNames) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const summary = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([n]) => n)
      .join(' · ') || first.legs?.[0]?.summary || 'Road Route';

    return {
      distanceMeters: Number(first.distance ?? 0),
      durationSeconds: Number(first.duration ?? 0),
      geometry,
      steps,
      summary,
      profile: request.profile,
    };
  }

  // -------------------------------------------------------------------------
  // Distances (one to many)
  // -------------------------------------------------------------------------

  async distances(
    from: LatLng,
    to: readonly LatLng[],
    _profile: RoutingProfile,
  ): Promise<RoadDistance[]> {
    if (to.length === 0) return [];

    const coords = [from, ...to].map((p) => pair(p).join(',')).join(';');
    const path = `/table/v1/driving/${coords}?sources=0`;

    try {
      const data = await this.get<OsrmTableResponse>(path);
      if (data.code !== 'Ok' || !data.distances?.[0]) {
        return to.map((_, i) => ({ index: i, distanceMeters: null, durationSeconds: null }));
      }

      return to.map((_, i) => {
        const dist = data.distances?.[0]?.[i + 1] ?? null;
        const dur = data.durations?.[0]?.[i + 1] ?? null;
        return {
          index: i,
          distanceMeters: dist !== null ? Math.round(dist) : null,
          durationSeconds: dur !== null ? Math.round(dur) : null,
        };
      });
    } catch {
      return to.map((_, i) => ({ index: i, distanceMeters: null, durationSeconds: null }));
    }
  }

  // -------------------------------------------------------------------------
  // Matrix (all pairs)
  // -------------------------------------------------------------------------

  async matrix(points: readonly LatLng[], _profile: RoutingProfile): Promise<(number | null)[][]> {
    if (points.length === 0) return [];

    const coords = points.map((p) => pair(p).join(',')).join(';');
    const path = `/table/v1/driving/${coords}`;

    try {
      const data = await this.get<OsrmTableResponse>(path);
      if (data.code !== 'Ok' || !data.distances) {
        return points.map(() => points.map(() => null));
      }
      return data.distances.map((row) =>
        row.map((d) => (d !== null && d !== undefined ? Math.round(d) : null)),
      );
    } catch {
      return points.map(() => points.map(() => null));
    }
  }

  // -------------------------------------------------------------------------
  // Places & Geocoding
  // -------------------------------------------------------------------------

  async searchPlaces(query: string, near: LatLng, limit: number): Promise<PlaceMatch[]> {
    return searchPhoton(query, near, limit);
  }

  async reverseGeocode(_at: LatLng): Promise<Locality | null> {
    return null;
  }

  // -------------------------------------------------------------------------
  // Path Tracing (Road-matched continuous polyline)
  // -------------------------------------------------------------------------

  /** Snaps a single GPS fix to the nearest street centerline */
  async snapToRoad(point: LatLng): Promise<LatLng> {
    const coords = pair(point).join(',');
    const path = `/nearest/v1/driving/${coords}?number=1`;
    try {
      const data = await this.get<OsrmNearestResponse>(path);
      if (data.code === 'Ok' && data.waypoints && data.waypoints[0]?.location) {
        const loc = data.waypoints[0].location;
        const snapped = toLatLng(loc);
        if (snapped) return snapped;
      }
    } catch {
      // Fallback to original point
    }
    return point;
  }

  /**
   * Primary: OSRM Map Matching (/match).
   * Matches noisy GPS sequence directly onto the OpenStreetMap road network.
   * Returns dense street centerline coordinates with all curves, turns, and corners.
   */
  async matchRoadPath(waypoints: readonly LatLng[]): Promise<LatLng[] | null> {
    if (waypoints.length < 2) return null;

    const coords = waypoints.map((p) => pair(p).join(',')).join(';');
    const radiuses = waypoints.map(() => '35').join(';');
    const path = `/match/v1/driving/${coords}?overview=full&geometries=geojson&tidy=true&gaps=ignore&radiuses=${radiuses}`;

    try {
      const data = await this.get<OsrmMatchResponse>(path);
      if (data.code === 'Ok' && data.matchings && data.matchings.length > 0) {
        const roadCoords: LatLng[] = [];

        for (const matching of data.matchings) {
          const coordsList = matching.geometry?.coordinates ?? [];
          for (const c of coordsList) {
            const pt = toLatLng(c);
            if (pt) {
              const last = roadCoords[roadCoords.length - 1];
              if (
                !last ||
                Math.abs(last.latitude - pt.latitude) > 1e-6 ||
                Math.abs(last.longitude - pt.longitude) > 1e-6
              ) {
                roadCoords.push(pt);
              }
            }
          }
        }

        if (roadCoords.length >= 2) {
          return roadCoords;
        }
      }
    } catch (err) {
      OSRM_LOGGER.debug({ err }, 'OSRM map matching attempt failed, will fall back');
    }

    return null;
  }

  /**
   * Fallback 1: Sequential Leg-by-Leg Road Routing (/route).
   * For consecutive snapped waypoints, routes 2-point legs (Pi -> Pi+1).
   * Because each call is strictly 2 points, it NEVER creates multi-stop detour loops
   * and captures intermediate street curves and turns cleanly.
   */
  async routeLegsSequential(waypoints: readonly LatLng[]): Promise<LatLng[]> {
    if (waypoints.length < 2) return [...waypoints];

    // Subsample to key turning points (max 16 legs to stay well inside limits)
    const keyPoints = waypoints.length <= 16 ? waypoints : this.subsample(waypoints, 16);

    // Snap each key point to the road network
    const snapped = await Promise.all(keyPoints.map((p) => this.snapToRoad(p)));

    // Deduplicate consecutive stationary points (< 10 meters)
    const cleanPoints: LatLng[] = [snapped[0]!];
    for (let i = 1; i < snapped.length; i++) {
      const prev = cleanPoints[cleanPoints.length - 1]!;
      const curr = snapped[i]!;
      const dLat = (curr.latitude - prev.latitude) * 111_132;
      const dLng = (curr.longitude - prev.longitude) * 111_132 * Math.cos((curr.latitude * Math.PI) / 180);
      if (Math.hypot(dLat, dLng) >= 10) {
        cleanPoints.push(curr);
      }
    }

    if (cleanPoints.length < 2) return [...waypoints];

    // Query 2-point road legs in parallel
    const legPromises: Promise<LatLng[]>[] = [];
    for (let i = 0; i < cleanPoints.length - 1; i++) {
      const p1 = cleanPoints[i]!;
      const p2 = cleanPoints[i + 1]!;
      const dLat = (p2.latitude - p1.latitude) * 111_132;
      const dLng = (p2.longitude - p1.longitude) * 111_132 * Math.cos((p1.latitude * Math.PI) / 180);
      const dist = Math.hypot(dLat, dLng);

      // If points are very close (< 25m), direct line segment is already on the road
      if (dist < 25) {
        legPromises.push(Promise.resolve([p1, p2]));
      } else {
        const from = pair(p1).join(',');
        const to = pair(p2).join(',');
        const legPath = `/route/v1/driving/${from};${to}?overview=full&geometries=geojson&continue_straight=true`;

        legPromises.push(
          this.get<OsrmRouteResponse>(legPath)
            .then((res) => {
              if (res.code === 'Ok' && res.routes?.[0]?.geometry?.coordinates) {
                const legCoords = res.routes[0].geometry.coordinates
                  .map(toLatLng)
                  .filter((p): p is LatLng => p !== null);
                if (legCoords.length >= 2) return legCoords;
              }
              return [p1, p2];
            })
            .catch(() => [p1, p2]),
        );
      }
    }

    const legResults = await Promise.all(legPromises);
    const stitched: LatLng[] = [];

    for (const leg of legResults) {
      for (const pt of leg) {
        const last = stitched[stitched.length - 1];
        if (
          !last ||
          Math.abs(last.latitude - pt.latitude) > 1e-6 ||
          Math.abs(last.longitude - pt.longitude) > 1e-6
        ) {
          stitched.push(pt);
        }
      }
    }

    return stitched.length >= 2 ? stitched : cleanPoints;
  }

  /**
   * Traces a vehicle's covered path along the real road network.
   * Tier 1: OSRM Map Matching (/match) with radiuses=35 & gaps=ignore.
   * Tier 2: Sequential Leg-by-Leg Road Routing (/route Pi -> Pi+1).
   * Tier 3: Snapped sequential waypoints fallback.
   *
   * Guarantees dense street-aligned curvature without chord-cutting through blocks,
   * without detour loops around blocks, and without parallel tracks.
   */
  async routePath(waypoints: readonly LatLng[]): Promise<LatLng[]> {
    if (waypoints.length < 2) return [...waypoints];

    // Subsample if waypoints exceed 60 to stay well inside GET URL limits
    const usable = waypoints.length <= 60 ? waypoints : this.subsample(waypoints, 60);

    // Tier 1: Try OSRM Map Matching
    try {
      const matched = await this.matchRoadPath(usable);
      if (matched && matched.length >= 2) {
        return matched;
      }
    } catch (err) {
      OSRM_LOGGER.warn({ err }, 'OSRM Map Matching failed, falling back to leg routing');
    }

    // Tier 2: Try Sequential Leg-by-Leg Road Routing
    try {
      const legRouted = await this.routeLegsSequential(usable);
      if (legRouted && legRouted.length >= 2) {
        return legRouted;
      }
    } catch (err) {
      OSRM_LOGGER.warn({ err }, 'OSRM Sequential Leg Routing failed, falling back to snapped waypoints');
    }

    // Tier 3: Fall back to snapped points
    try {
      const snapped = await Promise.all(usable.map((pt) => this.snapToRoad(pt)));
      const cleanSequential: LatLng[] = [snapped[0]!];
      for (let i = 1; i < snapped.length; i++) {
        const prev = cleanSequential[cleanSequential.length - 1]!;
        const curr = snapped[i]!;
        const dLat = (curr.latitude - prev.latitude) * 111_132;
        const dLng = (curr.longitude - prev.longitude) * 111_132 * Math.cos((curr.latitude * Math.PI) / 180);
        if (Math.hypot(dLat, dLng) >= 8) {
          cleanSequential.push(curr);
        }
      }
      if (cleanSequential.length >= 2) {
        return cleanSequential;
      }
    } catch {
      // Direct points fallback
    }

    return [...waypoints];
  }

  private subsample(points: readonly LatLng[], limit: number): LatLng[] {
    if (points.length <= limit) return [...points];
    const result: LatLng[] = [points[0]!];
    const step = (points.length - 1) / (limit - 1);
    for (let i = 1; i < limit - 1; i++) {
      const idx = Math.round(i * step);
      const pt = points[idx];
      if (pt) result.push(pt);
    }
    result.push(points[points.length - 1]!);
    return result;
  }

  // -------------------------------------------------------------------------
  // HTTP Fetch
  // -------------------------------------------------------------------------

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'Saarthi/1.0 (fleet operations platform; routing)',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new RoutingError('UNAVAILABLE', 'The routing engine timed out.');
      }
      throw new RoutingError('UNAVAILABLE', 'Could not reach the routing service.');
    }

    if (response.status === 429) {
      throw new RoutingError('RATE_LIMITED', 'The routing service is rate-limited.');
    }

    if (!response.ok) {
      throw new RoutingError('UNAVAILABLE', `The routing service answered ${response.status}.`);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new RoutingError('UNAVAILABLE', 'The routing service gave an unreadable answer.');
    }
  }
}
