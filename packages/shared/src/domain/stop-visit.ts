import { haversineDistance, type LatLng } from './geo';

/**
 * When a vehicle reached a trip stop, and when it left — from its own GPS.
 *
 * Measured from the reported positions alone, so it holds whether the driver
 * navigated with Saarthi, with Google Maps or with nothing at all, and whether
 * or not anybody remembered to press Arrived. It never marks a stop arrived by
 * itself: it records the time, and the driver confirms.
 */

/** Within this of a stop, a vehicle that stops there has reached it. */
export const STOP_REACHED_METRES = 200;

/**
 * Back beyond this and it has left.
 *
 * Wider than {@link STOP_REACHED_METRES}, so GPS wander at a gate does not read
 * as leaving and coming straight back.
 */
export const STOP_LEFT_METRES = 250;

/**
 * How long it must stay inside before it counts.
 *
 * Long enough that crawling past the gate in traffic is not an arrival.
 */
export const STOP_DWELL_MS = 2 * 60_000;

/** Below this, a vehicle inside the radius has stopped rather than driving through. */
export const STOP_STOPPED_KPH = 5;

export interface StopVisit extends LatLng {
  /** First slow position inside the radius, while waiting to see if it stays. */
  reachingSince: Date | null;
  reachedAt: Date | null;
  leftAt: Date | null;
}

export interface StopFix {
  position: LatLng;
  speedKph: number;
  /** When the position was taken — not when it arrived, which can be much later. */
  at: Date;
}

export type StopVisitChange =
  | { kind: 'NONE' }
  /** Slowed to a stop inside the radius: the wait begins. */
  | { kind: 'REACHING'; reachingSince: Date }
  /** Left the radius before the wait was over: it did not stop here after all. */
  | { kind: 'NOT_REACHING' }
  /** Stayed long enough. Reached when the wait began, not when it ended. */
  | { kind: 'REACHED'; reachedAt: Date }
  | { kind: 'LEFT'; leftAt: Date; minutesAtStop: number };

const NONE: StopVisitChange = { kind: 'NONE' };

/**
 * What one position changes about a stop's visit.
 *
 * A position older than the step it would decide is ignored: a phone that was
 * out of signal uploads what it kept in order, but a fix that arrives behind a
 * newer one must not rewrite the newer one's answer.
 */
export function nextStopVisit(stop: StopVisit, fix: StopFix): StopVisitChange {
  if (stop.leftAt) return NONE;
  const metres = haversineDistance(stop, fix.position);

  if (stop.reachedAt) {
    if (fix.at < stop.reachedAt || metres <= STOP_LEFT_METRES) return NONE;
    return {
      kind: 'LEFT',
      leftAt: fix.at,
      minutesAtStop: Math.round((fix.at.getTime() - stop.reachedAt.getTime()) / 60_000),
    };
  }

  if (metres > STOP_REACHED_METRES) {
    return stop.reachingSince && fix.at >= stop.reachingSince ? { kind: 'NOT_REACHING' } : NONE;
  }

  if (!stop.reachingSince) {
    return fix.speedKph < STOP_STOPPED_KPH ? { kind: 'REACHING', reachingSince: fix.at } : NONE;
  }

  if (fix.at.getTime() - stop.reachingSince.getTime() >= STOP_DWELL_MS) {
    return { kind: 'REACHED', reachedAt: stop.reachingSince };
  }
  return NONE;
}
