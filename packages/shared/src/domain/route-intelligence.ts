/**
 * Route intelligence — signals, cameras, checkpoints and live road conditions.
 *
 * Honesty is the design constraint here. There is no national live feed of
 * traffic-signal phases in India, and no authoritative feed of where police are
 * checking today. Rather than invent numbers, every value carries a tier:
 *
 *   STATIC    — a fixed feature at a fixed place (camera, toll, junction)
 *   PREDICTED — computed from a known cycle or a recurring pattern
 *   LIVE      — reported now by a driver, decaying with age
 *
 * A predicted signal phase is always labelled predicted. Showing it as live
 * would put a wrong number in front of a driver at 60 km/h.
 */

import {
  AlertSeverity,
  RouteHazardKind,
  RouteHazardSource,
  RouteHazardTier,
  SignalPhase,
} from './enums';
import { bearing, cumulativeDistances, distanceToSegment, haversineDistance, type LatLng } from './geo';

export interface RouteHazardKindDefinition {
  kind: RouteHazardKind;
  label: string;
  /** Short line shown in the driver alert strip. */
  alertText: string;
  tier: RouteHazardTier;
  severity: AlertSeverity;
  /** Default alert radius in metres. */
  radiusMeters: number;
  /** Whether the hazard is inherently temporary. */
  transient: boolean;
  /** Grouping used for the map legend and layer toggles. */
  group: 'enforcement' | 'signals' | 'infrastructure' | 'conditions' | 'safety';
  /** Announce this one by voice in the driver app. */
  announce: boolean;
}

export const ROUTE_HAZARD_CATALOGUE: RouteHazardKindDefinition[] = [
  {
    kind: RouteHazardKind.TRAFFIC_SIGNAL,
    label: 'Traffic signal',
    alertText: 'Traffic signal ahead',
    tier: RouteHazardTier.PREDICTED,
    severity: AlertSeverity.INFO,
    radiusMeters: 120,
    transient: false,
    group: 'signals',
    announce: false,
  },
  {
    kind: RouteHazardKind.SPEED_CAMERA,
    label: 'Speed camera',
    alertText: 'Speed camera ahead',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.WARNING,
    radiusMeters: 300,
    transient: false,
    group: 'enforcement',
    announce: true,
  },
  {
    kind: RouteHazardKind.RED_LIGHT_CAMERA,
    label: 'Red light camera',
    alertText: 'Red light camera ahead',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.WARNING,
    radiusMeters: 200,
    transient: false,
    group: 'enforcement',
    announce: true,
  },
  {
    kind: RouteHazardKind.AVERAGE_SPEED_ZONE,
    label: 'Average speed zone',
    alertText: 'Average speed check zone',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.WARNING,
    radiusMeters: 500,
    transient: false,
    group: 'enforcement',
    announce: true,
  },
  {
    kind: RouteHazardKind.POLICE_CHECKPOINT,
    label: 'Police checking',
    alertText: 'Police checking ahead',
    tier: RouteHazardTier.LIVE,
    severity: AlertSeverity.WARNING,
    radiusMeters: 400,
    transient: true,
    group: 'enforcement',
    announce: true,
  },
  {
    kind: RouteHazardKind.RTO_CHECKPOST,
    label: 'RTO checkpost',
    alertText: 'RTO checkpost ahead',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.INFO,
    radiusMeters: 400,
    transient: false,
    group: 'enforcement',
    announce: true,
  },
  {
    kind: RouteHazardKind.TOLL_PLAZA,
    label: 'Toll plaza',
    alertText: 'Toll plaza ahead',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.INFO,
    radiusMeters: 500,
    transient: false,
    group: 'infrastructure',
    announce: true,
  },
  {
    kind: RouteHazardKind.WEIGHBRIDGE,
    label: 'Weighbridge',
    alertText: 'Weighbridge ahead',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.INFO,
    radiusMeters: 400,
    transient: false,
    group: 'infrastructure',
    announce: true,
  },
  {
    kind: RouteHazardKind.BORDER_CHECKPOST,
    label: 'State border checkpost',
    alertText: 'State border checkpost ahead',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.INFO,
    radiusMeters: 600,
    transient: false,
    group: 'infrastructure',
    announce: true,
  },
  {
    kind: RouteHazardKind.SPEED_BREAKER,
    label: 'Speed breaker',
    alertText: 'Speed breaker',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.INFO,
    radiusMeters: 80,
    transient: false,
    group: 'safety',
    announce: false,
  },
  {
    kind: RouteHazardKind.SHARP_CURVE,
    label: 'Sharp curve',
    alertText: 'Sharp curve ahead',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.WARNING,
    radiusMeters: 200,
    transient: false,
    group: 'safety',
    announce: true,
  },
  {
    kind: RouteHazardKind.STEEP_GRADIENT,
    label: 'Steep gradient',
    alertText: 'Steep gradient ahead',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.WARNING,
    radiusMeters: 400,
    transient: false,
    group: 'safety',
    announce: true,
  },
  {
    kind: RouteHazardKind.ACCIDENT_PRONE_ZONE,
    label: 'Accident-prone stretch',
    alertText: 'Accident-prone stretch',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.WARNING,
    radiusMeters: 800,
    transient: false,
    group: 'safety',
    announce: true,
  },
  {
    kind: RouteHazardKind.SCHOOL_ZONE,
    label: 'School zone',
    alertText: 'School zone — slow down',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.WARNING,
    radiusMeters: 250,
    transient: false,
    group: 'safety',
    announce: true,
  },
  {
    kind: RouteHazardKind.RAILWAY_CROSSING,
    label: 'Railway crossing',
    alertText: 'Railway crossing ahead',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.WARNING,
    radiusMeters: 200,
    transient: false,
    group: 'safety',
    announce: true,
  },
  {
    kind: RouteHazardKind.NARROW_BRIDGE,
    label: 'Narrow bridge',
    alertText: 'Narrow bridge ahead',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.WARNING,
    radiusMeters: 200,
    transient: false,
    group: 'safety',
    announce: true,
  },
  {
    kind: RouteHazardKind.ROAD_WORK,
    label: 'Road work',
    alertText: 'Road work ahead',
    tier: RouteHazardTier.LIVE,
    severity: AlertSeverity.WARNING,
    radiusMeters: 500,
    transient: true,
    group: 'conditions',
    announce: true,
  },
  {
    kind: RouteHazardKind.DIVERSION,
    label: 'Diversion',
    alertText: 'Diversion ahead',
    tier: RouteHazardTier.LIVE,
    severity: AlertSeverity.WARNING,
    radiusMeters: 500,
    transient: true,
    group: 'conditions',
    announce: true,
  },
  {
    kind: RouteHazardKind.ACCIDENT,
    label: 'Accident',
    alertText: 'Accident reported ahead',
    tier: RouteHazardTier.LIVE,
    severity: AlertSeverity.CRITICAL,
    radiusMeters: 600,
    transient: true,
    group: 'conditions',
    announce: true,
  },
  {
    kind: RouteHazardKind.TRAFFIC_JAM,
    label: 'Traffic jam',
    alertText: 'Heavy traffic ahead',
    tier: RouteHazardTier.LIVE,
    severity: AlertSeverity.INFO,
    radiusMeters: 1000,
    transient: true,
    group: 'conditions',
    announce: false,
  },
  {
    kind: RouteHazardKind.WATERLOGGING,
    label: 'Waterlogging',
    alertText: 'Waterlogged road ahead',
    tier: RouteHazardTier.LIVE,
    severity: AlertSeverity.WARNING,
    radiusMeters: 500,
    transient: true,
    group: 'conditions',
    announce: true,
  },
  {
    kind: RouteHazardKind.LANDSLIDE,
    label: 'Landslide',
    alertText: 'Landslide reported ahead',
    tier: RouteHazardTier.LIVE,
    severity: AlertSeverity.CRITICAL,
    radiusMeters: 800,
    transient: true,
    group: 'conditions',
    announce: true,
  },
  {
    kind: RouteHazardKind.FOG_ZONE,
    label: 'Fog-prone stretch',
    alertText: 'Fog-prone stretch',
    tier: RouteHazardTier.PREDICTED,
    severity: AlertSeverity.WARNING,
    radiusMeters: 2000,
    transient: false,
    group: 'conditions',
    announce: true,
  },
  {
    kind: RouteHazardKind.PROTEST_BLOCKADE,
    label: 'Protest or blockade',
    alertText: 'Road blocked ahead',
    tier: RouteHazardTier.LIVE,
    severity: AlertSeverity.CRITICAL,
    radiusMeters: 1000,
    transient: true,
    group: 'conditions',
    announce: true,
  },
  {
    kind: RouteHazardKind.ANIMAL_CROSSING,
    label: 'Animal crossing',
    alertText: 'Animal crossing zone',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.INFO,
    radiusMeters: 400,
    transient: false,
    group: 'safety',
    announce: false,
  },
  {
    kind: RouteHazardKind.UNLIT_STRETCH,
    label: 'Unlit stretch',
    alertText: 'Unlit stretch ahead',
    tier: RouteHazardTier.STATIC,
    severity: AlertSeverity.INFO,
    radiusMeters: 2000,
    transient: false,
    group: 'safety',
    announce: false,
  },
];

const BY_KIND = new Map<RouteHazardKind, RouteHazardKindDefinition>(
  ROUTE_HAZARD_CATALOGUE.map((definition) => [definition.kind, definition]),
);

export function hazardKindDefinition(kind: RouteHazardKind): RouteHazardKindDefinition {
  return (
    BY_KIND.get(kind) ?? {
      kind,
      label: 'Hazard',
      alertText: 'Hazard ahead',
      tier: RouteHazardTier.LIVE,
      severity: AlertSeverity.INFO,
      radiusMeters: 300,
      transient: true,
      group: 'conditions',
      announce: false,
    }
  );
}

/** Kinds a driver may report from the road, grouped for the reporting sheet. */
export const DRIVER_REPORTABLE_KINDS: RouteHazardKind[] = [
  RouteHazardKind.POLICE_CHECKPOINT,
  RouteHazardKind.ACCIDENT,
  RouteHazardKind.TRAFFIC_JAM,
  RouteHazardKind.ROAD_WORK,
  RouteHazardKind.DIVERSION,
  RouteHazardKind.WATERLOGGING,
  RouteHazardKind.LANDSLIDE,
  RouteHazardKind.PROTEST_BLOCKADE,
  RouteHazardKind.SPEED_CAMERA,
  RouteHazardKind.SPEED_BREAKER,
  RouteHazardKind.ANIMAL_CROSSING,
];

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export const HAZARD_CONFIDENCE = {
  /** A single unverified driver report starts here. */
  initialDriverReport: 0.4,
  /** Platform and authority sources start fully trusted. */
  initialAuthoritative: 1,
  /** Confirmations from distinct organizations add this much each. */
  confirmationBoost: 0.2,
  /** A "not there" report costs this much. */
  rejectionPenalty: 0.3,
  /** Half-life of a live hazard, in minutes. */
  halfLifeMinutes: 45,
  /** Below this a hazard is retired. */
  retirementFloor: 0.15,
  /** At or above this an unverified hazard is promoted to active. */
  promotionThreshold: 0.7,
  /** Distinct organizations needed alongside the threshold to promote. */
  promotionOrganizations: 2,
} as const;

export function initialConfidence(source: RouteHazardSource): number {
  switch (source) {
    case RouteHazardSource.AUTHORITY:
    case RouteHazardSource.PLATFORM:
      return HAZARD_CONFIDENCE.initialAuthoritative;
    case RouteHazardSource.PARTNER_FEED:
      return 0.8;
    case RouteHazardSource.ASSOCIATION:
      return 0.6;
    case RouteHazardSource.TELEMETRY_DERIVED:
      return 0.55;
    case RouteHazardSource.DRIVER_REPORT:
    default:
      return HAZARD_CONFIDENCE.initialDriverReport;
  }
}

/**
 * Decay a live hazard's confidence with age.
 *
 * Static and authority-sourced hazards never decay — a speed camera does not
 * become less real overnight. Only transient, reported things fade.
 */
export function decayConfidence(input: {
  confidence: number;
  tier: RouteHazardTier;
  source: RouteHazardSource;
  lastConfirmedAt: Date;
  now?: Date;
  halfLifeMinutes?: number;
}): number {
  if (input.tier !== RouteHazardTier.LIVE) return input.confidence;
  if (input.source === RouteHazardSource.AUTHORITY) return input.confidence;

  const now = input.now ?? new Date();
  const halfLife = input.halfLifeMinutes ?? HAZARD_CONFIDENCE.halfLifeMinutes;
  const ageMinutes = Math.max(0, (now.getTime() - input.lastConfirmedAt.getTime()) / 60_000);
  const decayed = input.confidence * Math.pow(0.5, ageMinutes / halfLife);
  return Math.max(0, Math.round(decayed * 1000) / 1000);
}

/**
 * Confidence after a vote.
 *
 * Confirmations count per *organization*, not per user — otherwise one fleet
 * could manufacture consensus from its own drivers.
 */
export function applyVote(input: {
  confidence: number;
  vote: 'CONFIRM' | 'REJECT' | 'CLEARED';
  /** Distinct organizations that have confirmed, including this one. */
  confirmingOrganizations: number;
}): number {
  if (input.vote === 'CONFIRM') {
    const boost = HAZARD_CONFIDENCE.confirmationBoost * Math.min(3, input.confirmingOrganizations);
    return Math.min(1, Math.round((input.confidence + boost) * 1000) / 1000);
  }
  if (input.vote === 'CLEARED') {
    // Someone has driven past and it is gone — that is stronger than doubt.
    return Math.max(0, Math.round((input.confidence - 0.5) * 1000) / 1000);
  }
  return Math.max(0, Math.round((input.confidence - HAZARD_CONFIDENCE.rejectionPenalty) * 1000) / 1000);
}

export function shouldPromote(confidence: number, confirmingOrganizations: number): boolean {
  return (
    confidence >= HAZARD_CONFIDENCE.promotionThreshold &&
    confirmingOrganizations >= HAZARD_CONFIDENCE.promotionOrganizations
  );
}

export function shouldRetire(confidence: number): boolean {
  return confidence < HAZARD_CONFIDENCE.retirementFloor;
}

// ---------------------------------------------------------------------------
// Signal phase (predicted)
// ---------------------------------------------------------------------------

export interface SignalTiming {
  cycleSeconds: number | null;
  greenSeconds: number | null;
  offsetSeconds: number | null;
  referenceAt: Date | null;
}

export interface SignalPhaseResult {
  phase: SignalPhase;
  secondsToChange: number | null;
  /** Always true for a computed phase. The UI must surface this. */
  predicted: boolean;
}

/** Amber duration assumed when a cycle is modelled without one. */
const AMBER_SECONDS = 3;

/**
 * Predicted phase of a modelled signal.
 *
 * Returns UNKNOWN — never a guessed colour — when the cycle is not modelled.
 * A wrong "green in 4 s" is worse than no answer at all.
 */
export function predictSignalPhase(
  timing: SignalTiming,
  now: Date = new Date(),
): SignalPhaseResult {
  const { cycleSeconds, greenSeconds, offsetSeconds, referenceAt } = timing;

  if (
    cycleSeconds === null ||
    cycleSeconds <= 0 ||
    greenSeconds === null ||
    greenSeconds <= 0 ||
    referenceAt === null ||
    greenSeconds >= cycleSeconds
  ) {
    return { phase: SignalPhase.UNKNOWN, secondsToChange: null, predicted: true };
  }

  const elapsedSeconds = (now.getTime() - referenceAt.getTime()) / 1000 + (offsetSeconds ?? 0);
  // Modulo of a negative elapsed time must still land inside the cycle.
  const position = ((elapsedSeconds % cycleSeconds) + cycleSeconds) % cycleSeconds;

  const amber = Math.min(AMBER_SECONDS, Math.max(0, cycleSeconds - greenSeconds));
  const amberEnd = greenSeconds + amber;

  if (position < greenSeconds) {
    return {
      phase: SignalPhase.GREEN,
      secondsToChange: Math.ceil(greenSeconds - position),
      predicted: true,
    };
  }
  if (position < amberEnd) {
    return {
      phase: SignalPhase.AMBER,
      secondsToChange: Math.ceil(amberEnd - position),
      predicted: true,
    };
  }
  return {
    phase: SignalPhase.RED,
    secondsToChange: Math.ceil(cycleSeconds - position),
    predicted: true,
  };
}

// ---------------------------------------------------------------------------
// Recurring active windows
// ---------------------------------------------------------------------------

/**
 * Is a hazard with a recurring pattern in force now?
 *
 * Police checking at a particular junction on weekday mornings is a real,
 * useful pattern, but it is a *pattern* — hence PREDICTED, not LIVE.
 */
export function isHazardActiveNow(
  hazard: {
    daysOfWeek: number[];
    startTimeMinutes: number | null;
    endTimeMinutes: number | null;
    validFrom: Date | null;
    validUntil: Date | null;
  },
  now: Date = new Date(),
): boolean {
  if (hazard.validFrom && now < hazard.validFrom) return false;
  if (hazard.validUntil && now > hazard.validUntil) return false;
  if (hazard.daysOfWeek.length > 0 && !hazard.daysOfWeek.includes(now.getDay())) return false;

  const { startTimeMinutes, endTimeMinutes } = hazard;
  if (startTimeMinutes === null || endTimeMinutes === null) return true;

  const minute = now.getHours() * 60 + now.getMinutes();
  if (startTimeMinutes === endTimeMinutes) return true;
  if (startTimeMinutes < endTimeMinutes) {
    return minute >= startTimeMinutes && minute < endTimeMinutes;
  }
  // Window crosses midnight.
  return minute >= startTimeMinutes || minute < endTimeMinutes;
}

// ---------------------------------------------------------------------------
// Corridor matching
// ---------------------------------------------------------------------------

export interface CorridorHazard {
  id: string;
  kind: RouteHazardKind;
  location: LatLng;
  headingDegrees: number | null;
  headingToleranceDegrees: number;
  radiusMeters: number;
  severity: AlertSeverity;
  confidence: number;
}

export interface CorridorMatch<T extends CorridorHazard = CorridorHazard> {
  hazard: T;
  /** Perpendicular distance from the route line, metres. */
  offsetMeters: number;
  /** How far along the route the hazard sits, kilometres. */
  distanceAlongRouteKm: number;
  /** Seconds to reach it at the supplied average speed, when one is given. */
  etaSeconds: number | null;
}

/**
 * Reduce a polyline before corridor matching.
 *
 * A 1 200 km planned route can hold hundreds of thousands of vertices. Matching
 * every hazard against every segment would be quadratic on nothing useful, so
 * the line is thinned to one vertex per `toleranceMeters` of travel first. This
 * is distance-based decimation rather than Douglas-Peucker: cheaper, and for
 * corridor width purposes the difference is immaterial.
 */
export function decimatePath(path: readonly LatLng[], toleranceMeters = 50): LatLng[] {
  if (path.length <= 2) return [...path];

  const result: LatLng[] = [path[0]!];
  let last = path[0]!;

  for (let i = 1; i < path.length - 1; i += 1) {
    const point = path[i]!;
    if (haversineDistance(last, point) >= toleranceMeters) {
      result.push(point);
      last = point;
    }
  }
  result.push(path[path.length - 1]!);
  return result;
}

/**
 * Perpendicular distance to a segment *and* how far along it the closest point
 * lies, as a 0..1 fraction.
 *
 * `distanceToSegment` in the geo module computes the fraction internally but
 * does not return it. It is needed here: without it, a hazard is reported at the
 * *start* of its matched segment, which understates its position along the route
 * by up to a full segment — and reports the first segment as zero kilometres
 * away, giving every early hazard an ETA of zero.
 */
function projectOntoSegment(
  point: LatLng,
  start: LatLng,
  end: LatLng,
): { offsetMeters: number; fraction: number } {
  // Local planar approximation, accurate at road scale.
  const latScale = 111_320;
  const lngScale = 111_320 * Math.cos((start.latitude * Math.PI) / 180);

  const px = (point.longitude - start.longitude) * lngScale;
  const py = (point.latitude - start.latitude) * latScale;
  const ex = (end.longitude - start.longitude) * lngScale;
  const ey = (end.latitude - start.latitude) * latScale;

  const lengthSquared = ex * ex + ey * ey;
  if (lengthSquared === 0) {
    return { offsetMeters: Math.sqrt(px * px + py * py), fraction: 0 };
  }

  const fraction = Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared));
  const dx = px - fraction * ex;
  const dy = py - fraction * ey;
  return { offsetMeters: Math.sqrt(dx * dx + dy * dy), fraction };
}

/**
 * Hazards within `corridorMeters` of a route, ordered by position along it.
 *
 * The heading filter is what stops a camera on the opposite carriageway of a
 * divided highway being announced: a hazard that declares a direction only
 * matches when the route runs roughly that way at that point.
 */
export function hazardsOnRoute<T extends CorridorHazard>(
  route: readonly LatLng[],
  hazards: readonly T[],
  options: { corridorMeters?: number; averageSpeedKph?: number; minConfidence?: number } = {},
): CorridorMatch<T>[] {
  if (route.length < 2 || hazards.length === 0) return [];

  const corridorMeters = options.corridorMeters ?? 300;
  const minConfidence = options.minConfidence ?? 0;
  const path = decimatePath(route);
  const cumulative = cumulativeDistances(path);

  const matches: CorridorMatch<T>[] = [];

  for (const hazard of hazards) {
    if (hazard.confidence < minConfidence) continue;

    const threshold = corridorMeters + hazard.radiusMeters;
    let bestOffset = Number.POSITIVE_INFINITY;
    let bestSegment = -1;
    let bestFraction = 0;

    for (let i = 1; i < path.length; i += 1) {
      const start = path[i - 1]!;
      const end = path[i]!;
      const { offsetMeters, fraction } = projectOntoSegment(hazard.location, start, end);
      if (offsetMeters < bestOffset) {
        bestOffset = offsetMeters;
        bestSegment = i - 1;
        bestFraction = fraction;
      }
    }

    if (bestSegment < 0 || bestOffset > threshold) continue;

    const segmentStart = path[bestSegment]!;
    const segmentEnd = path[bestSegment + 1] ?? segmentStart;

    // Directional hazards only count when the route agrees with their heading.
    if (hazard.headingDegrees !== null) {
      const routeHeading = bearing(segmentStart, segmentEnd);
      const difference = Math.abs(((routeHeading - hazard.headingDegrees + 540) % 360) - 180);
      if (difference > hazard.headingToleranceDegrees) continue;
    }

    // Distance to the start of the segment, plus how far into it the hazard is.
    const segmentLength = haversineDistance(segmentStart, segmentEnd);
    const alongMeters = (cumulative[bestSegment] ?? 0) + bestFraction * segmentLength;
    const distanceAlongRouteKm = Math.round((alongMeters / 1000) * 100) / 100;

    matches.push({
      hazard,
      offsetMeters: Math.round(bestOffset),
      distanceAlongRouteKm,
      etaSeconds:
        options.averageSpeedKph && options.averageSpeedKph > 0
          ? Math.round((distanceAlongRouteKm / options.averageSpeedKph) * 3600)
          : null,
    });
  }

  matches.sort((a, b) => a.distanceAlongRouteKm - b.distanceAlongRouteKm);
  return matches;
}

// ---------------------------------------------------------------------------
// Live look-ahead
// ---------------------------------------------------------------------------

export interface LookaheadMatch<T extends CorridorHazard = CorridorHazard> {
  hazard: T;
  distanceMeters: number;
  /** Bearing from the vehicle to the hazard. */
  bearingDegrees: number;
  severity: AlertSeverity;
}

/**
 * Hazards ahead of a moving vehicle.
 *
 * "Ahead" is the operative word: a camera 200 m behind is not news. The vehicle
 * heading is compared against the bearing to each hazard, and anything outside a
 * forward cone is dropped.
 */
export function hazardsAhead<T extends CorridorHazard>(
  position: LatLng,
  headingDegrees: number,
  hazards: readonly T[],
  options: {
    lookaheadMeters?: number;
    forwardConeDegrees?: number;
    minConfidence?: number;
  } = {},
): LookaheadMatch<T>[] {
  const lookahead = options.lookaheadMeters ?? 800;
  const cone = options.forwardConeDegrees ?? 60;
  const minConfidence = options.minConfidence ?? 0.25;

  const results: LookaheadMatch<T>[] = [];

  for (const hazard of hazards) {
    if (hazard.confidence < minConfidence) continue;

    const distanceMeters = haversineDistance(position, hazard.location);
    if (distanceMeters > lookahead + hazard.radiusMeters) continue;

    const toHazard = bearing(position, hazard.location);
    const offAxis = Math.abs(((toHazard - headingDegrees + 540) % 360) - 180);

    // Very close hazards skip the cone test: at 30 m the bearing is noise, and
    // suppressing an alert the driver is about to hit would be the wrong call.
    if (distanceMeters > 60 && offAxis > cone) continue;

    // A hazard that declares its own direction must also agree with our travel.
    if (hazard.headingDegrees !== null) {
      const difference = Math.abs(((headingDegrees - hazard.headingDegrees + 540) % 360) - 180);
      if (difference > hazard.headingToleranceDegrees) continue;
    }

    results.push({
      hazard,
      distanceMeters: Math.round(distanceMeters),
      bearingDegrees: Math.round(toHazard),
      severity: hazard.severity,
    });
  }

  results.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return results;
}

/**
 * Did the vehicle exceed a speed-limited hazard?
 *
 * Returns null when the hazard carries no limit, so the caller never compares
 * against an invented number.
 */
export function isSpeedViolation(
  speedKph: number | null,
  speedLimitKph: number | null,
  tolerancePercent = 5,
): boolean | null {
  if (speedKph === null || speedLimitKph === null || speedLimitKph <= 0) return null;
  return speedKph > speedLimitKph * (1 + tolerancePercent / 100);
}

/** Driver-facing alert text for one hazard, with distance. */
export function hazardAlertText(
  kind: RouteHazardKind,
  distanceMeters: number,
  speedLimitKph?: number | null,
): string {
  const definition = hazardKindDefinition(kind);
  const distance =
    distanceMeters >= 1000
      ? `${(distanceMeters / 1000).toFixed(1)} km`
      : `${Math.round(distanceMeters / 10) * 10} m`;
  const limit =
    speedLimitKph !== null && speedLimitKph !== undefined ? ` — limit ${speedLimitKph} km/h` : '';
  return `${definition.alertText} in ${distance}${limit}`;
}
