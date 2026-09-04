import type { LatLng } from '@saarthi/shared';

/**
 * Road-network routing contract.
 *
 * The provider answers two questions and nothing else: how far apart two points
 * are *by road*, and how to drive between them. Caching, authorisation, vehicle
 * profile selection and everything the terminal renders are Saarthi's concern.
 *
 * The boundary exists because this is the one part of the map stack that is not
 * free. OpenFreeMap serves tiles with no key and no ceiling; routing needs an
 * OpenRouteService key with a daily budget, and a fleet may eventually want to
 * point it at a self-hosted Valhalla or ORS instance instead. Keeping the
 * contract here means that is a provider swap.
 *
 * Two rules run through every implementation:
 *
 *  1. **Road distance is never confused with straight-line distance.** Every
 *     result says which it is. A driver told a fuel station is 3.2 km away when
 *     that is the crow-flies figure and the road is 11 km around a river will
 *     run out of fuel, and will be right to stop trusting Saarthi.
 *
 *  2. **A truck is routed as a truck.** `driving-hgv` respects weight, height
 *     and access restrictions a car profile ignores. Sending a 40-tonne vehicle
 *     down a lane with a 7.5 t limit is worse than giving no route at all.
 */

/** Which vehicle the route is for. */
export type RoutingProfile = 'driving-hgv' | 'driving-car';

export interface RouteRequest {
  from: LatLng;
  to: LatLng;
  profile: RoutingProfile;
  /** Road classes to avoid. Trucks routinely exclude tolls or ferries. */
  avoid?: readonly ('toll' | 'ferry' | 'motorway')[];
}

/** One turn on the way. */
export interface RouteStep {
  distanceMeters: number;
  durationSeconds: number;
  /** Road name, or "Unnamed road". Never the router's "-" placeholder. */
  name: string;
  instruction: string;
  /** `turn`, `roundabout`, `arrive`, `depart`, `fork`, `continue`. */
  maneuver: string;
  /** `left`, `slight right`, `uturn`, … or null when not a turn. */
  modifier: string | null;
  /** Where the manoeuvre happens. */
  at: LatLng;
}

export interface Route {
  distanceMeters: number;
  durationSeconds: number;
  /** The full polyline, ready for a map source. */
  geometry: LatLng[];
  steps: RouteStep[];
  /** The roads used, e.g. "NH 48 · Ring Road". */
  summary: string;
  profile: RoutingProfile;
}

/**
 * Road distance from one origin to several destinations.
 *
 * A separate operation from routing because it is a separate *cost*: one matrix
 * call answers for twenty places, where twenty directions calls would spend
 * twenty times the daily budget to draw twenty polylines nobody asked to see.
 * The terminal ranks a services list with this and fetches a route only for the
 * one the driver picks.
 */
export interface RoadDistance {
  /** Index into the destinations array as supplied. */
  index: number;
  /** Null when the router could not connect the pair — an island, a closed road. */
  distanceMeters: number | null;
  durationSeconds: number | null;
}

export interface RoutingProvider {
  readonly name: string;

  route(request: RouteRequest): Promise<Route>;

  /**
   * Road distance and time from one point to many.
   *
   * Implementations must return one entry per destination, in order, with nulls
   * where no route exists — never a short array. A caller zipping this against
   * its own list has to be able to trust the positions.
   */
  distances(
    from: LatLng,
    to: readonly LatLng[],
    profile: RoutingProfile,
  ): Promise<RoadDistance[]>;

  /**
   * Places matching what somebody typed.
   *
   * Distinct from the nearby search, and needed because the two answer different
   * questions. Nearby asks "what fuel stations are around me", from a fixed set
   * of categories, and is the right tool for a driver who needs *a* pump. This
   * asks "where is Sushant Golf City" — a named place, a society, a warehouse, a
   * customer's gate — which no category list can ever cover.
   *
   * Ordered by relevance to [near], because a driver searching "MG Road" means
   * the one in this city rather than the better-known one four states away.
   */
  searchPlaces(query: string, near: LatLng, limit: number): Promise<PlaceMatch[]>;
}

/** One result from [RoutingProvider.searchPlaces]. */
export interface PlaceMatch {
  /** What to show. The geocoder's own label, which includes locality. */
  name: string;
  /** Street, locality, region — whatever the geocoder could resolve. */
  address: string | null;
  latitude: number;
  longitude: number;
  /** Metres from the driver, straight line. Ordering and sanity, not a route. */
  distanceMeters: number | null;
}

/** Why a routing call failed, in terms a screen in a cab can act on. */
export class RoutingError extends Error {
  readonly code:
    | 'NOT_CONFIGURED'
    | 'NO_ROUTE'
    | 'RATE_LIMITED'
    | 'UNAUTHORISED'
    | 'UNAVAILABLE';

  constructor(code: RoutingError['code'], message: string) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
  }
}
