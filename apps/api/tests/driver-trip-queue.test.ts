import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrganizationType,
  RoleName,
  TerminalSessionStatus,
  TripStatus,
  destinationPoint,
  type LatLng,
  type TerminalTripQueueView,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import * as routing from '../src/providers/routing';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  type TestOrganization,
  type TestUser,
} from './helpers';
import {
  createFleetVehicle,
  passChecklist,
  signOnDriver,
  terminalAuth,
  verifyDriver,
  type EnrolledTerminal,
} from './terminal-fixtures';

/**
 * A driver's own trips on their vehicle, one after another.
 *
 * Any of them can be started, not only the next; Stop ends the one under way
 * where it is, and the next starts on its own; the driver can reorder them, and
 * is offered the order that drives least. The fleet's trips are never moved.
 */

const HERE: LatLng = { latitude: 26.8467, longitude: 80.9462 };
/** A point this many kilometres east of HERE. */
const east = (km: number): LatLng => destinationPoint(HERE, 90, km * 1000);
const MEDANTA = east(8);
const LULU = east(3);
const BBD = east(10);

const TERMINAL = '/api/v1/device-gateway/terminal';

describe('a driver\'s own trip queue', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let driver: TestUser;
  let vehicle: { id: string };
  let terminal: EnrolledTerminal;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    // Straight lines, so distances are predictable and nothing calls a router.
    vi.spyOn(routing, 'routingProvider', 'get').mockReturnValue(null);
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    driver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
    await verifyDriver(driver);
    vehicle = await createFleetVehicle(fleet.id);
    terminal = await signOnDriver(owner, driver, vehicle.id);
    await passChecklist(terminal);
  });

  async function addTrip(name: string, from: LatLng, to: LatLng): Promise<string> {
    const response = await request<{ id: string }>({
      method: 'POST',
      url: `${TERMINAL}/trips`,
      headers: terminalAuth(terminal.token),
      payload: {
        origin: { name: `From ${name}`, ...from },
        destination: { name, ...to },
        plannedRoute: [from, to],
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.id;
  }

  /** Here → Medanta → Lulu → BBD, each from where the last ends: 20 km as added, 10 km reordered. */
  async function addChain(): Promise<[string, string, string]> {
    return [
      await addTrip('Medanta', HERE, MEDANTA),
      await addTrip('Lulu Mall', MEDANTA, LULU),
      await addTrip('BBD', LULU, BBD),
    ];
  }

  async function queue(at: LatLng = HERE) {
    const response = await request<TerminalTripQueueView>({
      method: 'GET',
      url: `${TERMINAL}/trips/queue?latitude=${at.latitude}&longitude=${at.longitude}`,
      headers: terminalAuth(terminal.token),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body.data;
  }

  async function startTrip(tripId?: string, at: LatLng = HERE) {
    return request({
      method: 'POST',
      url: `${TERMINAL}/trip/start`,
      headers: terminalAuth(terminal.token),
      payload: { ...(tripId ? { tripId } : {}), ...at },
    });
  }

  const trip = (id: string) => prisma.trip.findUniqueOrThrow({ where: { id } });
  const heldTripId = async () =>
    (await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } })).currentTripId;

  it('lists the trips in the order added, and offers the order that drives least', async () => {
    const [toMedanta, toLulu, toBbd] = await addChain();
    const view = await queue();

    expect(view.trips.map((queued) => queued.id)).toEqual([toMedanta, toLulu, toBbd]);
    expect(view.trips[0]!.upNext).toBe(true);
    expect(view.trips.every((queued) => queued.chained)).toBe(true);
    expect(view.suggestion).toMatchObject({
      order: [toLulu, toMedanta, toBbd],
      currentKm: 20,
      suggestedKm: 10,
      savedKm: 10,
      estimated: true,
    });
  });

  it('reorders, starts each chained trip where the one before it now ends, and hands the vehicle on', async () => {
    const [toMedanta, toLulu, toBbd] = await addChain();

    const response = await request<TerminalTripQueueView>({
      method: 'POST',
      url: `${TERMINAL}/trips/queue`,
      headers: terminalAuth(terminal.token),
      payload: { tripIds: [toLulu, toMedanta, toBbd], ...HERE },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.trips.map((queued) => queued.id)).toEqual([toLulu, toMedanta, toBbd]);
    expect(response.body.data.suggestion).toBeNull();

    const lulu = await trip(toLulu);
    expect(lulu.status).toBe(TripStatus.ASSIGNED);
    expect(lulu.originLatitude).toBeCloseTo(HERE.latitude, 5);
    expect(lulu.plannedDistanceKm).toBeCloseTo(3, 0);

    const medanta = await trip(toMedanta);
    expect(medanta.status).toBe(TripStatus.DRAFT);
    expect(medanta.originAddress).toBe((await trip(toLulu)).destinationAddress);
    expect(medanta.originLongitude).toBeCloseTo(LULU.longitude, 5);

    const bbd = await trip(toBbd);
    expect(bbd.originLongitude).toBeCloseTo(MEDANTA.longitude, 5);
    expect(await heldTripId()).toBe(toLulu);
  });

  it('refuses an order that leaves a trip out', async () => {
    const [toMedanta, toLulu] = await addChain();
    const response = await request({
      method: 'POST',
      url: `${TERMINAL}/trips/queue`,
      headers: terminalAuth(terminal.token),
      payload: { tripIds: [toLulu, toMedanta] },
    });
    expect(response.status).toBe(409);
  });

  it('starts a later trip from where the vehicle is, and puts the waiting one back in the queue', async () => {
    const [toMedanta, , toBbd] = await addChain();

    const response = await startTrip(toBbd);
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const bbd = await trip(toBbd);
    expect(bbd.status).toBe(TripStatus.STARTED);
    // It was chained to Lulu, but it was started from here.
    expect(bbd.originLongitude).toBeCloseTo(HERE.longitude, 5);
    expect((await trip(toMedanta)).status).toBe(TripStatus.DRAFT);
    expect(await heldTripId()).toBe(toBbd);
  });

  it('will not start another trip while one is under way', async () => {
    const [, toLulu] = await addChain();
    expect((await startTrip()).status).toBe(200);

    const response = await startTrip(toLulu);
    expect(response.status).toBe(409);
    expect((await trip(toLulu)).status).toBe(TripStatus.DRAFT);
  });

  it('ends a trip where it is stopped, notes it ended early, and starts the next on its own', async () => {
    const [toMedanta, toLulu] = await addChain();
    await startTrip();

    const stoppedAt = east(5);
    const ended = await request({
      method: 'POST',
      url: `${TERMINAL}/trip/complete`,
      headers: terminalAuth(terminal.token),
      payload: stoppedAt,
    });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);

    expect((await trip(toMedanta)).status).toBe(TripStatus.COMPLETED);
    const note = await prisma.tripEvent.findFirst({ where: { tripId: toMedanta, type: 'NOTE' } });
    expect(note?.description).toMatch(/Ended early by the driver, 3\.0 km short of/);

    const next = await trip(toLulu);
    expect(next.status).toBe(TripStatus.STARTED);
    // Chained to Medanta, which the vehicle never reached: it starts where the vehicle stopped.
    expect(next.originLongitude).toBeCloseTo(stoppedAt.longitude, 5);
    const session = await prisma.terminalSession.findFirstOrThrow({
      where: { vehicleId: vehicle.id, driverId: driver.driverId! },
      orderBy: { requestedAt: 'desc' },
    });
    expect(session.status).toBe(TerminalSessionStatus.TRIP_ACTIVE);
  });

  it('keeps the fleet\'s trip first: it is never queued, and runs before the driver\'s', async () => {
    const [toMedanta] = await addChain();
    const dispatched = await request<{ id: string; reference: string }>({
      method: 'POST',
      url: '/api/v1/trips',
      user: owner,
      payload: {
        truckId: vehicle.id,
        driverId: driver.driverId,
        origin: { addressLine: 'Transport Nagar, Lucknow', ...HERE },
        destination: { addressLine: 'Chinhat warehouse, Lucknow', ...BBD },
      },
    });
    expect(dispatched.status, JSON.stringify(dispatched.body)).toBe(201);

    const view = await queue();
    expect(view.behind?.reference).toBe(dispatched.body.data.reference);
    expect(view.trips.map((queued) => queued.id)).not.toContain(dispatched.body.data.id);
    expect(view.trips[0]!.id).toBe(toMedanta);

    const response = await startTrip(toMedanta);
    expect(response.status).toBe(409);
    expect(await heldTripId()).toBe(dispatched.body.data.id);
  });

  async function removeTrip(tripId: string) {
    return request<TerminalTripQueueView>({
      method: 'POST',
      url: `${TERMINAL}/trips/${tripId}/remove`,
      headers: terminalAuth(terminal.token),
      payload: {},
    });
  }

  it('removes a trip from the middle, and the next starts where the removed one would have', async () => {
    const [toMedanta, toLulu, toBbd] = await addChain();

    const response = await removeTrip(toLulu);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.trips.map((queued) => queued.id)).toEqual([toMedanta, toBbd]);

    const removed = await trip(toLulu);
    expect(removed.status).toBe(TripStatus.CANCELLED);
    expect(removed.cancellationReason).toMatch(/Removed by the driver/);
    // BBD was chained to Lulu; it now starts from Medanta, where Lulu's trip began.
    const bbd = await trip(toBbd);
    expect(bbd.originLongitude).toBeCloseTo(MEDANTA.longitude, 5);
    expect(bbd.plannedDistanceKm).toBeCloseTo(2, 0);
  });

  it('removes the trip up next, and hands the vehicle to the one after it', async () => {
    const [toMedanta, toLulu] = await addChain();

    expect((await removeTrip(toMedanta)).status).toBe(200);
    expect((await trip(toMedanta)).status).toBe(TripStatus.CANCELLED);
    expect((await trip(toLulu)).status).toBe(TripStatus.ASSIGNED);
    expect(await heldTripId()).toBe(toLulu);
  });

  it("will not remove the fleet's trip", async () => {
    const dispatched = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/trips',
      user: owner,
      payload: {
        truckId: vehicle.id,
        driverId: driver.driverId,
        origin: { addressLine: 'Transport Nagar, Lucknow', ...HERE },
        destination: { addressLine: 'Chinhat warehouse, Lucknow', ...BBD },
      },
    });
    expect(dispatched.status).toBe(201);

    expect((await removeTrip(dispatched.body.data.id)).status).toBe(404);
    expect((await trip(dispatched.body.data.id)).status).toBe(TripStatus.ASSIGNED);
  });
});
