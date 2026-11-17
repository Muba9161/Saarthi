import { describe, expect, it } from 'vitest';
import { destinationPoint, distanceToPath } from '@saarthi/shared';
import { glidePath } from './glide-path';

const start = { latitude: 26.8467, longitude: 80.9462 };
// 40 m east to a corner, then 40 m north: one upload's worth of road round a bend.
const corner = destinationPoint(start, 90, 40);
const road = [
  start,
  destinationPoint(start, 90, 20),
  corner,
  destinationPoint(corner, 0, 20),
  destinationPoint(corner, 0, 40),
];
const end = road[road.length - 1]!;

describe('the way the live marker glides', () => {
  it('goes round the corner the trail shows instead of cutting across it', () => {
    const path = glidePath(start, end, road);
    expect(distanceToPath(corner, path)).toBeLessThan(1);
    expect(path[0]).toEqual(start);
    expect(path[path.length - 1]).toEqual(end);
  });

  it('starts from where the marker is drawn, part way along the road', () => {
    const midway = destinationPoint(start, 90, 10);
    const path = glidePath(midway, end, road);
    expect(path[0]).toEqual(midway);
    expect(distanceToPath(corner, path)).toBeLessThan(1);
  });

  it('goes straight when the road drawn does not reach back to the marker', () => {
    const faraway = destinationPoint(start, 180, 500);
    expect(glidePath(faraway, end, road)).toEqual([faraway, end]);
    expect(glidePath(start, end, undefined)).toEqual([start, end]);
  });

  it('ignores a few metres of GPS wander, so a waiting vehicle does not spin', () => {
    const jitter = [start, destinationPoint(start, 45, 1), destinationPoint(start, 200, 1.5)];
    const to = destinationPoint(start, 90, 2);
    expect(glidePath(start, to, jitter)).toEqual([start, to]);
  });
});
