import { bearing, haversineDistance, toRadians, type LatLng } from '@saarthi/shared';
import type { NavigationRoute, RouteStep } from './directions';

/**
 * Turn a live GPS fix into navigation state: how far along the route the vehicle
 * is, which manoeuvre is next, what is left to drive and whether the driver has
 * left the route entirely.
 *
 * This runs on every position tick for every followed vehicle, so it stays
 * allocation-light and works in a local planar approximation — accurate to well
 * under a metre at road scale, and far cheaper than haversine per segment.
 */

export interface RouteProgress {
  /** Position snapped onto the route line. */
  snapped: LatLng;
  travelledMeters: number;
  remainingMeters: number;
  remainingSeconds: number;
  /** Wall-clock arrival estimate, epoch milliseconds. */
  etaEpochMs: number;
  completedFraction: number;
  /** Flattened index across all legs. */
  activeStepIndex: number;
  activeStep: RouteStep | null;
  nextStep: RouteStep | null;
  /** Distance still to drive before the active step's manoeuvre. */
  distanceToManeuverMeters: number;
  /** Perpendicular distance from the vehicle to the route line. */
  offRouteMeters: number;
  isOffRoute: boolean;
  /** Heading of the route at the snapped position — drives the chase camera. */
  routeBearing: number;
  arrived: boolean;
}

/** Default tolerance before a vehicle counts as having left the route. */
export const OFF_ROUTE_THRESHOLD_METERS = 90;
/** Within this distance of the final waypoint the trip counts as arrived. */
export const ARRIVAL_THRESHOLD_METERS = 45;

/** Every step of every leg, in driving order. */
export function flattenSteps(route: NavigationRoute): RouteStep[] {
  return route.legs.flatMap((leg) => leg.steps);
}

interface Projection {
  segmentIndex: number;
  /** Position along the segment, 0..1. */
  t: number;
  distanceMeters: number;
}

/** Nearest point on the polyline to `position`, in planar approximation. */
function project(position: LatLng, geometry: readonly LatLng[]): Projection | null {
  if (geometry.length < 2) return null;

  const latScale = 111_320;
  const lngScale = 111_320 * Math.cos(toRadians(position.latitude));

  let best: Projection | null = null;

  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1]!;
    const end = geometry[index]!;

    const ex = (end.longitude - start.longitude) * lngScale;
    const ey = (end.latitude - start.latitude) * latScale;
    const lengthSquared = ex * ex + ey * ey;
    if (lengthSquared === 0) continue;

    const px = (position.longitude - start.longitude) * lngScale;
    const py = (position.latitude - start.latitude) * latScale;

    const t = Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared));
    const dx = px - t * ex;
    const dy = py - t * ey;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (!best || distance < best.distanceMeters) {
      best = { segmentIndex: index - 1, t, distanceMeters: distance };
    }
  }

  return best;
}

function interpolatePoint(start: LatLng, end: LatLng, t: number): LatLng {
  return {
    latitude: start.latitude + (end.latitude - start.latitude) * t,
    longitude: start.longitude + (end.longitude - start.longitude) * t,
  };
}

export interface RouteProgressOptions {
  offRouteThresholdMeters?: number;
  now?: number;
}

/**
 * Progress of `position` along `route`. Returns `null` only when the route has
 * no usable geometry, so callers can treat a result as always complete.
 */
export function computeRouteProgress(
  route: NavigationRoute,
  position: LatLng,
  options: RouteProgressOptions = {},
): RouteProgress | null {
  const geometry = route.geometry;
  if (geometry.length < 2) return null;

  const projection = project(position, geometry);
  if (!projection) return null;

  const start = geometry[projection.segmentIndex]!;
  const end = geometry[projection.segmentIndex + 1]!;
  const segmentLength = haversineDistance(start, end);

  const distanceAtSegmentStart = route.distancesAlong[projection.segmentIndex] ?? 0;
  const totalMeters = route.distancesAlong[route.distancesAlong.length - 1] ?? route.distanceMeters;

  const travelledMeters = Math.min(
    totalMeters,
    distanceAtSegmentStart + segmentLength * projection.t,
  );
  const remainingMeters = Math.max(0, totalMeters - travelledMeters);

  const steps = flattenSteps(route);
  // The active step is the first one whose manoeuvre is still ahead.
  let activeStepIndex = steps.findIndex((step) => step.distanceFromStartMeters > travelledMeters + 1);
  if (activeStepIndex === -1) activeStepIndex = Math.max(0, steps.length - 1);

  const activeStep = steps[activeStepIndex] ?? null;
  const nextStep = steps[activeStepIndex + 1] ?? null;

  const distanceToManeuverMeters = activeStep
    ? Math.max(0, activeStep.distanceFromStartMeters - travelledMeters)
    : remainingMeters;

  // Remaining time from the step ledger rather than a flat scaling of the total,
  // so a slow city tail is not averaged away by a fast highway middle.
  let remainingSeconds = 0;
  if (activeStep) {
    const fractionLeftOfActive =
      activeStep.distanceMeters > 0
        ? Math.min(1, distanceToManeuverMeters / activeStep.distanceMeters)
        : 0;
    remainingSeconds += activeStep.durationSeconds * fractionLeftOfActive;
    for (let index = activeStepIndex + 1; index < steps.length; index += 1) {
      remainingSeconds += steps[index]!.durationSeconds;
    }
  } else {
    const fraction = totalMeters > 0 ? remainingMeters / totalMeters : 0;
    remainingSeconds = route.durationSeconds * fraction;
  }

  const now = options.now ?? Date.now();
  const threshold = options.offRouteThresholdMeters ?? OFF_ROUTE_THRESHOLD_METERS;
  const destination = geometry[geometry.length - 1]!;

  return {
    snapped: interpolatePoint(start, end, projection.t),
    travelledMeters,
    remainingMeters,
    remainingSeconds,
    etaEpochMs: now + remainingSeconds * 1000,
    completedFraction: totalMeters > 0 ? travelledMeters / totalMeters : 0,
    activeStepIndex,
    activeStep,
    nextStep,
    distanceToManeuverMeters,
    offRouteMeters: projection.distanceMeters,
    isOffRoute: projection.distanceMeters > threshold,
    routeBearing: bearing(start, end),
    arrived: haversineDistance(position, destination) <= ARRIVAL_THRESHOLD_METERS,
  };
}

/**
 * The portion of the route still ahead of the vehicle. Drawing this separately
 * from the full line is what lets the map dim the road already driven.
 */
export function remainingGeometry(route: NavigationRoute, travelledMeters: number): LatLng[] {
  const geometry = route.geometry;
  if (geometry.length < 2) return [...geometry];

  const index = route.distancesAlong.findIndex((distance) => distance >= travelledMeters);
  if (index <= 0) return [...geometry];

  const previousDistance = route.distancesAlong[index - 1] ?? 0;
  const currentDistance = route.distancesAlong[index] ?? previousDistance;
  const span = currentDistance - previousDistance;
  const t = span > 0 ? (travelledMeters - previousDistance) / span : 0;

  const entry = interpolatePoint(geometry[index - 1]!, geometry[index]!, t);
  return [entry, ...geometry.slice(index)];
}

/** Formats a distance the way a navigation banner does: metres, then km. */
export function formatManeuverDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 50) return 'Now';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

/** Compact duration for ETA chips: "42 min", "3 h 10 min". */
export function formatEtaDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** Clock time of arrival, e.g. "18:42". */
export function formatEtaClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}
