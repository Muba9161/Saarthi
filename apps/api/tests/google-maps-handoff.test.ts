import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OrganizationType,
  RoleName,
  TrackRouteState,
  TrackingSource,
  TripStatus,
  destinationPoint,
  type LatLng,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { ingestLocation } from '../src/modules/tracking/tracking.service';
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
 * Navigating with Google Maps, and arriving by the vehicle's own GPS.
 *
 * Google Maps is free for a driver to use and chooses its own roads, which it
 * cannot tell Saarthi. So the fleet's record has to stay truthful without it:
 * a different road that still heads for the destination is an alternate road,
 * drawn amber and never counted against the driver; driving away is still a
 * deviation; and the arrival time comes from where the vehicle actually
 * stopped, confirmed by the driver rather than announced on the GPS alone.
 */

const START: LatLng = { latitude: 26.8467, longitude: 80.9462 };
// A road heading east with a bend in it, so it is judged as a road.
const MIDWAY = destinationPoint(START, 90, 2_000);
const DESTINATION = destinationPoint(START, 80, 4_000);
const ROUTE = [START, MIDWAY, DESTINATION];

describe('Google Maps handoff and GPS arrival', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let driver: TestUser;
  let vehicle: { id: string };
  let terminal: EnrolledTerminal;
  let tripId: string;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    driver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
    await verifyDriver(driver);
    vehicle = await createFleetVehicle(fleet.id);
    terminal = await signOnDriver(owner, driver, vehicle.id);
    tripId = await dispatchAlongRoute();
  });

  async function dispatchAlongRoute(): Promise<string> {
    const response = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/trips',
      user: owner,
      payload: {
        truckId: vehicle.id,
        driverId: driver.driverId,
        origin: { addressLine: 'Transport Nagar, Lucknow', ...START },
        destination: { addressLine: 'Chinhat warehouse, Lucknow', ...DESTINATION },
        plannedRoute: ROUTE,
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.id;
  }

  async function startTrip(): Promise<void> {
    await passChecklist(terminal);
    const started = await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/start',
      headers: terminalAuth(terminal.token),
      payload: {},
    });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
  }

  async function handOff(app: 'GOOGLE_MAPS' | null) {
    return request<{ navigationHandoff: string | null }>({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/navigation/handoff',
      headers: terminalAuth(terminal.token),
      payload: { app },
    });
  }

  /** A position taken `minutes` after `base`, at `speedKph`. */
  function report(position: LatLng, minutes: number, speedKph: number, base: number) {
    return ingestLocation({
      truckId: vehicle.id,
      ...position,
      speedKph,
      heading: 0,
      timestamp: new Date(base + minutes * 60_000),
      source: TrackingSource.DEVICE,
    });
  }

  async function lastRouteState(): Promise<string> {
    const point = await prisma.truckLocation.findFirstOrThrow({
      where: { tripId },
      orderBy: { recordedAt: 'desc' },
    });
    return point.routeState;
  }

  const eventsOf = (type: string) => prisma.tripEvent.count({ where: { tripId, type: type as never } });
  const deviationPenalties = () =>
    prisma.driverScoreEvent.count({ where: { driverId: driver.driverId!, eventType: 'ROUTE_DEVIATION' } });

  // -------------------------------------------------------------------------
  // The handoff
  // -------------------------------------------------------------------------

  it('records the handoff to Google Maps and the return, once each', async () => {
    const handed = await handOff('GOOGLE_MAPS');
    expect(handed.status).toBe(200);
    expect(handed.body.data.navigationHandoff).toBe('GOOGLE_MAPS');
    await handOff('GOOGLE_MAPS');

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.externalNavigation).toBe('GOOGLE_MAPS');
    expect(trip.externalNavigationSince).not.toBeNull();
    expect(await eventsOf('NAVIGATION_HANDOFF')).toBe(1);

    const back = await handOff(null);
    expect(back.body.data.navigationHandoff).toBeNull();
    expect(await eventsOf('NAVIGATION_HANDOFF')).toBe(2);
  });

  it('refuses a navigation app the phone does not open', async () => {
    const response = await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/navigation/handoff',
      headers: terminalAuth(terminal.token),
      payload: { app: 'WAZE' },
    });
    expect(response.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Another road
  // -------------------------------------------------------------------------

  it('draws another road to the destination amber, with one quiet note and no penalty', async () => {
    await startTrip();
    await handOff('GOOGLE_MAPS');
    const base = Date.now();

    await report(START, 0, 30, base);
    // A kilometre north of the planned road, but much nearer the destination.
    await report(destinationPoint(MIDWAY, 0, 1_000), 4, 40, base);
    expect(await lastRouteState()).toBe(TrackRouteState.ALTERNATE);
    await report(destinationPoint(MIDWAY, 20, 1_100), 5, 40, base);
    expect(await lastRouteState()).toBe(TrackRouteState.ALTERNATE);

    expect(await eventsOf('ALTERNATE_ROUTE')).toBe(1);
    expect(await eventsOf('ROUTE_DEVIATION')).toBe(0);
    expect(await deviationPenalties()).toBe(0);
  });

  it('still calls it a deviation when the vehicle drives away from the destination', async () => {
    await startTrip();
    await handOff('GOOGLE_MAPS');
    const base = Date.now();

    await report(MIDWAY, 0, 40, base);
    // Back past the start and off to the north: further from the destination.
    await report(destinationPoint(START, 0, 1_500), 4, 40, base);

    expect(await lastRouteState()).toBe(TrackRouteState.OFF_ROUTE);
    expect(await eventsOf('ROUTE_DEVIATION')).toBe(1);
    expect(await eventsOf('ALTERNATE_ROUTE')).toBe(0);
  });

  it('keeps the same road a deviation when the driver is not on Google Maps', async () => {
    await startTrip();
    const base = Date.now();

    await report(START, 0, 30, base);
    await report(destinationPoint(MIDWAY, 0, 1_000), 4, 40, base);

    expect(await lastRouteState()).toBe(TrackRouteState.OFF_ROUTE);
    expect(await eventsOf('ROUTE_DEVIATION')).toBe(1);
    expect(await deviationPenalties()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Arriving
  // -------------------------------------------------------------------------

  it('records reaching the destination by GPS, and confirming arrival takes that time', async () => {
    await startTrip();
    await handOff('GOOGLE_MAPS');
    const base = Date.now();
    const atGate = destinationPoint(DESTINATION, 180, 60);

    await report(atGate, 1, 3, base);
    await report(atGate, 2, 0, base);
    await report(atGate, 3, 0, base);

    const reachedAt = new Date(base + 60_000);
    const destination = await prisma.tripStop.findFirstOrThrow({
      where: { tripId, type: 'DESTINATION' },
    });
    expect(destination.reachedAt).toEqual(reachedAt);
    // Recorded, not announced: the trip waits for the driver.
    const moving = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect([TripStatus.STARTED, TripStatus.IN_TRANSIT]).toContain(moving.status);
    expect(destination.actualArrival).toBeNull();
    const reachedEvent = await prisma.tripEvent.findFirstOrThrow({ where: { tripId, type: 'STOP_REACHED' } });
    expect(reachedEvent.createdAt).toEqual(reachedAt);

    const current = await request<{ stops: { type: string; reachedAt: string | null }[] }>({
      method: 'GET',
      url: '/api/v1/device-gateway/terminal/trip/current',
      headers: terminalAuth(terminal.token),
    });
    expect(current.body.data.stops.find((stop) => stop.type === 'DESTINATION')?.reachedAt).toBe(
      reachedAt.toISOString(),
    );

    const arrived = await request<{ status: string; navigationHandoff: string | null }>({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/arrive',
      headers: terminalAuth(terminal.token),
      payload: {},
    });
    expect(arrived.status, JSON.stringify(arrived.body)).toBe(200);
    expect(arrived.body.data.status).toBe(TripStatus.ARRIVED);
    // Google Maps guided the way there; arriving ends that.
    expect(arrived.body.data.navigationHandoff).toBeNull();

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.actualArrivalAt).toEqual(reachedAt);
    const confirmed = await prisma.tripStop.findFirstOrThrow({ where: { tripId, type: 'DESTINATION' } });
    expect(confirmed.actualArrival).toEqual(reachedAt);
  });

  it('records leaving a stop, with the time spent there', async () => {
    await startTrip();
    const base = Date.now();
    const atGate = destinationPoint(DESTINATION, 180, 60);

    await report(atGate, 1, 0, base);
    await report(atGate, 3, 0, base);
    await report(destinationPoint(DESTINATION, 270, 400), 46, 25, base);

    const destination = await prisma.tripStop.findFirstOrThrow({ where: { tripId, type: 'DESTINATION' } });
    expect(destination.leftAt).toEqual(new Date(base + 46 * 60_000));
    const left = await prisma.tripEvent.findFirstOrThrow({ where: { tripId, type: 'STOP_LEFT' } });
    expect(left.metadata).toMatchObject({ minutesAtStop: 45 });
  });

  it('does not count positions taken before the trip started, however late they arrive', async () => {
    await startTrip();
    // A night of fixes the phone kept while it could not reach Saarthi.
    const lastNight = Date.now() - 8 * 60 * 60_000;
    const atGate = destinationPoint(DESTINATION, 180, 60);
    await report(atGate, 0, 0, lastNight);
    await report(atGate, 5, 0, lastNight);

    const destination = await prisma.tripStop.findFirstOrThrow({ where: { tripId, type: 'DESTINATION' } });
    expect(destination.reachedAt).toBeNull();
    expect(destination.reachingSince).toBeNull();
    expect(await prisma.truckLocation.count({ where: { tripId } })).toBe(0);
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.actualDistanceKm).toBe(0);
  });

  it('takes an empty handoff as the return to Saarthi, as the phone sends a null', async () => {
    await handOff('GOOGLE_MAPS');
    const back = await request<{ navigationHandoff: string | null }>({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/navigation/handoff',
      headers: terminalAuth(terminal.token),
      payload: {},
    });
    expect(back.status).toBe(200);
    expect(back.body.data.navigationHandoff).toBeNull();
  });

  it('does not count a vehicle driving past the gate as reaching it', async () => {
    await startTrip();
    const base = Date.now();

    await report(destinationPoint(DESTINATION, 180, 80), 1, 35, base);
    await report(destinationPoint(DESTINATION, 90, 80), 2, 35, base);

    const destination = await prisma.tripStop.findFirstOrThrow({ where: { tripId, type: 'DESTINATION' } });
    expect(destination.reachedAt).toBeNull();
    expect(destination.reachingSince).toBeNull();
  });
});
