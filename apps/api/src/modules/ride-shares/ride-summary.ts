import {
  RIDE_SUMMARY_MINUTES,
  haversineDistance,
  withoutGlitches,
  type RideShareSummary,
} from '@saarthi/shared';

/** A fix as the rider's phone reported it. */
export interface RideFix {
  latitude: number;
  longitude: number;
  speedKph: number | null;
  accuracy: number | null;
  recordedAt: Date;
}

/** What is measured from the road covered, before the points are deleted. */
export interface RideMeasures {
  distanceKm: number;
  /** Null when the phone reported no speed: a top speed is never estimated. */
  maxSpeedKph: number | null;
}

/** Distance along the fixes, GPS glitches left out, and the fastest speed the phone reported. */
export function measureRide(fixes: readonly RideFix[]): RideMeasures {
  const road = withoutGlitches(fixes);
  let metres = 0;
  let fastest = 0;
  for (let index = 0; index < road.length; index += 1) {
    const fix = road[index]!;
    if (index > 0) metres += haversineDistance(road[index - 1]!, fix);
    if (fix.speedKph !== null && Number.isFinite(fix.speedKph)) {
      fastest = Math.max(fastest, fix.speedKph);
    }
  }
  return {
    distanceKm: Number((metres / 1000).toFixed(2)),
    maxSpeedKph: fastest > 0 ? Math.round(fastest) : null,
  };
}

/** The summary an ended share shows, and until when. */
export function rideSummary(
  startedAt: Date,
  endedAt: Date,
  measures: RideMeasures,
): RideShareSummary {
  const hours = Math.max(0, endedAt.getTime() - startedAt.getTime()) / 3_600_000;
  return {
    distanceKm: measures.distanceKm,
    durationMinutes: Math.round(hours * 60),
    avgSpeedKph: hours > 0 ? Number((measures.distanceKm / hours).toFixed(1)) : null,
    maxSpeedKph: measures.maxSpeedKph,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    shownUntil: new Date(endedAt.getTime() + RIDE_SUMMARY_MINUTES * 60_000).toISOString(),
  };
}
