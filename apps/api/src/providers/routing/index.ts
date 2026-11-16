import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { OrsRoutingProvider } from './ors-routing.provider';
import { OsrmRoutingProvider } from './osrm-routing.provider';
import {
  RoutingError,
  type Locality,
  type PlaceMatch,
  type RoadDistance,
  type Route,
  type RouteRequest,
  type RoutingProfile,
  type RoutingProvider,
} from './routing.provider';

/**
 * Resilient routing provider.
 *
 * Wraps the primary router (e.g. OpenRouteService) with a keyless OSRM fallback.
 * If the primary router runs out of daily quota (429 RATE_LIMITED) or experiences
 * temporary downtime, requests seamlessly route through OSRM rather than falling
 * back to direct straight-line cutting.
 */
class ResilientRoutingProvider implements RoutingProvider {
  constructor(
    private readonly primary: RoutingProvider,
    private readonly fallback: RoutingProvider,
  ) {}

  get name(): string {
    return `${this.primary.name}+fallback`;
  }

  async route(request: RouteRequest): Promise<Route> {
    try {
      return await this.primary.route(request);
    } catch (error) {
      if (
        error instanceof RoutingError &&
        (error.code === 'RATE_LIMITED' ||
          error.code === 'UNAUTHORISED' ||
          error.code === 'UNAVAILABLE')
      ) {
        logger.warn(
          { error: error.message },
          'Primary routing provider failed; falling back to OSRM',
        );
        return await this.fallback.route(request);
      }
      throw error;
    }
  }

  async distances(
    from: import('@saarthi/shared').LatLng,
    to: readonly import('@saarthi/shared').LatLng[],
    profile: RoutingProfile,
  ): Promise<RoadDistance[]> {
    try {
      return await this.primary.distances(from, to, profile);
    } catch {
      return await this.fallback.distances(from, to, profile);
    }
  }

  async matrix(
    points: readonly import('@saarthi/shared').LatLng[],
    profile: RoutingProfile,
  ): Promise<(number | null)[][]> {
    try {
      return await this.primary.matrix(points, profile);
    } catch {
      return await this.fallback.matrix(points, profile);
    }
  }

  async searchPlaces(
    query: string,
    near: import('@saarthi/shared').LatLng,
    limit: number,
  ): Promise<PlaceMatch[]> {
    try {
      return await this.primary.searchPlaces(query, near, limit);
    } catch {
      return await this.fallback.searchPlaces(query, near, limit);
    }
  }

  async reverseGeocode(at: import('@saarthi/shared').LatLng): Promise<Locality | null> {
    try {
      return await this.primary.reverseGeocode(at);
    } catch {
      return await this.fallback.reverseGeocode(at);
    }
  }

  async routePath(waypoints: readonly import('@saarthi/shared').LatLng[]): Promise<import('@saarthi/shared').LatLng[]> {
    if (this.primary.routePath) {
      try {
        return await this.primary.routePath(waypoints);
      } catch {
        // Fall back to fallback provider below
      }
    }
    if (this.fallback.routePath) {
      try {
        return await this.fallback.routePath(waypoints);
      } catch {
        return [...waypoints];
      }
    }
    return [...waypoints];
  }
}

/**
 * Routing provider factory.
 *
 * Returns OpenRouteService wrapped with OSRM fallback when an ORS key is configured.
 * When no key is provided, returns OSRM directly.
 */
function createRoutingProvider(): RoutingProvider {
  const apiKey = config.maps.routingApiKey;
  const osrm = new OsrmRoutingProvider();

  if (!apiKey) {
    return osrm;
  }

  const ors = new OrsRoutingProvider(apiKey);
  return new ResilientRoutingProvider(ors, osrm);
}

export const routingProvider: RoutingProvider | null = createRoutingProvider();

export const isRoutingConfigured = routingProvider !== null;

/**
 * Traces a dense road polyline through given waypoints along the road network.
 * Falls back to straight points if routing is unavailable or fails.
 */
export async function traceRoadPath(
  waypoints: readonly import('@saarthi/shared').LatLng[],
): Promise<import('@saarthi/shared').LatLng[]> {
  if (waypoints.length < 2) return [...waypoints];
  if (routingProvider?.routePath) {
    try {
      const road = await routingProvider.routePath(waypoints);
      if (road && road.length >= 2) return road;
    } catch {
      // Fallback below
    }
  }
  return [...waypoints];
}

logger.info(
  { provider: routingProvider?.name ?? 'none' },
  `Routing provider ready (${routingProvider?.name ?? 'none'})`,
);

export * from './routing.provider';
