/**
 * Return-load (backhaul) matching.
 *
 * The problem: a truck delivers 900 km from home and drives back empty. The fix
 * is to find a load whose pickup is near where the truck becomes free and whose
 * drop is roughly on the way home.
 *
 * Everything here is pure and explainable. The score is not a black box — the
 * caller gets the component values and a list of human-readable reasons, which
 * the UI renders verbatim. A dispatcher who cannot see why a match scored 78
 * will not trust it, and an untrusted match is not used.
 */

import { bearing, distanceKm, type LatLng } from './geo';
import { type TruckType } from './enums';

/** What the truck is offering. */
export interface ReturnLoadSupply {
  /** Where the truck becomes free — usually the outbound destination. */
  freePoint: LatLng;
  /** Where it wants to end up — usually the fleet base. */
  homePoint: LatLng;
  availableFrom: Date;
  availableUntil: Date;
  capacityTons: number;
  truckType: TruckType | null;
  detourToleranceKm: number;
  acceptsPartialLoad: boolean;
  minimumPrice: number | null;
}

/** What an open order needs. */
export interface ReturnLoadDemand {
  orderId: string;
  origin: LatLng;
  destination: LatLng;
  requiredCapacityTons: number;
  requiredTruckType: TruckType | null;
  pickupAt: Date | null;
  deliverBy: Date | null;
  /** Offered price or customer budget, whichever the caller has. */
  price: number | null;
  /** 1-5 rating of the requesting customer, when known. */
  customerRating: number | null;
}

export interface ReturnLoadScore {
  orderId: string;
  score: number;
  distanceToPickupKm: number;
  detourKm: number;
  /** Cosine of the bearing agreement between the load and the way home, -1..1. */
  directionAlignment: number;
  capacityFitPercent: number;
  /** Hours between when the truck is free and when the load wants collecting. */
  timingFitHours: number;
  estimatedRevenue: number | null;
  reasons: string[];
}

export interface ReturnLoadRejection {
  orderId: string;
  /** Why this load can never work for this truck, in one sentence. */
  reason: string;
}

/**
 * Scoring weights.
 *
 * Exported so the UI can explain the ranking, and so tuning is a data change.
 * They sum to 1; each component contributes its weight times its own 0..1 fit.
 */
export const RETURN_LOAD_WEIGHTS = {
  pickupProximity: 0.28,
  detour: 0.24,
  direction: 0.18,
  capacity: 0.12,
  timing: 0.1,
  price: 0.05,
  trust: 0.03,
} as const;

/** Hard limits applied before scoring. */
export const RETURN_LOAD_LIMITS = {
  /** Beyond this the truck is not "nearby" in any useful sense. */
  maxPickupKm: 150,
  /** A load smaller than this fraction of the payload wastes the trip. */
  minCapacityUtilisation: 0.25,
  /** Grace either side of the availability window. */
  timingGraceHours: 12,
} as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000;
}

/**
 * Extra distance the load costs compared with driving straight home.
 *
 * free -> pickup -> drop -> home, minus free -> home. Negative results are
 * clamped to zero: a load cannot make the journey shorter than the direct route,
 * and reporting a negative detour would look like a bug to a dispatcher.
 */
export function computeDetourKm(supply: ReturnLoadSupply, demand: ReturnLoadDemand): number {
  const direct = distanceKm(supply.freePoint, supply.homePoint);
  const viaLoad =
    distanceKm(supply.freePoint, demand.origin) +
    distanceKm(demand.origin, demand.destination) +
    distanceKm(demand.destination, supply.homePoint);
  return Math.max(0, viaLoad - direct);
}

/**
 * How well the load's direction agrees with the way home.
 *
 * 1 = the load runs exactly homeward, 0 = perpendicular, -1 = straight back the
 * way the truck came. Computed as the cosine of the bearing difference.
 */
export function computeDirectionAlignment(
  supply: ReturnLoadSupply,
  demand: ReturnLoadDemand,
): number {
  const homeBearing = bearing(supply.freePoint, supply.homePoint);
  const loadBearing = bearing(demand.origin, demand.destination);
  const difference = ((loadBearing - homeBearing + 540) % 360) - 180;
  return Math.cos((difference * Math.PI) / 180);
}

/**
 * Reasons a load is impossible rather than merely poor.
 *
 * Kept separate from scoring so a dispatcher asking "why is this not in my list"
 * gets a real answer instead of a low number.
 */
export function findHardBlockers(
  supply: ReturnLoadSupply,
  demand: ReturnLoadDemand,
  limits = RETURN_LOAD_LIMITS,
): string | null {
  if (demand.requiredCapacityTons > supply.capacityTons) {
    return `The load needs ${demand.requiredCapacityTons} t and this truck carries ${supply.capacityTons} t.`;
  }

  if (
    demand.requiredTruckType !== null &&
    supply.truckType !== null &&
    demand.requiredTruckType !== supply.truckType
  ) {
    return `The load needs a ${demand.requiredTruckType.toLowerCase().replace(/_/g, ' ')} body.`;
  }

  if (!supply.acceptsPartialLoad) {
    const utilisation = demand.requiredCapacityTons / Math.max(0.001, supply.capacityTons);
    if (utilisation < limits.minCapacityUtilisation) {
      return 'The load is too small for a truck that is not taking partial loads.';
    }
  }

  const pickupDistance = distanceKm(supply.freePoint, demand.origin);
  if (pickupDistance > limits.maxPickupKm) {
    return `The pickup is ${Math.round(pickupDistance)} km away, beyond the ${limits.maxPickupKm} km search radius.`;
  }

  const detour = computeDetourKm(supply, demand);
  if (detour > supply.detourToleranceKm) {
    return `The load adds ${Math.round(detour)} km of detour, more than the ${Math.round(supply.detourToleranceKm)} km allowed.`;
  }

  // A load that must be collected long before the truck is free, or long after
  // it has to leave, is not a candidate however well it scores otherwise.
  if (demand.pickupAt) {
    const graceMs = limits.timingGraceHours * 3_600_000;
    if (demand.pickupAt.getTime() < supply.availableFrom.getTime() - graceMs) {
      return 'The load needs collecting before this truck is free.';
    }
    if (demand.pickupAt.getTime() > supply.availableUntil.getTime() + graceMs) {
      return 'The load is collected after this truck has to leave.';
    }
  }

  if (
    supply.minimumPrice !== null &&
    demand.price !== null &&
    demand.price < supply.minimumPrice
  ) {
    return `The offered price is below the ${supply.minimumPrice} minimum set for this return.`;
  }

  return null;
}

/**
 * Score one candidate load. Assumes hard blockers have already been checked.
 */
export function scoreReturnLoad(
  supply: ReturnLoadSupply,
  demand: ReturnLoadDemand,
  limits = RETURN_LOAD_LIMITS,
): ReturnLoadScore {
  const distanceToPickupKm = distanceKm(supply.freePoint, demand.origin);
  const detourKm = computeDetourKm(supply, demand);
  const directionAlignment = computeDirectionAlignment(supply, demand);

  const pickupFit = clamp01(1 - distanceToPickupKm / limits.maxPickupKm);
  const detourFit = clamp01(1 - detourKm / Math.max(1, supply.detourToleranceKm));
  // Map -1..1 onto 0..1 so a load running back the way the truck came scores 0
  // rather than dragging the whole product negative.
  const directionFit = clamp01((directionAlignment + 1) / 2);

  const utilisation = demand.requiredCapacityTons / Math.max(0.001, supply.capacityTons);
  // Peak at full payload; penalise a nearly-empty load, and treat anything over
  // capacity as unusable (the hard blocker should already have caught it).
  const capacityFit = utilisation > 1 ? 0 : clamp01(utilisation);

  const timingFitHours = demand.pickupAt
    ? hoursBetween(demand.pickupAt, supply.availableFrom)
    : 0;
  const windowHours = Math.max(
    1,
    hoursBetween(supply.availableUntil, supply.availableFrom),
  );
  const timingFit = demand.pickupAt ? clamp01(1 - timingFitHours / windowHours) : 0.6;

  const priceFit =
    supply.minimumPrice !== null && demand.price !== null && supply.minimumPrice > 0
      ? clamp01(demand.price / supply.minimumPrice / 2)
      : demand.price !== null
        ? 0.6
        : 0.4;

  const trustFit = demand.customerRating !== null ? clamp01(demand.customerRating / 5) : 0.5;

  const score =
    100 *
    (RETURN_LOAD_WEIGHTS.pickupProximity * pickupFit +
      RETURN_LOAD_WEIGHTS.detour * detourFit +
      RETURN_LOAD_WEIGHTS.direction * directionFit +
      RETURN_LOAD_WEIGHTS.capacity * capacityFit +
      RETURN_LOAD_WEIGHTS.timing * timingFit +
      RETURN_LOAD_WEIGHTS.price * priceFit +
      RETURN_LOAD_WEIGHTS.trust * trustFit);

  const reasons: string[] = [];
  if (distanceToPickupKm <= 25) {
    reasons.push(`Pickup is only ${distanceToPickupKm.toFixed(1)} km from where the truck unloads.`);
  } else {
    reasons.push(`Pickup is ${Math.round(distanceToPickupKm)} km from the unload point.`);
  }

  if (detourKm <= 10) {
    reasons.push('Almost no detour — it is effectively on the way home.');
  } else {
    reasons.push(`Adds about ${Math.round(detourKm)} km of detour.`);
  }

  if (directionAlignment > 0.7) reasons.push('Runs in the same direction as the trip home.');
  else if (directionAlignment < 0) reasons.push('Runs against the direction of the trip home.');

  reasons.push(
    `Uses ${Math.round(utilisation * 100)}% of the truck payload (${demand.requiredCapacityTons} of ${supply.capacityTons} t).`,
  );

  if (demand.pickupAt) {
    reasons.push(
      timingFitHours <= 6
        ? 'Collection time lines up closely with when the truck is free.'
        : `Collection is about ${Math.round(timingFitHours)} h from when the truck is free.`,
    );
  } else {
    reasons.push('No fixed collection time on the load.');
  }

  if (demand.customerRating !== null) {
    reasons.push(`Customer rating ${demand.customerRating.toFixed(1)} of 5.`);
  }

  return {
    orderId: demand.orderId,
    score: Math.round(score * 10) / 10,
    distanceToPickupKm: Math.round(distanceToPickupKm * 10) / 10,
    detourKm: Math.round(detourKm * 10) / 10,
    directionAlignment: Math.round(directionAlignment * 1000) / 1000,
    capacityFitPercent: Math.round(utilisation * 1000) / 10,
    timingFitHours: Math.round(timingFitHours * 10) / 10,
    estimatedRevenue: demand.price,
    reasons,
  };
}

/**
 * Rank every candidate, returning matches above `minScore` and the reason each
 * rejected load was impossible.
 */
export function matchReturnLoads(
  supply: ReturnLoadSupply,
  demands: readonly ReturnLoadDemand[],
  options: { minScore?: number; limit?: number; limits?: typeof RETURN_LOAD_LIMITS } = {},
): { matches: ReturnLoadScore[]; rejected: ReturnLoadRejection[] } {
  const minScore = options.minScore ?? 45;
  const limits = options.limits ?? RETURN_LOAD_LIMITS;

  const matches: ReturnLoadScore[] = [];
  const rejected: ReturnLoadRejection[] = [];

  for (const demand of demands) {
    const blocker = findHardBlockers(supply, demand, limits);
    if (blocker) {
      rejected.push({ orderId: demand.orderId, reason: blocker });
      continue;
    }
    const scored = scoreReturnLoad(supply, demand, limits);
    if (scored.score >= minScore) matches.push(scored);
    else {
      rejected.push({
        orderId: demand.orderId,
        reason: `Scored ${scored.score}, below the ${minScore} threshold.`,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return {
    matches: options.limit ? matches.slice(0, options.limit) : matches,
    rejected,
  };
}

/**
 * Empty kilometres this match avoids — the number that justifies the feature.
 *
 * The truck was going to drive `freePoint -> homePoint` empty regardless. Taking
 * the load turns those kilometres into paid ones, minus the detour.
 */
export function emptyKilometresSaved(
  supply: ReturnLoadSupply,
  demand: ReturnLoadDemand,
): number {
  const direct = distanceKm(supply.freePoint, supply.homePoint);
  const loaded = distanceKm(demand.origin, demand.destination);
  const detour = computeDetourKm(supply, demand);
  return Math.max(0, Math.round((Math.min(direct, loaded) - detour) * 10) / 10);
}
