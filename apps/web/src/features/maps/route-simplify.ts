import { toRadians, type LatLng } from '@saarthi/shared';

/**
 * Fit a road route under a point budget without pulling it off the road.
 *
 * The stored route is what deviation is judged against — a vehicle is off it
 * past 120 m and back on inside 80 m — so the thinned line has to stay within a
 * few tens of metres of the road everywhere. The shared `decimatePath` keeps
 * one vertex per stretch of distance; stretched far enough to fit a long route
 * under the budget, that spaces them hundreds of metres apart and cuts straight
 * across every ghat hairpin, so a driver taking the bend exactly as planned
 * would be painted off route.
 *
 * Douglas–Peucker instead keeps the vertices that hold the shape, with a
 * guaranteed maximum offset. The tolerance starts tight and doubles until the
 * result fits, so a short route keeps near-full detail and only a very long one
 * gives any up.
 */

const STARTING_TOLERANCE_METRES = 5;

/** Metres per degree of latitude, as the shared geo maths uses. */
const METRES_PER_DEGREE = 111_320;

/**
 * Douglas–Peucker, iterative so a long route cannot overflow the call stack.
 *
 * Offsets use the same planar approximation as the shared `distanceToSegment`
 * (scaled at the span's start, accurate at road scale), but with the scale and
 * the chord worked out once per span. Calling that function per vertex redid a
 * haversine and a cosine every time, which held the dispatch click for close to
 * two seconds on a 50 000-vertex route.
 */
function simplifyWithin(path: readonly LatLng[], toleranceMetres: number): LatLng[] {
  const keep = new Uint8Array(path.length);
  keep[0] = 1;
  keep[path.length - 1] = 1;

  const spans: [number, number][] = [[0, path.length - 1]];
  while (spans.length > 0) {
    const [start, end] = spans.pop()!;
    const origin = path[start]!;
    const lngScale = METRES_PER_DEGREE * Math.cos(toRadians(origin.latitude));
    const ex = (path[end]!.longitude - origin.longitude) * lngScale;
    const ey = (path[end]!.latitude - origin.latitude) * METRES_PER_DEGREE;
    const chordSquared = ex * ex + ey * ey;

    // Compared squared, so the inner loop never takes a square root.
    let furthest = -1;
    let furthestSquared = toleranceMetres * toleranceMetres;

    for (let index = start + 1; index < end; index += 1) {
      const point = path[index]!;
      const px = (point.longitude - origin.longitude) * lngScale;
      const py = (point.latitude - origin.latitude) * METRES_PER_DEGREE;
      const along =
        chordSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * ex + py * ey) / chordSquared));
      const dx = px - along * ex;
      const dy = py - along * ey;
      const offsetSquared = dx * dx + dy * dy;
      if (offsetSquared > furthestSquared) {
        furthest = index;
        furthestSquared = offsetSquared;
      }
    }

    if (furthest !== -1) {
      keep[furthest] = 1;
      spans.push([start, furthest], [furthest, end]);
    }
  }

  return path.filter((_, index) => keep[index] === 1);
}

/** At most `maxPoints` vertices (never fewer than the two ends), both ends kept. */
export function simplifyRoute(path: readonly LatLng[], maxPoints: number): LatLng[] {
  // The ends always survive, so a budget below two could never be met.
  const budget = Math.max(2, maxPoints);
  if (path.length <= budget) return [...path];

  let tolerance = STARTING_TOLERANCE_METRES;
  let simplified = simplifyWithin(path, tolerance);
  while (simplified.length > budget) {
    tolerance *= 2;
    simplified = simplifyWithin(path, tolerance);
  }
  return simplified;
}
