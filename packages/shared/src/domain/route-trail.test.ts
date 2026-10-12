import { describe, expect, it } from 'vitest';
import { TrackRouteState } from './enums';
import { destinationPoint } from './geo';
import {
  ALTERNATE_AWAY_METRES,
  GLITCH_ACCURACY_METRES,
  isOffRoute,
  nextRouteState,
  stillHeadingThere,
  thinTrail,
  withoutGlitches,
} from './route-trail';

const start = { latitude: 26.8467, longitude: 80.9462 };
// A road heading due east, with a bend so it counts as a road and not a line.
const route = [start, destinationPoint(start, 90, 2_000), destinationPoint(start, 80, 4_000)];
const metresNorthOfRoad = (metres: number) => destinationPoint(route[1]!, 0, metres);

describe('covered-path trail state', () => {
  it('keeps an alternate stretch off-route inside the hysteresis band, like a red one', () => {
    const inBand = metresNorthOfRoad(100);
    for (const previous of [TrackRouteState.OFF_ROUTE, TrackRouteState.ALTERNATE]) {
      expect(nextRouteState({ tripUnderway: true, route, position: inBand, previous })).toBe(
        TrackRouteState.OFF_ROUTE,
      );
    }
    expect(
      nextRouteState({ tripUnderway: true, route, position: inBand, previous: TrackRouteState.ON_ROUTE }),
    ).toBe(TrackRouteState.ON_ROUTE);
  });

  it('treats amber and red alike as off the planned road', () => {
    expect(isOffRoute(TrackRouteState.ALTERNATE)).toBe(true);
    expect(isOffRoute(TrackRouteState.OFF_ROUTE)).toBe(true);
    expect(isOffRoute(TrackRouteState.ON_ROUTE)).toBe(false);
    expect(isOffRoute(null)).toBe(false);
  });
});

describe('still heading for the destination', () => {
  it('gives the driver the benefit of the doubt with nothing to compare against', () => {
    expect(stillHeadingThere(null, 12_000)).toBe(true);
  });

  it('allows a road that swings away for a bend', () => {
    expect(stillHeadingThere(10_000, 10_000 + ALTERNATE_AWAY_METRES)).toBe(true);
  });

  it('calls it moving away once the vehicle is clearly further than it was', () => {
    expect(stillHeadingThere(10_000, 10_000 + ALTERNATE_AWAY_METRES + 1)).toBe(false);
  });
});

describe('a covered path without its GPS glitches', () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 11, 9, 0, seconds)).toISOString();
  const fix = (metresEast: number, seconds: number, accuracy?: number | null) => ({
    ...destinationPoint(start, 90, metresEast),
    recordedAt: at(seconds),
    accuracy,
  });

  it('drops the jumps a parked phone makes indoors, which drew a star around it', () => {
    const parked = [
      fix(0, 0),
      { ...destinationPoint(start, 20, 400), recordedAt: at(10) },
      fix(3, 20),
      { ...destinationPoint(start, 200, 350), recordedAt: at(30) },
      fix(1, 40),
    ];
    expect(withoutGlitches(parked)).toEqual([parked[0], parked[2], parked[4]]);
  });

  it('drops a jump that lasts a few fixes before the position comes back', () => {
    const away = destinationPoint(start, 45, 36);
    const parked = [
      fix(0, 0),
      { ...away, recordedAt: at(5) },
      { ...away, recordedAt: at(10) },
      { ...away, recordedAt: at(15) },
      fix(1, 20),
    ];
    expect(withoutGlitches(parked)).toEqual([parked[0], parked[4]]);
  });

  it('keeps every point of a real drive, bends and all', () => {
    // 15 m/s, about 54 km/h, east and then swinging north.
    const drive = [
      fix(0, 0),
      fix(150, 10),
      fix(300, 20),
      { ...destinationPoint(destinationPoint(start, 90, 300), 0, 150), recordedAt: at(30) },
      { ...destinationPoint(destinationPoint(start, 90, 300), 0, 300), recordedAt: at(40) },
    ];
    expect(withoutGlitches(drive)).toEqual(drive);
  });

  it('keeps a stop at a pump just off the road and the drive back', () => {
    const detour = [
      fix(0, 0),
      { ...destinationPoint(start, 0, 120), recordedAt: at(60) },
      { ...destinationPoint(start, 0, 120), recordedAt: at(240) },
      fix(10, 300),
    ];
    expect(withoutGlitches(detour)).toEqual(detour);
  });

  it('drops a badly placed point and keeps one with no accuracy reported', () => {
    const points = [fix(0, 0, 8), fix(20, 10, GLITCH_ACCURACY_METRES + 1), fix(40, 20, null), fix(60, 30)];
    expect(withoutGlitches(points)).toEqual([points[0], points[2], points[3]]);
  });

  it('keeps the first and last point, which have nothing to be judged against', () => {
    const points = [fix(0, 0), fix(5_000, 5)];
    expect(withoutGlitches(points)).toEqual(points);
  });
});

describe('thinning a trail for a map', () => {
  const point = (metresEast: number, routeState = TrackRouteState.NO_TRIP) => ({
    ...destinationPoint(start, 90, metresEast),
    routeState,
  });

  it('spends the budget on the drive, not on hours parked in one spot', () => {
    const parked = Array.from({ length: 5_000 }, () => point(0));
    const drive = Array.from({ length: 200 }, (_, step) => point((step + 1) * 25));
    const thinned = thinTrail([...parked, ...drive], 1_500);
    expect(thinned).toHaveLength(201);
    expect(thinned.slice(1)).toEqual(drive);
  });

  it('keeps a colour change even inside a few metres', () => {
    const points = [point(0), point(2), point(4, TrackRouteState.ON_ROUTE), point(6, TrackRouteState.ON_ROUTE)];
    expect(thinTrail(points, 100)).toEqual([points[0], points[2], points[3]]);
  });

  it('still samples a drive longer than the budget, ends and colour changes kept', () => {
    const drive = Array.from({ length: 3_000 }, (_, step) =>
      point(step * 20, step === 1_234 ? TrackRouteState.OFF_ROUTE : TrackRouteState.ON_ROUTE),
    );
    const thinned = thinTrail(drive, 1_000);
    expect(thinned.length).toBeLessThanOrEqual(1_003);
    expect(thinned[0]).toBe(drive[0]);
    expect(thinned[thinned.length - 1]).toBe(drive[drive.length - 1]);
    expect(thinned).toContain(drive[1_234]);
    expect(thinned).toContain(drive[1_235]);
  });
});
