import { haversineDistance, type LatLng } from './geo';

/**
 * A driver's own trips on one vehicle, run one after another — and the order
 * of them that drives the least.
 *
 * A driver who adds "Alaknanda → Medanta", "Medanta → Lulu Mall" and
 * "Lulu Mall → BBD" has built a chain: each trip starts where the one before
 * it ends. Reordered, a chained trip keeps its destination and starts wherever
 * the vehicle is when its turn comes. A trip with its own pickup — one that
 * starts somewhere the trip before it does not end — is different: the
 * vehicle has to go to that pickup first, so it moves as a pair and its pickup
 * is never dropped.
 */

/** A trip starting this close to where the one before it ends is part of the same chain. */
export const TRIP_CHAIN_METRES = 300;

/**
 * More trips than this and not every order is compared. Eight is 40,320
 * orders, a few milliseconds; nine is ten times that, on every look at the
 * Trips tab.
 */
export const MAX_COMPARED_TRIPS = 8;

/** A different order has to save at least this much, and this share, to be worth asking about. */
export const MIN_SAVING_METRES = 500;
export const MIN_SAVING_SHARE = 0.03;

export interface QueuedLeg {
  id: string;
  origin: LatLng;
  destination: LatLng;
}

/** Metres from one point to another — by road when the caller has road distances. */
export type LegDistance = (from: LatLng, to: LatLng) => number;

/**
 * The trips that start where the one before them ends, in the order given.
 *
 * Read from the order the driver built, and carried by each trip into any new
 * order: whether a trip is part of the chain is a fact about how it was
 * planned, not about where it happens to sit now.
 */
export function chainedLegs(start: LatLng, legs: readonly QueuedLeg[]): Set<string> {
  const chained = new Set<string>();
  let at = start;
  for (const leg of legs) {
    if (haversineDistance(at, leg.origin) <= TRIP_CHAIN_METRES) chained.add(leg.id);
    at = leg.destination;
  }
  return chained;
}

/** Metres driven running `legs` in this order from `start`, a pickup visited before its drop. */
export function orderLength(
  start: LatLng,
  legs: readonly QueuedLeg[],
  chained: ReadonlySet<string>,
  distance: LegDistance,
): number {
  let at = start;
  let total = 0;
  for (const leg of legs) {
    if (!chained.has(leg.id)) {
      total += distance(at, leg.origin);
      at = leg.origin;
    }
    total += distance(at, leg.destination);
    at = leg.destination;
  }
  return total;
}

export interface OrderSuggestion {
  /** Trip ids, first to last. */
  order: string[];
  currentMetres: number;
  suggestedMetres: number;
  savedMetres: number;
}

/**
 * The order of `legs` that drives the least in total, when it saves enough
 * over the driver's own order to be worth asking about — null otherwise.
 *
 * Every order is compared rather than always taking the nearest trip next:
 * nearest-first is quick and often wrong, because a short first hop can leave
 * the longest leg of the day for last.
 */
export function shortestOrder(
  start: LatLng,
  legs: readonly QueuedLeg[],
  distance: LegDistance,
): OrderSuggestion | null {
  if (legs.length < 2 || legs.length > MAX_COMPARED_TRIPS) return null;

  const chained = chainedLegs(start, legs);
  const currentMetres = orderLength(start, legs, chained, distance);

  let best: readonly QueuedLeg[] = legs;
  let bestMetres = currentMetres;
  for (const order of permutations(legs)) {
    const metres = orderLength(start, order, chained, distance);
    // Strictly shorter, so a tie keeps the driver's own order.
    if (metres < bestMetres - 1) {
      best = order;
      bestMetres = metres;
    }
  }

  const savedMetres = currentMetres - bestMetres;
  if (savedMetres < MIN_SAVING_METRES || savedMetres < currentMetres * MIN_SAVING_SHARE) return null;
  return { order: best.map((leg) => leg.id), currentMetres, suggestedMetres: bestMetres, savedMetres };
}

/**
 * Where each trip starts once run in `order`: a chained trip from the end of
 * the one before it (or `start`, for the first), any other from its own pickup.
 *
 * `after` is the id of the trip it now follows, or null when it follows `start`.
 */
export function rechainedOrigins(
  start: LatLng,
  order: readonly QueuedLeg[],
  chained: ReadonlySet<string>,
): Map<string, { origin: LatLng; after: string | null }> {
  const origins = new Map<string, { origin: LatLng; after: string | null }>();
  let at = start;
  let after: string | null = null;
  for (const leg of order) {
    origins.set(leg.id, chained.has(leg.id) ? { origin: at, after } : { origin: leg.origin, after });
    at = leg.destination;
    after = leg.id;
  }
  return origins;
}

/** Every order of `items`, each a fresh array — Heap's algorithm, without recursion. */
function* permutations<T>(items: readonly T[]): Generator<T[]> {
  const current = [...items];
  const counters = new Array<number>(current.length).fill(0);
  yield [...current];
  let index = 1;
  while (index < current.length) {
    if (counters[index]! < index) {
      const swapWith = index % 2 === 0 ? 0 : counters[index]!;
      [current[swapWith], current[index]] = [current[index]!, current[swapWith]!];
      yield [...current];
      counters[index] = counters[index]! + 1;
      index = 1;
    } else {
      counters[index] = 0;
      index += 1;
    }
  }
}
