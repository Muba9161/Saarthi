import type { PublicLiveRide } from '@saarthi/shared';
import type { TranslationKey } from '@/features/i18n/translations';

/**
 * The decisions the live-ride page makes from what the API sends — kept free
 * of React so each one is a plain function with a plain test.
 */

/** The public page a live link opens — the same for family and for a signed-in contact. */
export function liveRidePath(token: string): string {
  return `/live/${encodeURIComponent(token)}`;
}

/** How often the page asks for a fresh position while the ride is shared. */
export const LIVE_RIDE_POLL_MS = 10_000;

/** Below this a fix reads as "just now" — also absorbs a phone clock running slightly ahead. */
const JUST_NOW_SECONDS = 5;

/**
 * What the page is showing.
 *
 * `waiting` is a share that has started but whose phone has not reported a fix
 * yet; `ended` never carries a position — the API withholds it once sharing
 * stops, so an old link shows nobody's whereabouts.
 */
export type LiveRidePhase = 'live' | 'waiting' | 'ended';

export function liveRidePhase(ride: Pick<PublicLiveRide, 'status' | 'position'>): LiveRidePhase {
  if (ride.status === 'ENDED') return 'ended';
  return ride.position ? 'live' : 'waiting';
}

/**
 * The polling interval for the live query, or `false` to stop.
 *
 * Polling stops for good once the ride has ended or the link turned out not to
 * exist: neither answer can change back, and every request counts against the
 * endpoint's per-IP rate limit.
 */
export function liveRidePollInterval(
  ride: Pick<PublicLiveRide, 'status'> | undefined,
  notFound: boolean,
): number | false {
  if (notFound || ride?.status === 'ENDED') return false;
  return LIVE_RIDE_POLL_MS;
}

/** How long ago a fix was recorded, in the largest whole unit that fits. */
export type UpdatedAgo =
  | { unit: 'now' }
  | { unit: 'seconds' | 'minutes' | 'hours'; count: number };

/** Null for a timestamp that does not parse — better no line than a wrong one. */
export function updatedAgo(recordedAt: string, now: number): UpdatedAgo | null {
  const recorded = Date.parse(recordedAt);
  if (Number.isNaN(recorded)) return null;

  const seconds = Math.floor((now - recorded) / 1000);
  if (seconds < JUST_NOW_SECONDS) return { unit: 'now' };
  if (seconds < 60) return { unit: 'seconds', count: seconds };
  if (seconds < 3600) return { unit: 'minutes', count: Math.floor(seconds / 60) };
  // A share stops by itself within hours, so hours is the largest unit needed.
  return { unit: 'hours', count: Math.floor(seconds / 3600) };
}

/**
 * The catalogue key and values for an "updated … ago" line.
 *
 * Abbreviated units ("20 s", "3 min") rather than Intl's relative time: they
 * read the same at every count, so no plural rules are needed, and they render
 * in every language Saarthi offers — Intl has no data for several of them and
 * falls back to a bare "-20 s".
 */
export function updatedAgoMessage(ago: UpdatedAgo): {
  key: TranslationKey;
  values?: { count: number };
} {
  switch (ago.unit) {
    case 'now':
      return { key: 'Updated just now' };
    case 'seconds':
      return { key: 'Updated {count} s ago', values: { count: ago.count } };
    case 'minutes':
      return { key: 'Updated {count} min ago', values: { count: ago.count } };
    case 'hours':
      return { key: 'Updated {count} h ago', values: { count: ago.count } };
  }
}

/** Whole km/h for display, or null when the phone reported no speed. */
export function displaySpeed(speedKph: number | null | undefined): number | null {
  if (speedKph === null || speedKph === undefined || !Number.isFinite(speedKph)) return null;
  return Math.max(0, Math.round(speedKph));
}
