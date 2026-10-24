import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { RideShareStatus, thinTrail, type PublicLiveRide, type RideSharedWithMe, type RideTrailPoint } from '@saarthi/shared';
import { ApiError, api, apiRequest } from '@/lib/api-client';
import { liveRidePollInterval } from './live-ride-status';

/**
 * Client side of "Share my ride".
 *
 * Two reads. The public one is what the live link opens: no session is needed
 * or assumed, because family follow it from WhatsApp without an account, and
 * the API decides what the token discloses — a first name, the vehicle number,
 * and a position and the road covered only while the rider is still sharing. The signed-in one
 * lists the rides being shared with this account, for "Shared with me" and the
 * Home card; each entry carries the same token, so both open the same page.
 */

export const RIDES_SHARED_WITH_ME_KEY = ['ride-shares', 'shared-with-me'] as const;

/** Rides shared with this account right now — listed for Personal plan accounts; others get none. */
export function useRidesSharedWithMe(enabled = true) {
  return useQuery({
    queryKey: RIDES_SHARED_WITH_ME_KEY,
    queryFn: () => api.get<RideSharedWithMe[]>('/ride-shares/shared-with-me'),
    enabled,
    // A share starts and stops on the rider's phone; nothing pushes it here.
    refetchInterval: 30_000,
  });
}

export const liveRideQueryKey = (token: string) => ['public', 'live-ride', token] as const;

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.isNotFound;
}

/** Points kept before the older road is thinned — as many as the server sends for a whole ride, twice over. */
const MAX_TRAIL_POINTS = 3000;

function fetchLiveRide(token: string, signal: AbortSignal, from?: string): Promise<PublicLiveRide> {
  const query = from ? `?from=${encodeURIComponent(from)}` : '';
  return apiRequest<PublicLiveRide>(`/public/live/${encodeURIComponent(token)}${query}`, {
    // An anonymous viewer is not a session-expiry event. Without this a
    // signed-out phone would trip the refresh-and-retry path and be bounced to
    // the sign-in screen — the same reason the QR scan page sets it.
    skipAuthRetry: true,
    signal,
  });
}

/** The road held, with what is newer from [fresh] after it; ISO times sort as text. */
function extendTrail(held: readonly RideTrailPoint[], fresh: readonly RideTrailPoint[]): RideTrailPoint[] {
  const last = held.at(-1)?.recordedAt;
  const road = [...held, ...fresh.filter((point) => last === undefined || point.recordedAt > last)];
  return road.length > MAX_TRAIL_POINTS ? thinTrail(road, MAX_TRAIL_POINTS) : road;
}

/**
 * The ride behind a live link, read again while it lasts. The road covered is
 * read whole once and then only what is new — as a followed vehicle's trail
 * is — so a long ride does not resend its whole road every few seconds.
 */
export function useLiveRide(token: string) {
  const road = React.useRef<{ token: string; points: RideTrailPoint[] }>({ token, points: [] });
  return useQuery({
    queryKey: liveRideQueryKey(token),
    queryFn: async ({ signal }) => {
      if (road.current.token !== token) road.current = { token, points: [] };
      const ride = await fetchLiveRide(token, signal, road.current.points.at(-1)?.recordedAt);
      const points = ride.status === RideShareStatus.SHARING ? extendTrail(road.current.points, ride.trail) : [];
      road.current = { token, points };
      return { ...ride, trail: points };
    },
    enabled: token.length > 0,
    // Every answer is a snapshot of a moving phone; none of it is reusable.
    staleTime: 0,
    refetchInterval: (query) =>
      liveRidePollInterval(query.state.data, isNotFoundError(query.state.error)),
    // Coming back from WhatsApp should show where they are now, not where they
    // were when the tab was left — but an ended or unknown link has nothing new.
    refetchOnWindowFocus: (query) =>
      liveRidePollInterval(query.state.data, isNotFoundError(query.state.error)) !== false,
  });
}
