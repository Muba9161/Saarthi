import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Feature, Permission, RealtimeEvent, thinTrail, type TrailPoint } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { TrackingHistory } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useRealtimeEvent } from '@/hooks/use-realtime';

/**
 * The path a vehicle has covered, kept growing while the screen is open.
 *
 * Seeded from stored history, then extended by the `truck.location` pushes the
 * page is already subscribed to. The hook listens but never subscribes: the
 * same fix is published on the truck, fleet and trip channels, and holding a
 * second one would only deliver every point twice.
 *
 * Each point carries the route state the server judged when it stored it, so
 * the colours drawn here are the ones the replay and the driver's app draw.
 */

/** Asked of the server, which thins to it while keeping every colour change. */
const HISTORY_LIMIT = 1500;

/**
 * Live points held before the tail is thinned back to half — with the history
 * cap, that bounds the trail near 3 000 points however long the screen stays
 * open. Thinned rather than trimmed: dropping the oldest points would cut off
 * where the vehicle started, which is the half of a covered path that matters.
 */
const LIVE_TAIL_LIMIT = 1500;

/** With no trip, the path reaches back at least this far. */
const MIN_DAY_WINDOW_MS = 12 * 60 * 60 * 1000;

interface LivePoint extends TrailPoint {
  /** `recordedAt` as epoch milliseconds, for ordering and the seam with history. */
  at: number;
}

const NO_POINTS: readonly LivePoint[] = [];

/**
 * Where a path with no trip starts: local midnight, or twelve hours back when
 * that is earlier — so just after midnight it is still a path, not a stub.
 */
function dayStart(now = new Date()): Date {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return new Date(Math.min(midnight.getTime(), now.getTime() - MIN_DAY_WINDOW_MS));
}

export interface UseCoveredTrailOptions {
  /** The vehicle whose path to draw. Nothing is fetched or kept without one. */
  truckId: string | null | undefined;
  /** Start where this trip started, rather than at the start of the day. */
  tripId?: string | null;
  /**
   * Extend the path only with fixes reported against `tripId`. A trip page
   * wants that trip's path and nothing after it; the live map wants wherever
   * the vehicle goes next.
   */
  tripOnly?: boolean;
}

export function useCoveredTrail({
  truckId,
  tripId = null,
  tripOnly = false,
}: UseCoveredTrailOptions): TrailPoint[] {
  const { can, hasFeature } = useAuth();
  // Stored history is a plan feature. Without it the path starts when the
  // screen opened, from live fixes alone — still true, just shorter.
  const historyAllowed = hasFeature(Feature.TRACKING_HISTORY) && can(Permission.TRACKING_READ);

  const history = useQuery({
    queryKey: ['tracking', 'covered-trail', truckId, tripId],
    queryFn: ({ signal }) =>
      api.get<TrackingHistory>(
        `/tracking/trucks/${truckId}/history`,
        {
          ...(tripId ? { tripId } : { from: dayStart().toISOString() }),
          limit: HISTORY_LIMIT,
          simplify: true,
        },
        signal,
      ),
    enabled: Boolean(truckId) && historyAllowed,
  });

  const key = `${truckId ?? ''}|${tripId ?? ''}`;
  // Keyed, so a different vehicle or trip starts from an empty tail without an
  // effect having to clear the old one first.
  const [tail, setTail] = React.useState<{ key: string; points: readonly LivePoint[] }>({
    key,
    points: NO_POINTS,
  });

  useRealtimeEvent(RealtimeEvent.TRUCK_LOCATION, ({ payload }) => {
    if (!truckId || payload.truckId !== truckId) return;
    if (tripOnly && payload.tripId !== tripId) return;

    const at = Date.parse(payload.recordedAt);
    if (!Number.isFinite(at)) return;

    setTail((previous) => {
      const points = previous.key === key ? previous.points : NO_POINTS;
      const last = points[points.length - 1];
      // A batch held back by a dead zone lands after newer fixes; drawn in
      // arrival order it would zig-zag back across the road.
      if (last && at <= last.at) return previous;

      const next = [
        ...points,
        {
          latitude: payload.latitude,
          longitude: payload.longitude,
          routeState: payload.routeState,
          at,
        },
      ];
      return {
        key,
        points: next.length > LIVE_TAIL_LIMIT ? thinTrail(next, LIVE_TAIL_LIMIT / 2) : next,
      };
    });
  });

  const stored = history.data?.points;
  const live = tail.key === key ? tail.points : NO_POINTS;

  return React.useMemo(() => {
    if (!truckId) return [];
    const seeded = stored ?? [];
    const newest = seeded[seeded.length - 1];
    const seam = newest ? Date.parse(newest.recordedAt) : Number.NEGATIVE_INFINITY;
    // Fixes the history already holds are dropped, so a refetch that overlaps
    // the live tail never draws the same stretch twice.
    return [...seeded, ...live.filter((point) => point.at > seam)];
  }, [truckId, stored, live]);
}
