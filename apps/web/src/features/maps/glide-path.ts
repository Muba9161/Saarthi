import { distanceToSegment, haversineDistance, type LatLng } from '@saarthi/shared';

/** How far back along the trail the marker's drawn position is looked for. */
const LOOK_BACK = 30;

/** Further than this from the road drawn, the marker is not on it — a first fix, or after a gap. */
const MAX_JOIN_METRES = 25;

/** Closer than this to the last point taken, a trail point is GPS wander, not road. */
const MIN_STEP_METRES = 3;

/**
 * The way the marker goes from where it is drawn to a new fix: through the
 * trail points between them, so it follows the road round a bend the trail
 * shows rather than cutting across the corner. Straight from → to when the
 * trail does not reach back to where the marker is.
 */
export function glidePath(
  from: LatLng,
  to: LatLng,
  trail: readonly LatLng[] | undefined,
): LatLng[] {
  if (!trail || trail.length < 2) return [from, to];

  // The stretch of road the marker is on: the nearest of the latest segments.
  let segmentEnd = -1;
  let nearestMetres = MAX_JOIN_METRES;
  for (let index = Math.max(1, trail.length - LOOK_BACK); index < trail.length; index += 1) {
    const metres = distanceToSegment(from, trail[index - 1]!, trail[index]!);
    if (metres <= nearestMetres) {
      segmentEnd = index;
      nearestMetres = metres;
    }
  }
  if (segmentEnd < 0) return [from, to];

  const path: LatLng[] = [from];
  for (const point of trail.slice(segmentEnd)) {
    if (haversineDistance(path[path.length - 1]!, point) >= MIN_STEP_METRES) path.push(point);
  }
  // The fix is where the glide ends: it stands in for a road point just short of it.
  if (path.length > 1 && haversineDistance(path[path.length - 1]!, to) < MIN_STEP_METRES) {
    path[path.length - 1] = to;
  } else {
    path.push(to);
  }
  return path;
}
