import * as React from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LatLng } from '@saarthi/shared';
import {
  DirectionsError,
  fetchDirections,
  type DirectionsOptions,
  type DirectionsResult,
  type NavigationRoute,
  type RoutingProfile,
} from './directions';
import { isRoutingConfigured } from './map-config';
import {
  computeRouteProgress,
  OFF_ROUTE_THRESHOLD_METERS,
  type RouteProgress,
} from './route-progress';

/**
 * Turn-by-turn navigation state for a set of waypoints.
 *
 * Routing is quota-limited, so the query key is built from waypoints rounded to
 * ~11 m. A truck jittering inside its own parking bay therefore reuses the
 * cached route instead of spending a request on every GPS tick.
 */

export interface UseNavigationOptions {
  /** Origin, optional via-points and destination. Fewer than two disables it. */
  waypoints: readonly LatLng[] | undefined;
  enabled?: boolean;
  profile?: RoutingProfile;
  alternatives?: boolean;
  exclude?: DirectionsOptions['exclude'];
  /** Live vehicle position, used for progress and off-route detection. */
  currentPosition?: LatLng | null;
  offRouteThresholdMeters?: number;
  /** Recalculate automatically once the vehicle has clearly left the route. */
  autoReroute?: boolean;
  /**
   * Re-route from where the vehicle actually is rather than from the original
   * origin. On by default, and the only thing that makes a reroute useful: a
   * driver 6 km down the road who has missed a turn needs a route from here,
   * not the same route from a point they left half an hour ago.
   */
  rerouteFromCurrentPosition?: boolean;
}

export interface NavigationState {
  isLoading: boolean;
  isFetching: boolean;
  error: DirectionsError | null;
  /** All returned options, primary first. */
  routes: NavigationRoute[];
  selectedRouteIndex: number;
  selectRoute: (index: number) => void;
  /** The route currently being followed. */
  route: NavigationRoute | null;
  progress: RouteProgress | null;
  /** Force a fresh Directions call — used by the "recalculate" control. */
  recalculate: () => void;
  /** True while a reroute triggered by leaving the route is in flight. */
  isRerouting: boolean;
  configured: boolean;
}

/** ~11 m of precision: enough to keep distinct trips apart, coarse enough to cache. */
function roundedKey(points: readonly LatLng[]): string {
  return points.map((point) => `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`).join('|');
}

/** Never fire a reroute more than once in this window, however far off route. */
const REROUTE_COOLDOWN_MS = 20_000;
/** Consecutive off-route readings required before rerouting — GPS noise guard. */
const REROUTE_CONFIRMATIONS = 3;

export function useNavigation(options: UseNavigationOptions): NavigationState {
  const {
    waypoints,
    enabled = true,
    profile = 'driving-hgv',
    alternatives = true,
    exclude,
    currentPosition,
    offRouteThresholdMeters = OFF_ROUTE_THRESHOLD_METERS,
    autoReroute = true,
    rerouteFromCurrentPosition = true,
  } = options;

  const requestedWaypoints = React.useMemo(
    () =>
      (waypoints ?? []).filter(
        (point) =>
          point &&
          Number.isFinite(point.latitude) &&
          Number.isFinite(point.longitude),
      ),
    [waypoints],
  );

  /**
   * Origin substituted on a recalculate.
   *
   * Held in state rather than folded into the caller's waypoints, so the route
   * itself stays keyed on a *stable* origin: a live position in the query key
   * would spend a routing request every eleven metres of driving.
   */
  const [rerouteOrigin, setRerouteOrigin] = React.useState<LatLng | null>(null);

  const usableWaypoints = React.useMemo(() => {
    if (!rerouteOrigin || requestedWaypoints.length < 2) return requestedWaypoints;
    return [rerouteOrigin, ...requestedWaypoints.slice(1)];
  }, [requestedWaypoints, rerouteOrigin]);

  const active = enabled && isRoutingConfigured && usableWaypoints.length >= 2;
  const requestedKey = React.useMemo(() => roundedKey(requestedWaypoints), [requestedWaypoints]);
  const waypointKey = React.useMemo(() => roundedKey(usableWaypoints), [usableWaypoints]);
  const excludeKey = exclude?.join(',') ?? '';

  const [selectedRouteIndex, setSelectedRouteIndex] = React.useState(0);
  const [rerouteToken, setRerouteToken] = React.useState(0);
  const [isRerouting, setIsRerouting] = React.useState(false);

  // A new destination discards the previous reroute origin — the caller's own
  // origin is the right starting point for a trip that has not begun.
  const appliedRequestKey = React.useRef(requestedKey);
  React.useEffect(() => {
    if (appliedRequestKey.current === requestedKey) return;
    appliedRequestKey.current = requestedKey;
    setRerouteOrigin(null);
  }, [requestedKey]);

  const query: UseQueryResult<DirectionsResult, DirectionsError> = useQuery({
    queryKey: ['ors-directions', waypointKey, profile, alternatives, excludeKey, rerouteToken],
    enabled: active,
    // No traffic model means the geometry and ETA are stable — cache generously.
    staleTime: 30 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: (failureCount, error) => {
      // A missing token or an unroutable pair will never succeed on retry.
      const terminal = ['MISSING_TOKEN', 'UNAUTHORISED', 'NO_ROUTE', 'TOO_FEW_WAYPOINTS'];
      if (error instanceof DirectionsError && terminal.includes(error.code)) return false;
      return failureCount < 2;
    },
    queryFn: async ({ signal }) => {
      const result = await fetchDirections(usableWaypoints, {
        profile,
        alternatives,
        ...(exclude ? { exclude } : {}),
        signal,
      });
      return result;
    },
  });

  // A new set of waypoints invalidates whichever alternative was chosen.
  React.useEffect(() => {
    setSelectedRouteIndex(0);
  }, [waypointKey, profile]);

  React.useEffect(() => {
    if (!query.isFetching) setIsRerouting(false);
  }, [query.isFetching]);

  const routes = query.data?.routes ?? [];
  const route = routes[selectedRouteIndex] ?? routes[0] ?? null;

  const progress = React.useMemo(() => {
    if (!route || !currentPosition) return null;
    if (!Number.isFinite(currentPosition.latitude) || !Number.isFinite(currentPosition.longitude)) {
      return null;
    }
    return computeRouteProgress(route, currentPosition, { offRouteThresholdMeters });
  }, [route, currentPosition, offRouteThresholdMeters]);

  const positionRef = React.useRef(currentPosition);
  positionRef.current = currentPosition;

  const recalculate = React.useCallback(() => {
    setIsRerouting(true);
    const here = positionRef.current;
    if (
      rerouteFromCurrentPosition &&
      here &&
      Number.isFinite(here.latitude) &&
      Number.isFinite(here.longitude)
    ) {
      setRerouteOrigin({ latitude: here.latitude, longitude: here.longitude });
    }
    setRerouteToken((token) => token + 1);
  }, [rerouteFromCurrentPosition]);

  // --- Automatic reroute -------------------------------------------------
  const offRouteStreak = React.useRef(0);
  const lastRerouteAt = React.useRef(0);

  React.useEffect(() => {
    if (!autoReroute || !progress || !active) {
      offRouteStreak.current = 0;
      return;
    }
    if (!progress.isOffRoute || progress.arrived) {
      offRouteStreak.current = 0;
      return;
    }

    offRouteStreak.current += 1;
    if (offRouteStreak.current < REROUTE_CONFIRMATIONS) return;

    const now = Date.now();
    if (now - lastRerouteAt.current < REROUTE_COOLDOWN_MS) return;

    lastRerouteAt.current = now;
    offRouteStreak.current = 0;
    recalculate();
  }, [progress, autoReroute, active, recalculate]);

  const selectRoute = React.useCallback(
    (index: number) => {
      setSelectedRouteIndex((current) => (index >= 0 ? index : current));
    },
    [],
  );

  return {
    isLoading: query.isPending && active,
    isFetching: query.isFetching,
    error: (query.error as DirectionsError | null) ?? null,
    routes,
    selectedRouteIndex: routes[selectedRouteIndex] ? selectedRouteIndex : 0,
    selectRoute,
    route,
    progress,
    recalculate,
    isRerouting: isRerouting && query.isFetching,
    configured: isRoutingConfigured,
  };
}
