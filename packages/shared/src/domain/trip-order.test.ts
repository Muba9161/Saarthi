import { describe, expect, it } from 'vitest';
import { destinationPoint, haversineDistance, type LatLng } from './geo';
import {
  MAX_COMPARED_TRIPS,
  chainedLegs,
  orderLength,
  rechainedOrigins,
  shortestOrder,
  type QueuedLeg,
} from './trip-order';

const here = { latitude: 26.8467, longitude: 80.9462 };
/** A point this many kilometres east of `here` (west when negative). */
const km = (east: number): LatLng => destinationPoint(here, east >= 0 ? 90 : 270, Math.abs(east) * 1000);
const straight = (a: LatLng, b: LatLng) => haversineDistance(a, b);

/** Trips chained one after another, each from where the last ended. */
function chain(...stops: number[]): QueuedLeg[] {
  let from = here;
  return stops.map((stop, index) => {
    const leg = { id: `trip-${index + 1}`, origin: from, destination: km(stop) };
    from = leg.destination;
    return leg;
  });
}

describe('the shortest order of a driver\'s own trips', () => {
  it('reorders a chain so the nearest drop is not left for the end', () => {
    // Here → Medanta (8 km) → Lulu (3 km) → BBD (10 km): 20 km as planned.
    const [toMedanta, toLulu, toBbd] = chain(8, 3, 10);
    const suggestion = shortestOrder(here, [toMedanta!, toLulu!, toBbd!], straight);
    // Here → Lulu → Medanta → BBD: 3 + 5 + 2 = 10 km.
    expect(suggestion?.order).toEqual([toLulu!.id, toMedanta!.id, toBbd!.id]);
    expect(suggestion!.currentMetres).toBeCloseTo(20_000, -2);
    expect(suggestion!.suggestedMetres).toBeCloseTo(10_000, -2);
    expect(suggestion!.savedMetres).toBeCloseTo(10_000, -2);
  });

  it('compares every order rather than always taking the nearest next', () => {
    // Nearest-first goes +1, +3, then back to -2: 1 + 2 + 5 = 8 km. Going west first is 7 km.
    const legs = chain(3, -2, 1);
    const suggestion = shortestOrder(here, legs, straight);
    expect(suggestion?.order).toEqual(['trip-2', 'trip-3', 'trip-1']);
    expect(suggestion!.suggestedMetres).toBeCloseTo(7_000, -2);
  });

  it('asks nothing when the driver\'s own order is already the shortest', () => {
    expect(shortestOrder(here, chain(2, 4, 6), straight)).toBeNull();
  });

  it('asks nothing for a saving too small to be worth the question', () => {
    // 0.2 km saved out of about 20.
    expect(shortestOrder(here, chain(10, 9.9, 20), straight)).toBeNull();
  });

  it('does not compare orders past the limit', () => {
    const many = chain(...Array.from({ length: MAX_COMPARED_TRIPS + 1 }, (_, index) => (index % 2 ? 1 : 9) + index));
    expect(shortestOrder(here, many, straight)).toBeNull();
  });
});

describe('a trip with its own pickup', () => {
  // Here → 5 km east, then a separate pickup 2 km west → 6 km west.
  const drop = { id: 'drop', origin: here, destination: km(5) };
  const pickup = { id: 'pickup', origin: km(-2), destination: km(-6) };

  it('is not part of the chain', () => {
    expect([...chainedLegs(here, [drop, pickup])]).toEqual(['drop']);
  });

  it('counts the drive to its pickup, and moves as a pair', () => {
    const chained = chainedLegs(here, [drop, pickup]);
    // 5 out, 7 back to the pickup, 4 on to its drop.
    expect(orderLength(here, [drop, pickup], chained, straight)).toBeCloseTo(16_000, -2);
    // Pickup first: 2 + 4, then the chained drop starts where the vehicle is: 11.
    expect(orderLength(here, [pickup, drop], chained, straight)).toBeCloseTo(17_000, -2);
  });

  it('keeps its pickup when the trips are reordered', () => {
    const chained = chainedLegs(here, [drop, pickup]);
    const origins = rechainedOrigins(here, [pickup, drop], chained);
    expect(origins.get('pickup')).toEqual({ origin: pickup.origin, after: null });
    // The chained trip now starts where the pickup trip ends.
    expect(origins.get('drop')).toEqual({ origin: pickup.destination, after: 'pickup' });
  });
});
