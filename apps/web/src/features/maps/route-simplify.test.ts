import { describe, expect, it } from 'vitest';
import { distanceToPath, type LatLng } from '@saarthi/shared';
import { simplifyRoute } from './route-simplify';

/** Roughly 11 m per step along a line of latitude, near Pune. */
function straightRoad(steps: number): LatLng[] {
  return Array.from({ length: steps }, (_, index) => ({
    latitude: 18.5,
    longitude: 73.8 + index * 0.0001,
  }));
}

describe('simplifyRoute', () => {
  it('returns a route already within the budget unchanged', () => {
    const road = straightRoad(50);
    expect(simplifyRoute(road, 2000)).toEqual(road);
  });

  it('fits the budget and keeps both ends', () => {
    // A long wiggling road: a sine wave of ~60 m amplitude over 20 000 points.
    const road = Array.from({ length: 20_000 }, (_, index) => ({
      latitude: 18.5 + Math.sin(index / 25) * 0.00055,
      longitude: 73.8 + index * 0.0001,
    }));

    const simplified = simplifyRoute(road, 2000);

    expect(simplified.length).toBeLessThanOrEqual(2000);
    expect(simplified[0]).toEqual(road[0]);
    expect(simplified[simplified.length - 1]).toEqual(road[road.length - 1]);
  });

  it('keeps a hairpin that a distance stride would cut across', () => {
    const road = straightRoad(3000);
    // A 400 m spur out and back in the middle of the road — a ghat hairpin.
    const tip = { latitude: 18.5036, longitude: road[1500]!.longitude };
    road.splice(1500, 0, tip);

    const simplified = simplifyRoute(road, 100);

    expect(distanceToPath(tip, simplified)).toBeLessThan(1);
  });

  it('never loops on a budget smaller than the two ends', () => {
    const simplified = simplifyRoute(straightRoad(10), 1);
    expect(simplified).toHaveLength(2);
  });
});
