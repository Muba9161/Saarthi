import { useQuery } from '@tanstack/react-query';
import type { PublicLiveRide, RideSharedWithMe } from '@saarthi/shared';
import { ApiError, api, apiRequest } from '@/lib/api-client';
import { liveRidePollInterval } from './live-ride-status';

/**
 * Client side of "Share my ride".
 *
 * Two reads. The public one is what the live link opens: no session is needed
 * or assumed, because family follow it from WhatsApp without an account, and
 * the API decides what the token discloses — a first name, the vehicle number,
 * and a position only while the rider is still sharing. The signed-in one
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

function fetchLiveRide(token: string, signal: AbortSignal): Promise<PublicLiveRide> {
  return apiRequest<PublicLiveRide>(`/public/live/${encodeURIComponent(token)}`, {
    // An anonymous viewer is not a session-expiry event. Without this a
    // signed-out phone would trip the refresh-and-retry path and be bounced to
    // the sign-in screen — the same reason the QR scan page sets it.
    skipAuthRetry: true,
    signal,
  });
}

export function useLiveRide(token: string) {
  return useQuery({
    queryKey: liveRideQueryKey(token),
    queryFn: ({ signal }) => fetchLiveRide(token, signal),
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
