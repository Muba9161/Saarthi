import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DistanceBasis, OrganizationType, TruckType, VehicleType } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import { findServices, profileForVehicle } from '../src/modules/terminal/navigation.service';
import * as routing from '../src/providers/routing';
import {
  closeApp,
  createOrganization,
  getApp,
  resetDatabase,
  unique,
  type TestOrganization,
} from './helpers';

/**
 * Road distance and routing for the terminal.
 *
 * The behaviour under test is not "does it call the router" — it is what the
 * driver is told when it cannot. Section 29's example is a driver on low fuel
 * asking for the nearest pump, and every case here is about that sentence being
 * true:
 *
 *  * a road distance is labelled ROAD and re-ranks the list;
 *  * a straight-line fallback is labelled STRAIGHT_LINE and never carries a
 *    driving time, because there is no honest one to give;
 *  * a routing outage degrades the answer instead of failing the search.
 *
 * The provider is stubbed. These tests assert Saarthi's own behaviour, and a
 * suite that made live OpenRouteService calls would burn a shared daily quota
 * and fail whenever HeiGIT had a bad afternoon.
 */

/** A place at a known offset, so distances are predictable. */
const ORIGIN = { latitude: 28.6139, longitude: 77.209 };

async function seedPlaces(): Promise<void> {
  await prisma.nearbyPlace.createMany({
    data: [
      {
        category: 'FUEL',
        // ~1.5 km away in a straight line.
        name: 'Near Pump Across The River',
        latitude: ORIGIN.latitude + 0.01,
        longitude: ORIGIN.longitude + 0.01,
        open24Hours: true,
        source: 'test',
      },
      {
        category: 'FUEL',
        // ~4.4 km away in a straight line — further, but a shorter drive.
        name: 'Far Pump Same Side',
        latitude: ORIGIN.latitude + 0.03,
        longitude: ORIGIN.longitude + 0.03,
        open24Hours: true,
        source: 'test',
      },
    ],
  });
}

describe('terminal road distances', () => {
  let fleet: TestOrganization;
  let vehicleId: string;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    /*
     * Clear the routing cache between cases.
     *
     * `terminalRoadDistances` is keyed on the coordinates alone and is
     * deliberately *not* tenant-scoped — a road distance is a fact about the
     * public network, identical for every fleet, and keying it per tenant would
     * multiply a bounded daily allowance by the number of customers. Correct in
     * production, and it means `resetDatabase()` does not isolate these cases:
     * without this, the second test's stubbed answer would be served to the
     * third.
     */
    await cache.clear();

    fleet = await createOrganization(OrganizationType.FLEET_OWNER);
    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: unique('UP32RT').toUpperCase().slice(0, 12),
        truckType: TruckType.OPEN_BODY,
        capacityTons: 20,
      },
    });
    vehicleId = truck.id;
    await seedPlaces();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const search = () =>
    findServices({
      organizationId: fleet.id,
      vehicleId,
      service: 'FUEL',
      categories: ['FUEL'],
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      radiusKm: 25,
      limit: 20,
    });

  it('labels distances as straight-line when routing is not configured', async () => {
    vi.spyOn(routing, 'routingProvider', 'get').mockReturnValue(null);

    const result = await search();

    expect(result.places).toHaveLength(2);
    expect(result.roadDistancesAvailable).toBe(false);
    expect(result.routingNote).toMatch(/direct distances/i);

    for (const place of result.places) {
      expect(place.distance.basis).toBe(DistanceBasis.STRAIGHT_LINE);
      // No driving time. A "time" derived from a crow-flies distance is a
      // number invented from a speed nobody chose, and it looks exactly like a
      // real ETA.
      expect(place.distance.durationMinutes).toBeNull();
    }
  });

  it('re-ranks the list by road distance, not by straight line', async () => {
    // The nearest place in a straight line is across a river; the further one is
    // a shorter drive. A list that kept crow-flies order while showing road
    // numbers would be the wrong order with the right figures on it.
    vi.spyOn(routing, 'routingProvider', 'get').mockReturnValue({
      name: 'stub',
      route: vi.fn(),
      distances: vi.fn(async (_from: unknown, to: readonly unknown[]) =>
        to.map((_point: unknown, index: number) => ({
          index,
          // First place: 11 km by road. Second: 5 km.
          distanceMeters: index === 0 ? 11_000 : 5_000,
          durationSeconds: index === 0 ? 900 : 420,
        })),
      ),
    } as never);

    const result = await search();

    expect(result.roadDistancesAvailable).toBe(true);
    expect(result.routingNote).toBeNull();

    expect(result.places[0]?.name).toBe('Far Pump Same Side');
    expect(result.places[0]?.distance.km).toBe(5);
    expect(result.places[0]?.distance.basis).toBe(DistanceBasis.ROAD);
    expect(result.places[0]?.distance.durationMinutes).toBe(7);

    // The straight-line figure is kept alongside, because the gap is
    // information: this one is further away and closer to drive to.
    expect(result.places[0]?.straightLineKm).toBeGreaterThan(
      result.places[1]!.straightLineKm,
    );
  });

  it('falls back to straight-line for a pair the router cannot connect', async () => {
    vi.spyOn(routing, 'routingProvider', 'get').mockReturnValue({
      name: 'stub',
      route: vi.fn(),
      distances: vi.fn(async (_from: unknown, to: readonly unknown[]) =>
        to.map((_point: unknown, index: number) => ({
          index,
          // The second is on an island, behind a barrier, inside a compound.
          distanceMeters: index === 0 ? 3_000 : null,
          durationSeconds: index === 0 ? 300 : null,
        })),
      ),
    } as never);

    const result = await search();

    const road = result.places.filter((place) => place.distance.basis === DistanceBasis.ROAD);
    const direct = result.places.filter(
      (place) => place.distance.basis === DistanceBasis.STRAIGHT_LINE,
    );

    expect(road).toHaveLength(1);
    expect(direct).toHaveLength(1);
    expect(direct[0]?.distance.durationMinutes).toBeNull();
    // One usable road distance is still enough to say the feature is working.
    expect(result.roadDistancesAvailable).toBe(true);
  });

  it('degrades to straight-line when the router fails, rather than failing the search', async () => {
    vi.spyOn(routing, 'routingProvider', 'get').mockReturnValue({
      name: 'stub',
      route: vi.fn(),
      distances: vi.fn(async () => {
        throw new routing.RoutingError(
          'RATE_LIMITED',
          'The daily routing allowance has been used up. Distances shown are straight-line.',
        );
      }),
    } as never);

    const result = await search();

    // The list still arrives. A driver looking for fuel gets honest
    // straight-line distances and a note, not an error screen.
    expect(result.places).toHaveLength(2);
    expect(result.roadDistancesAvailable).toBe(false);
    expect(result.routingNote).toMatch(/daily routing allowance/i);
    expect(
      result.places.every((place) => place.distance.basis === DistanceBasis.STRAIGHT_LINE),
    ).toBe(true);
  });

  it('returns an empty list without calling the router at all', async () => {
    const distances = vi.fn();
    vi.spyOn(routing, 'routingProvider', 'get').mockReturnValue({
      name: 'stub',
      route: vi.fn(),
      distances,
    } as never);

    await prisma.nearbyPlace.deleteMany({});
    const result = await search();

    expect(result.places).toEqual([]);
    // No places means no matrix call. Spending a routing request to measure
    // nothing is a request a fleet paid for.
    expect(distances).not.toHaveBeenCalled();
  });
});

describe('routing profile', () => {
  it('routes a freight vehicle as a lorry and a passenger vehicle as a car', () => {
    // The consequence of getting this wrong runs in one direction: a lorry
    // routed as a car is sent under a bridge it does not fit beneath.
    expect(profileForVehicle(VehicleType.TRUCK)).toBe('driving-hgv');
    // A pickup is a goods carrier, so it takes the freight profile too — its
    // access restrictions are lighter, but they are the ones a lorry profile
    // knows about.
    expect(profileForVehicle(VehicleType.PICKUP)).toBe('driving-hgv');
    expect(profileForVehicle(VehicleType.CAR)).toBe('driving-car');
    expect(profileForVehicle(VehicleType.BUS)).toBe('driving-car');
    expect(profileForVehicle(VehicleType.TAXI)).toBe('driving-car');
  });
});
