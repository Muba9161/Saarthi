import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DeviceType,
  OrganizationType,
  QrSubjectType,
  RoleName,
  TerminalSessionStatus,
  TrackingSource,
  TripStatus,
  TruckType,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { ingestLocation } from '../src/modules/tracking/tracking.service';
import { applyOdometer } from '../src/modules/vehicles/odometer.service';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  unique,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Service runs, and the odometer.
 *
 * Two gaps, one cause. A vehicle with no dispatched trip against it was
 * invisible to Saarthi even while it was moving: a driver could take a truck to
 * a petrol pump forty kilometres away and back, and afterwards there was no
 * distance, no top speed, no braking record, and an odometer reading exactly
 * what it read that morning. The fleet's own mileage figures were short by
 * however far its vehicles wandered between jobs, and the service intervals
 * computed from them were wrong in the direction that costs an engine.
 *
 * So the cases below are mostly about *recording things that used to be thrown
 * away*, and about the one rule that protects the figure once it exists: an
 * odometer never goes backwards.
 */

const START_LAT = 12.9716;
const START_LNG = 77.5946;
/** ~1.1 km east. Far enough to be real movement, close enough to be plausible. */
const PUMP_LAT = 12.9716;
const PUMP_LNG = 77.6046;

interface EnrolledTerminal {
  deviceIdentifier: string;
  token: string;
}

describe('Saarthi Terminal — service runs', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let driver: TestUser;
  let vehicle: { id: string; registration: string };
  let terminal: EnrolledTerminal;

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
    driver = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleet.id,
      driver: true,
    });
    vehicle = await createVehicle(fleet.id);
    terminal = await signOnDriver(owner, driver, vehicle.id);
  });

  // -------------------------------------------------------------------------
  // Opening a run
  // -------------------------------------------------------------------------

  it('records a run to a nearby service as a trip', async () => {
    const response = await startRun(terminal, 'Bharat Petroleum, Ring Road');

    expect(response.status).toBe(200);
    expect(response.body.data).not.toBeNull();

    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: response.body.data!.id },
    });

    expect(trip.adHoc).toBe(true);
    expect(trip.truckId).toBe(vehicle.id);
    expect(trip.driverId).toBe(driver.driverId);
    expect(trip.destinationAddress).toBe('Bharat Petroleum, Ring Road');
    // STARTED, not ASSIGNED: the vehicle is already moving.
    expect(trip.status).toBe(TripStatus.STARTED);
    expect(trip.startOdometerKm).toBe(184_230);

    // The vehicle points at it, which is what makes the tracking pipeline
    // attribute distance and harsh-driving events to this journey.
    const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(truck.currentTripId).toBe(trip.id);
  });

  it('leaves the vehicle dispatchable while it is fetching diesel', async () => {
    await startRun(terminal, 'Bharat Petroleum, Ring Road');

    // A service run must not take a truck out of the fleet's dispatch pool. The
    // trip records the journey; the *status* is what the fleet reads to decide
    // whether a vehicle can take work.
    const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(truck.status).toBe('AVAILABLE');
  });

  it('does not open a second run for the same destination', async () => {
    const first = await startRun(terminal, 'Bharat Petroleum, Ring Road');
    const second = await startRun(terminal, 'Bharat Petroleum, Ring Road');

    // A driver who taps twice, or a terminal retrying through a dropped
    // connection, must not split one journey across two records.
    expect(second.body.data!.id).toBe(first.body.data!.id);
    expect(await prisma.trip.count({ where: { adHoc: true } })).toBe(1);
  });

  it('closes the old run when the driver changes their mind', async () => {
    const first = await startRun(terminal, 'Bharat Petroleum, Ring Road');
    const second = await startRun(terminal, 'Tyre works, Hosur Road', {
      toLatitude: 12.9500,
      toLongitude: 77.6200,
    });

    expect(second.body.data!.id).not.toBe(first.body.data!.id);

    const abandoned = await prisma.trip.findUniqueOrThrow({ where: { id: first.body.data!.id } });
    expect(abandoned.status).toBe(TripStatus.CANCELLED);
  });

  it('stays out of the way when the vehicle is already on a dispatched trip', async () => {
    const dispatched = await createDispatchedTrip(fleet.id, vehicle.id, driver.driverId!, owner.id);

    const response = await startRun(terminal, 'Bharat Petroleum, Ring Road');

    // Not an error — a null answer. The journey is already being recorded, and
    // failing here would break navigation for the ordinary case in order to
    // serve the exceptional one.
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();

    const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(truck.currentTripId).toBe(dispatched.id);
  });

  // -------------------------------------------------------------------------
  // Closing a run
  // -------------------------------------------------------------------------

  it('saves distance, speeds and braking when the vehicle arrives', async () => {
    const opened = await startRun(terminal, 'Bharat Petroleum, Ring Road');

    const finished = await request<{ status: string }>({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/service-run/finish',
      headers: auth(terminal.token),
      payload: {
        tripId: opened.body.data!.id,
        distanceKm: 12.4,
        topSpeedKph: 78.5,
        averageSpeedKph: 41.2,
        harshBrakingCount: 3,
        harshAccelerationCount: 1,
        latitude: PUMP_LAT,
        longitude: PUMP_LNG,
      },
    });

    expect(finished.status).toBe(200);

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: opened.body.data!.id } });
    expect(trip.status).toBe(TripStatus.COMPLETED);
    expect(trip.actualDistanceKm).toBeCloseTo(12.4, 1);
    expect(trip.topSpeedKph).toBeCloseTo(78.5, 1);
    expect(trip.averageSpeedKph).toBeCloseTo(41.2, 1);
    expect(trip.harshBrakingCount).toBe(3);
    expect(trip.harshAccelerationCount).toBe(1);
    expect(trip.actualArrivalAt).not.toBeNull();

    // The vehicle is released, so it can be dispatched again.
    const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(truck.currentTripId).toBeNull();
  });

  it('keeps the figures when the driver stops short', async () => {
    const opened = await startRun(terminal, 'Bharat Petroleum, Ring Road');

    await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/service-run/finish',
      headers: auth(terminal.token),
      payload: {
        tripId: opened.body.data!.id,
        distanceKm: 4.1,
        topSpeedKph: 52,
        harshBrakingCount: 1,
        cancelled: true,
      },
    });

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: opened.body.data!.id } });
    expect(trip.status).toBe(TripStatus.CANCELLED);
    // A cancelled run is still a journey the vehicle made. Discarding its
    // distance would leave the odometer out of step with the road, which is the
    // whole problem this feature exists to solve.
    expect(trip.actualDistanceKm).toBeCloseTo(4.1, 1);
    expect(trip.topSpeedKph).toBeCloseTo(52, 1);
  });

  it('keeps the longer of the two measured distances', async () => {
    const opened = await startRun(terminal, 'Bharat Petroleum, Ring Road');

    // The tracking pipeline has already banked more than the terminal is
    // claiming — the terminal's own figure has a hole in it where GPS dropped.
    await prisma.trip.update({
      where: { id: opened.body.data!.id },
      data: { actualDistanceKm: 18.6 },
    });

    await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/service-run/finish',
      headers: auth(terminal.token),
      payload: { tripId: opened.body.data!.id, distanceKm: 12.4 },
    });

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: opened.body.data!.id } });
    expect(trip.actualDistanceKm).toBeCloseTo(18.6, 1);
  });

  it('is idempotent when a finish is retried', async () => {
    const opened = await startRun(terminal, 'Bharat Petroleum, Ring Road');
    const payload = { tripId: opened.body.data!.id, distanceKm: 6.2 };

    const first = await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/service-run/finish',
      headers: auth(terminal.token),
      payload,
    });
    const second = await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/service-run/finish',
      headers: auth(terminal.token),
      payload,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await prisma.tripEvent.count({
      where: { tripId: opened.body.data!.id, type: 'ARRIVED' },
    })).toBe(1);
  });

  it('tells a restarted terminal which run it left open', async () => {
    const opened = await startRun(terminal, 'Bharat Petroleum, Ring Road');

    const found = await request<{ id: string } | null>({
      method: 'GET',
      url: '/api/v1/device-gateway/terminal/trip/service-run',
      headers: auth(terminal.token),
    });

    expect(found.status).toBe(200);
    expect(found.body.data?.id).toBe(opened.body.data!.id);
  });

  it('closes an open run when the driver signs off', async () => {
    const opened = await startRun(terminal, 'Bharat Petroleum, Ring Road');

    await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/session/end',
      headers: auth(terminal.token),
      payload: { reason: 'Driver signed off.' },
    });

    // A vehicle left holding an open trip cannot be dispatched, and a driver who
    // went home is not still on the way to a petrol pump.
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: opened.body.data!.id } });
    expect(trip.status).toBe(TripStatus.COMPLETED);

    const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(truck.currentTripId).toBeNull();
  });

  it('lets a dispatcher assign work to a vehicle mid-service-run', async () => {
    const opened = await startRun(terminal, 'Bharat Petroleum, Ring Road');

    const created = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/trips',
      user: owner,
      payload: {
        truckId: vehicle.id,
        driverId: driver.driverId,
        origin: { addressLine: 'Depot', latitude: START_LAT, longitude: START_LNG },
        destination: { addressLine: 'Site', latitude: 13.05, longitude: 77.65 },
      },
    });

    // Refusing here would have been a failure mode invented by this feature:
    // a dispatcher unable to assign a truck because its driver had nipped out
    // for diesel, with nothing on the dashboard to explain it.
    expect(created.status).toBe(201);

    const run = await prisma.trip.findUniqueOrThrow({ where: { id: opened.body.data!.id } });
    expect(run.status).toBe(TripStatus.COMPLETED);

    const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(truck.currentTripId).toBe(created.body.data.id);
  });
});

// ---------------------------------------------------------------------------
// The odometer
// ---------------------------------------------------------------------------

describe('vehicle odometer', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let driver: TestUser;
  let vehicle: { id: string; registration: string };

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
    driver = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleet.id,
      driver: true,
    });
    vehicle = await createVehicle(fleet.id);
  });

  it('advances as the vehicle is tracked, with no trip against it', async () => {
    // Two fixes ~1.1 km apart. Before this, a vehicle with no trip covered this
    // ground and its odometer did not move at all.
    await ingestLocation({
      truckId: vehicle.id,
      latitude: START_LAT,
      longitude: START_LNG,
      speedKph: 40,
      heading: 90,
      source: TrackingSource.DEVICE,
      timestamp: new Date(Date.now() - 60_000),
    });
    await ingestLocation({
      truckId: vehicle.id,
      latitude: PUMP_LAT,
      longitude: PUMP_LNG,
      speedKph: 40,
      heading: 90,
      source: TrackingSource.DEVICE,
      timestamp: new Date(),
    });

    const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(truck.odometerKm).toBeGreaterThan(184_230);
    expect(truck.odometerKm).toBeLessThan(184_232);
  });

  it('does not drift while the vehicle is parked', async () => {
    const now = Date.now();
    // Three fixes a few metres apart — a stationary truck's satellite wander.
    // Summed unfiltered this is about a kilometre a day of invented mileage.
    for (let index = 0; index < 3; index += 1) {
      await ingestLocation({
        truckId: vehicle.id,
        latitude: START_LAT + index * 0.00002,
        longitude: START_LNG,
        speedKph: 0,
        heading: 0,
        source: TrackingSource.DEVICE,
        timestamp: new Date(now + index * 5_000),
      });
    }

    const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(truck.odometerKm).toBe(184_230);
  });

  it('never goes backwards', async () => {
    const result = await applyOdometer({
      vehicleId: vehicle.id,
      odometerKm: 120_000,
      reason: 'test',
    });

    // A lower figure is a mistake, a different vehicle, or a device that has
    // been reset — never a correction. The caller is told the real reading.
    expect(result).toBe(184_230);
    const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(truck.odometerKm).toBe(184_230);
  });

  it('refuses an implausible jump', async () => {
    const result = await applyOdometer({
      vehicleId: vehicle.id,
      odometerKm: 900_000,
      reason: 'test',
    });

    expect(result).toBe(184_230);
  });

  it('adopts a higher measured reading', async () => {
    const result = await applyOdometer({
      vehicleId: vehicle.id,
      odometerKm: 184_512,
      reason: 'test',
    });

    expect(result).toBe(184_512);
  });

  it('accepts a reading from the terminal and reports what it holds', async () => {
    const terminal = await signOnDriver(owner, driver, vehicle.id);

    const raised = await request<{ odometerKm: number }>({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/odometer',
      headers: auth(terminal.token),
      payload: { odometerKm: 184_401.5, source: 'GPS' },
    });
    expect(raised.status).toBe(200);
    expect(raised.body.data.odometerKm).toBeCloseTo(184_401.5, 1);

    // A terminal moved to a different truck must learn that vehicle's real
    // mileage rather than overwrite it with the last one's.
    const lower = await request<{ odometerKm: number }>({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/odometer',
      headers: auth(terminal.token),
      payload: { odometerKm: 90_000, source: 'GPS' },
    });
    expect(lower.body.data.odometerKm).toBeCloseTo(184_401.5, 1);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function createVehicle(
  organizationId: string,
): Promise<{ id: string; registration: string }> {
  const registration = unique('KA01').toUpperCase().slice(-12);
  const truck = await prisma.truck.create({
    data: {
      organizationId,
      registrationNumber: registration,
      truckType: TruckType.OPEN_BODY,
      capacityTons: 20,
      odometerKm: 184_230,
      lastLatitude: null,
      lastLongitude: null,
    },
  });
  return { id: truck.id, registration };
}

async function startRun(
  terminal: EnrolledTerminal,
  destinationName: string,
  overrides: { toLatitude?: number; toLongitude?: number } = {},
) {
  return request<{ id: string; reference: string } | null>({
    method: 'POST',
    url: '/api/v1/device-gateway/terminal/trip/service-run',
    headers: auth(terminal.token),
    payload: {
      destinationName,
      service: 'FUEL',
      fromLatitude: START_LAT,
      fromLongitude: START_LNG,
      toLatitude: overrides.toLatitude ?? PUMP_LAT,
      toLongitude: overrides.toLongitude ?? PUMP_LNG,
      plannedDistanceKm: 1.2,
      plannedDurationMinutes: 4,
    },
  });
}

/**
 * A terminal with an approved driver signed on to it.
 *
 * The full arrival flow rather than a shortcut, because every terminal endpoint
 * under test refuses a terminal with nobody authorised on it — which is the
 * point of that surface and would be quietly bypassed by writing the session
 * row directly.
 */
async function signOnDriver(
  owner: TestUser,
  driver: TestUser,
  vehicleId: string,
): Promise<EnrolledTerminal> {
  const issued = await request<{ pairingCode: string }>({
    method: 'POST',
    url: `/api/v1/fleet/vehicles/${vehicleId}/terminal-pairing`,
    user: owner,
    payload: {},
  });

  const enrolled = await request<{
    deviceIdentifier: string;
    token: { accessToken: string };
  }>({
    method: 'POST',
    url: '/api/v1/device-gateway/enroll',
    payload: {
      installationId: unique('terminal-000000000000'),
      platform: 'ANDROID',
      deviceModel: 'Lenovo Tab M10',
      osVersion: '13',
      appVersion: '1.0.0',
      deviceType: DeviceType.VEHICLE_TERMINAL,
    },
  });

  const paired = await request<{ token: { accessToken: string } }>({
    method: 'POST',
    url: '/api/v1/device-gateway/terminal/pair',
    headers: auth(enrolled.body.data.token.accessToken),
    payload: { pairingCode: issued.body.data.pairingCode },
  });

  const terminal: EnrolledTerminal = {
    deviceIdentifier: enrolled.body.data.deviceIdentifier,
    token: paired.body.data.token.accessToken,
  };

  await request({
    method: 'GET',
    url: '/api/v1/device-gateway/terminal/vehicle-qr',
    headers: auth(terminal.token),
  });

  const code = await prisma.qrCode.findFirstOrThrow({
    where: { subjectType: QrSubjectType.VEHICLE, subjectId: vehicleId },
  });

  const created = await request<{ id: string }>({
    method: 'POST',
    url: '/api/v1/terminal/assignments/request',
    user: driver,
    payload: { qrToken: code.token },
  });

  await prisma.terminalSession.update({
    where: { id: created.body.data.id },
    data: {
      status: TerminalSessionStatus.SELFIE_SUBMITTED,
      selfieMediaId: crypto.randomUUID(),
      selfieCapturedAt: new Date(),
    },
  });

  await request({
    method: 'POST',
    url: `/api/v1/terminal/assignments/${created.body.data.id}/submit`,
    user: driver,
    payload: {},
  });

  await request({
    method: 'POST',
    url: `/api/v1/terminal/assignments/${created.body.data.id}/approve`,
    user: owner,
    payload: { assignVehicle: true },
  });

  return terminal;
}

/** A dispatched trip, created the way a fleet creates one. */
async function createDispatchedTrip(
  organizationId: string,
  truckId: string,
  driverId: string,
  createdById: string,
) {
  const trip = await prisma.trip.create({
    data: {
      reference: unique('TR-DISPATCH').slice(0, 30),
      organizationId,
      truckId,
      driverId,
      originAddress: 'Depot',
      originLatitude: START_LAT,
      originLongitude: START_LNG,
      destinationAddress: 'Site',
      destinationLatitude: 13.05,
      destinationLongitude: 77.65,
      status: TripStatus.STARTED,
      createdById,
    },
  });
  await prisma.truck.update({
    where: { id: truckId },
    data: { currentTripId: trip.id },
  });
  return trip;
}
