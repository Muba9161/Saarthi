import { TrackRouteState } from './enums';
import { distanceToPath, haversineDistance, type LatLng } from './geo';

/**
 * The covered-path trail: where a vehicle has been, coloured by how it got
 * there — blue with no trip, green on the trip's planned route, red off it,
 * and amber on another road to the destination while Google Maps guides.
 *
 * Judged once, at ingest, by {@link nextRouteState}, and stored on each point.
 * The web map, the driver app and the replay then draw the same colours from
 * the same stored answer instead of each re-deciding with its own threshold.
 */

/** Further than this from the planned route and the vehicle has left it. */
export const ROUTE_TRAIL_LEAVE_METRES = 120;

/**
 * Back within this and it has rejoined.
 *
 * Lower than the leaving distance on purpose. A vehicle driving along the edge
 * of the corridor would otherwise flicker red and green with every GPS wobble.
 */
export const ROUTE_TRAIL_REJOIN_METRES = 80;

/**
 * Whether a planned route can be judged against at all.
 *
 * A trip created without road geometry stores its two ends as a straight line.
 * Measuring a road journey against that would paint every bend red, so such a
 * trip is shown as "on its trip" rather than accused of deviating from a line
 * nobody could drive.
 */
export function isRoadRoute(route: readonly LatLng[] | null | undefined): boolean {
  return (route?.length ?? 0) > 2;
}

export interface RouteStateInput {
  /** A dispatched trip is moving (started, in transit, delayed, emergency). */
  tripUnderway: boolean;
  route: readonly LatLng[] | null;
  position: LatLng;
  /** The previous point's state, for the hysteresis band. */
  previous: TrackRouteState | null;
}

/**
 * On the planned route or off it — the geometry alone.
 *
 * Off is always OFF_ROUTE here. Whether an off-route stretch is an alternate
 * road the driver's navigation app chose is a separate question, asked by the
 * caller with {@link stillHeadingThere} only while the trip is handed off.
 */
export function nextRouteState({
  tripUnderway,
  route,
  position,
  previous,
}: RouteStateInput): TrackRouteState {
  if (!tripUnderway) return TrackRouteState.NO_TRIP;
  if (!route || !isRoadRoute(route)) return TrackRouteState.ON_ROUTE;

  const offRouteMetres = distanceToPath(position, route);
  if (offRouteMetres > ROUTE_TRAIL_LEAVE_METRES) return TrackRouteState.OFF_ROUTE;
  if (offRouteMetres < ROUTE_TRAIL_REJOIN_METRES) return TrackRouteState.ON_ROUTE;
  return isOffRoute(previous) ? TrackRouteState.OFF_ROUTE : TrackRouteState.ON_ROUTE;
}

/** Off the planned road, whichever way it is coloured. */
export function isOffRoute(state: TrackRouteState | null | undefined): boolean {
  return state === TrackRouteState.OFF_ROUTE || state === TrackRouteState.ALTERNATE;
}

/**
 * How far back "still heading for the destination?" looks.
 *
 * Long enough that a road which swings away for a bend, a flyover loop or a
 * U-turn under a highway is not read as turning back; short enough that a
 * vehicle genuinely driving the wrong way shows red within minutes.
 */
export const ALTERNATE_LOOKBACK_MS = 3 * 60_000;

/** Further from the destination than this, over the lookback, is moving away. */
export const ALTERNATE_AWAY_METRES = 300;

/**
 * Whether a vehicle off its planned road is still on its way.
 *
 * Asked only while the driver is following another navigation app, which
 * picks its own roads and cannot tell Saarthi which. Saarthi cannot see that
 * app's route, so this is the honest test it can make: no further from the
 * destination than a few minutes ago, give or take a bend. With nothing to
 * compare against yet — the handoff has only just happened — the benefit of
 * the doubt goes to the driver.
 */
export function stillHeadingThere(
  earlierMetresToGo: number | null,
  nowMetresToGo: number,
): boolean {
  return earlierMetresToGo === null || nowMetresToGo <= earlierMetresToGo + ALTERNATE_AWAY_METRES;
}

export interface TrailPoint extends LatLng {
  routeState: TrackRouteState;
}

export interface TrailRun {
  state: TrackRouteState;
  points: LatLng[];
}

/**
 * The trail as runs of one colour each.
 *
 * Every run after the first starts at the previous run's last point, so the
 * drawn line is continuous where the colour changes instead of leaving a gap
 * the width of one GPS interval.
 */
export function trailRuns(points: readonly TrailPoint[]): TrailRun[] {
  const runs: TrailRun[] = [];
  for (const point of points) {
    const at = { latitude: point.latitude, longitude: point.longitude };
    const current = runs[runs.length - 1];
    if (current && current.state === point.routeState) {
      current.points.push(at);
      continue;
    }
    const joint = current?.points[current.points.length - 1];
    runs.push({ state: point.routeState, points: joint ? [joint, at] : [at] });
  }
  return runs.filter((run) => run.points.length >= 2);
}

/** Closer than this to the last point kept, a point adds nothing a map can show. */
export const TRAIL_STEP_METRES = 10;

/**
 * Thin a trail to at most `limit` points without losing a colour change.
 *
 * Points that did not move the vehicle on go first: a shift is mostly parked,
 * and sampling at a stride spent nearly the whole budget on one spot, so a
 * drive across town kept a point every half-minute and was drawn as straight
 * lines cutting across the blocks it drove round. Only then is the rest
 * sampled. Every point where the state changes is kept, as are the first and
 * last, so a short deviation survives the sampling that a plain stride would
 * skip over.
 */
export function thinTrail<T extends TrailPoint>(points: readonly T[], limit: number): T[] {
  const moved = movedOn(points);
  if (moved.length <= limit) return moved;
  const stride = Math.ceil(moved.length / limit);
  return moved.filter(
    (point, index) =>
      index === 0 ||
      index === moved.length - 1 ||
      index % stride === 0 ||
      point.routeState !== moved[index - 1]!.routeState,
  );
}

/** The points where the vehicle had moved on from the last one kept, or the trail changed colour. */
function movedOn<T extends TrailPoint>(points: readonly T[]): T[] {
  const kept: T[] = [];
  points.forEach((point, index) => {
    const last = kept[kept.length - 1];
    if (
      !last ||
      index === points.length - 1 ||
      point.routeState !== last.routeState ||
      haversineDistance(last, point) >= TRAIL_STEP_METRES
    ) {
      kept.push(point);
    }
  });
  return kept;
}

/** A stored position, as far as telling a glitch from a journey needs. */
export interface TrailFix extends LatLng {
  recordedAt: Date | string;
  /** Metres of uncertainty, when the source reported it. */
  accuracy?: number | null;
}

/** Faster than this between two points is a position the vehicle never reached. */
export const GLITCH_MAX_KPH = 180;

/** A point placed less precisely than this is not drawn at all. */
export const GLITCH_ACCURACY_METRES = 100;

/** Closer than this to the last kept point is ordinary wander, not a jump out. */
const EXCURSION_MIN_METRES = 15;

/** Out and back to the same spot within this, and what lay between was a jump. */
const EXCURSION_WINDOW_MS = 90_000;

/** No more points than this in one jump: a real loop back to the start takes many more. */
const EXCURSION_MAX_POINTS = 4;

function timeOf(fix: TrailFix): number {
  return fix.recordedAt instanceof Date ? fix.recordedAt.getTime() : Date.parse(fix.recordedAt);
}

function sharpEnough(fix: TrailFix): boolean {
  return fix.accuracy === null || fix.accuracy === undefined || fix.accuracy <= GLITCH_ACCURACY_METRES;
}

/** Whether getting from `a` to `b` in the time between them is faster than any vehicle drives. */
function unreachable(a: TrailFix, b: TrailFix): boolean {
  const metres = haversineDistance(a, b);
  const seconds = (timeOf(b) - timeOf(a)) / 1000;
  if (seconds <= 0) return metres > EXCURSION_MIN_METRES;
  return (metres / seconds) * 3.6 > GLITCH_MAX_KPH;
}

/**
 * How many points from `from` on jumped out from `anchor` and came straight
 * back to it — or 0 when the vehicle really went somewhere.
 */
function excursionLength(anchor: TrailFix, points: readonly TrailFix[], from: number): number {
  let nearest = haversineDistance(anchor, points[from]!);
  if (nearest <= EXCURSION_MIN_METRES) return 0;
  const end = Math.min(points.length, from + 1 + EXCURSION_MAX_POINTS);
  for (let index = from + 1; index < end; index += 1) {
    const point = points[index]!;
    if (timeOf(point) - timeOf(anchor) > EXCURSION_WINDOW_MS) return 0;
    const away = haversineDistance(anchor, point);
    if (away <= nearest / 2) return index - from;
    nearest = Math.min(nearest, away);
  }
  return 0;
}

/**
 * A covered path without its GPS glitches.
 *
 * A parked phone, indoors or under a roof, now and then reports a position
 * tens or hundreds of metres away for a fix or three and is back where it was
 * seconds later. Drawn, those points made a star of lines around a stationary
 * vehicle; summed, they made distance it never covered. So a point is dropped
 * when it was placed badly, when it was part of a short out-and-back to the
 * same spot, or when the vehicle could neither have got there nor got back in
 * the time. Every other point is kept as it was — this never smooths a real
 * road, and a stop just off it (a pump, a dhaba) outlasts the window.
 */
export function withoutGlitches<T extends TrailFix>(points: readonly T[]): T[] {
  const sharp = points.filter(sharpEnough);
  const kept: T[] = [];
  for (let index = 0; index < sharp.length; index += 1) {
    const point = sharp[index]!;
    const anchor = kept[kept.length - 1];
    if (anchor) {
      const jump = excursionLength(anchor, sharp, index);
      if (jump > 0) {
        index += jump - 1;
        continue;
      }
      const next = sharp[index + 1];
      if (next && unreachable(anchor, point) && unreachable(point, next)) continue;
    }
    kept.push(point);
  }
  return kept;
}
