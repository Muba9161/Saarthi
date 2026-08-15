/**
 * Pure geospatial helpers shared by the tracking pipeline, SOS matcher,
 * nearby-services search, GPS simulator and the map UI.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export const EARTH_RADIUS_METERS = 6_371_008.8;

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Great-circle distance in metres. */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceKm(a: LatLng, b: LatLng): number {
  return haversineDistance(a, b) / 1000;
}

/** Initial bearing from `a` to `b`, normalised to [0, 360). */
export function bearing(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLng = toRadians(b.longitude - a.longitude);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Point at `distanceMeters` along `bearingDegrees` from `origin`. */
export function destinationPoint(
  origin: LatLng,
  bearingDegrees: number,
  distanceMeters: number,
): LatLng {
  const angular = distanceMeters / EARTH_RADIUS_METERS;
  const theta = toRadians(bearingDegrees);
  const lat1 = toRadians(origin.latitude);
  const lng1 = toRadians(origin.longitude);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(theta),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    latitude: toDegrees(lat2),
    longitude: ((toDegrees(lng2) + 540) % 360) - 180,
  };
}

/** Linear interpolation between two coordinates (`t` in [0, 1]). */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * clamped,
    longitude: a.longitude + (b.longitude - a.longitude) * clamped,
  };
}

/** Total length in metres of a polyline. */
export function pathLength(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (previous && current) total += haversineDistance(previous, current);
  }
  return total;
}

/** Cumulative distance (metres) at each vertex of a polyline. */
export function cumulativeDistances(points: readonly LatLng[]): number[] {
  const result: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) {
      const previous = points[i - 1];
      const current = points[i];
      if (previous && current) total += haversineDistance(previous, current);
    }
    result.push(total);
  }
  return result;
}

export interface PointOnPath {
  position: LatLng;
  /** Index of the segment start vertex. */
  segmentIndex: number;
  /** Heading along the current segment, degrees. */
  heading: number;
}

/**
 * Resolve the coordinate that lies `distanceMeters` along a polyline.
 * Used by the GPS simulator and by trip-replay scrubbing.
 */
export function pointAtDistance(points: readonly LatLng[], distanceMeters: number): PointOnPath {
  if (points.length === 0) {
    throw new Error('pointAtDistance requires at least one coordinate');
  }
  const first = points[0]!;
  if (points.length === 1 || distanceMeters <= 0) {
    return { position: first, segmentIndex: 0, heading: 0 };
  }

  let remaining = distanceMeters;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const segment = haversineDistance(from, to);
    if (segment === 0) continue;
    if (remaining <= segment) {
      return {
        position: interpolate(from, to, remaining / segment),
        segmentIndex: i - 1,
        heading: bearing(from, to),
      };
    }
    remaining -= segment;
  }

  const last = points[points.length - 1]!;
  const secondLast = points[points.length - 2] ?? last;
  return {
    position: last,
    segmentIndex: points.length - 2,
    heading: bearing(secondLast, last),
  };
}

/** Shortest distance (metres) from a point to a great-circle segment. */
export function distanceToSegment(point: LatLng, start: LatLng, end: LatLng): number {
  const segmentLength = haversineDistance(start, end);
  if (segmentLength === 0) return haversineDistance(point, start);

  // Work in a local planar approximation — accurate enough for road-scale spans.
  const latScale = 111_320;
  const lngScale = 111_320 * Math.cos(toRadians(start.latitude));

  const px = (point.longitude - start.longitude) * lngScale;
  const py = (point.latitude - start.latitude) * latScale;
  const ex = (end.longitude - start.longitude) * lngScale;
  const ey = (end.latitude - start.latitude) * latScale;

  const lengthSquared = ex * ex + ey * ey;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared));
  const dx = px - t * ex;
  const dy = py - t * ey;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Shortest distance (metres) from a point to a polyline. */
export function distanceToPath(point: LatLng, path: readonly LatLng[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return haversineDistance(point, path[0]!);

  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i += 1) {
    min = Math.min(min, distanceToSegment(point, path[i - 1]!, path[i]!));
  }
  return min;
}

/** Bounding box that contains every supplied point, padded by `paddingMeters`. */
export function boundingBox(
  points: readonly LatLng[],
  paddingMeters = 0,
): { south: number; west: number; north: number; east: number } | null {
  if (points.length === 0) return null;
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const point of points) {
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
  }
  if (paddingMeters > 0) {
    const latPad = paddingMeters / 111_320;
    const midLat = (south + north) / 2;
    const lngPad = paddingMeters / (111_320 * Math.max(0.1, Math.cos(toRadians(midLat))));
    south -= latPad;
    north += latPad;
    west -= lngPad;
    east += lngPad;
  }
  return { south, west, north, east };
}

/** Compass label for a heading, e.g. 47 → "NE". */
export function compassDirection(headingDegrees: number): string {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round((((headingDegrees % 360) + 360) % 360) / 45) % 8;
  return labels[index] ?? 'N';
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Degrees of latitude/longitude that cover `radiusMeters` — used to build a
 * cheap indexed pre-filter before the exact haversine pass.
 */
export function boundingDeltas(
  latitude: number,
  radiusMeters: number,
): { latDelta: number; lngDelta: number } {
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.max(0.05, Math.cos(toRadians(latitude))));
  return { latDelta, lngDelta };
}
