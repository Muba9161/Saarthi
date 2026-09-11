import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DeviceType,
  OrganizationType,
  QrSubjectType,
  RoleName,
  TerminalSessionStatus,
  TripStatus,
  TruckType,
  VehicleType,
  VerificationStatus,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
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
 * Dispatch, as far as the vehicle.
 *
 * The gap these cases close was the plainest one in Saarthi and the most
 * expensive to leave open. A dispatcher assigned a trip from the web;
 * `createTrip` wrote it against the vehicle, set `currentTripId`, moved the
 * driver to ON_TRIP and told the tracking pipeline to attribute every position
 * to it — and the terminal in that vehicle was never told any of it. The one
 * `/state` payload the app renders every screen from carried the vehicle, the
 * session, the driver and the tablet's health, and no work.
 *
 * Which produced two symptoms a fleet sees immediately:
 *
 *  1. The driver was told where to go by telephone, because the destination
 *     existed only on a screen in an office.
 *  2. The trip sat at ASSIGNED and nought per cent for ever, because the
 *     terminal's own Start and Complete controls moved the driver's *session* —
 *     READY to TRIP_ACTIVE and back — and never touched the fleet's `Trip`.
 *
 * So these cases assert both directions of the link, and one thing that must
 * *not* travel over it: a service run to a petrol pump occupies `currentTripId`
 * exactly as a dispatch does, and presenting one as assigned work would have the
 * terminal offer to navigate a driver to the pump they are standing at.
 *
 * And none of it is about lorries. `Truck` is the Prisma model's name and
 * nothing more — a fleet's vehicles are taxis, buses, vans and tempos as
 * readily as trucks, so one case below dispatches a taxi.
 */

const START_LAT = 12.9716;
const START_LNG = 77.5946;

const CHECKLIST_PASS = [
  'TYRES', 'COOLANT', 'ENGINE_OIL', 'BRAKES', 'LIGHTS',
  'BATTERY', 'FUEL', 'MIRRORS', 'EMERGENCY_EQUIPMENT', 'DOCUMENTS',
].map((code) => ({ code, status: 'OK' }));

interface EnrolledTerminal {
  deviceIdentifier: string;
  token: string;
}

interface DispatchBody {
  id: string;
  reference: string;
  status: string;
  destinationAddress: string;
  destinationLatitude: number;
  destinationLongitude: number;
  plannedDistanceKm: number | null;
  plannedRoute: { latitude: number; longitude: number }[];
  stops: { type: string; name: string }[];
  underway: boolean;
  assignedToSignedInDriver: boolean;
  orderReference: string | null;
}

describe('Saarthi Terminal — dispatched work', () => {
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
    // `createTrip` refuses an unverified driver, and rightly — but every case
    // here is about what happens *after* a fleet has dispatched one.
    await prisma.driver.update({
      where: { id: driver.driverId! },
      data: { verificationStatus: VerificationStatus.VERIFIED },
    });

    vehicle = await createVehicle(fleet.id);
    terminal = await signOnDriver(owner, driver, vehicle.id);
  });

  // -------------------------------------------------------------------------
  // Telling the vehicle
  // -------------------------------------------------------------------------

  it('gives the terminal the trip its fleet dispatched', async () => {
    const created = await dispatch(owner, vehicle.id, driver.driverId!);

    const response = await request<DispatchBody | null>({
      method: 'GET',
      url: '/api/v1/device-gateway/terminal/trip/current',
      headers: auth(terminal.token),
    });

    expect(response.status).toBe(200);
    const trip = response.body.data!;
    expect(trip.id).toBe(created.id);
    expect(trip.status).toBe(TripStatus.ASSIGNED);
    expect(trip.destinationAddress).toBe('Peenya Industrial Area, Bengaluru');
    expect(trip.destinationLatitude).toBeCloseTo(13.05, 4);
    expect(trip.destinationLongitude).toBeCloseTo(77.65, 4);
    // Not under way, so the terminal offers Start rather than Complete.
    expect(trip.underway).toBe(false);
    expect(trip.assignedToSignedInDriver).toBe(true);
  });

  it('carries the planned route and the stops the dispatcher drew', async () => {
    await dispatch(owner, vehicle.id, driver.driverId!);

    const response = await request<DispatchBody | null>({
      method: 'GET',
      url: '/api/v1/device-gateway/terminal/trip/current',
      headers: auth(terminal.token),
    });

    const trip = response.body.data!;
    // The dispatcher's own polyline, so the terminal can draw the shape of the
    // journey before spending a routing request on turn-by-turn.
    expect(trip.plannedRoute.length).toBeGreaterThanOrEqual(2);
    expect(trip.plannedRoute[0]!.latitude).toBeCloseTo(START_LAT, 4);
    expect(trip.plannedDistanceKm).toBeGreaterThan(0);
    expect(trip.stops.map((stop) => stop.type)).toEqual(['ORIGIN', 'DESTINATION']);
  });

  it('answers with nothing when the vehicle has no work', async () => {
    const response = await request<DispatchBody | null>({
      method: 'GET',
      url: '/api/v1/device-gateway/terminal/trip/current',
      headers: auth(terminal.token),
    });

    // A vehicle between jobs is the ordinary state, not a fault worth a status
    // code. The terminal shows no card; nothing goes red.
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
  });

  it('never presents a service run as work the fleet assigned', async () => {
    await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/service-run',
      headers: auth(terminal.token),
      payload: {
        destinationName: 'Bharat Petroleum, Ring Road',
        service: 'FUEL',
        fromLatitude: START_LAT,
        fromLongitude: START_LNG,
        toLatitude: START_LAT,
        toLongitude: 77.6046,
      },
    });

    // The run holds `currentTripId` exactly as a dispatch would — that is what
    // makes the tracking pipeline record it — so filtering on the vehicle alone
    // would have the terminal offer to navigate to the pump it is parked at.
    const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(truck.currentTripId).not.toBeNull();

    const response = await request<DispatchBody | null>({
      method: 'GET',
      url: '/api/v1/device-gateway/terminal/trip/current',
      headers: auth(terminal.token),
    });
    expect(response.body.data).toBeNull();
  });

  it('dispatches a vehicle that is not a lorry', async () => {
    /*
     * Saarthi is not a freight-only platform, and nothing on this path may
     * assume otherwise: the same endpoint has to serve the taxi on an airport
     * run as the forty-tonner on the trunk route. The Prisma model is called
     * `Truck`; the fleet is not.
     *
     * A taxi rather than an auto-rickshaw, and the difference is a real rule
     * rather than a preference: a three-wheeler declares LIVE_TRACKING but not
     * HARDWARE in `VEHICLE_TYPE_CATALOGUE`, so no terminal can pair to one and
     * there is no cab screen to dispatch to. Picking one here would have been a
     * case that failed for a reason unrelated to dispatch.
     */
    const taxi = await createVehicle(fleet.id, {
      vehicleType: VehicleType.TAXI,
      truckType: TruckType.OTHER,
      capacityTons: 0,
    });
    const rider = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleet.id,
      driver: true,
    });
    await prisma.driver.update({
      where: { id: rider.driverId! },
      data: { verificationStatus: VerificationStatus.VERIFIED },
    });

    const taxiTerminal = await signOnDriver(owner, rider, taxi.id);
    const created = await dispatch(owner, taxi.id, rider.driverId!);

    const response = await request<DispatchBody | null>({
      method: 'GET',
      url: '/api/v1/device-gateway/terminal/trip/current',
      headers: auth(taxiTerminal.token),
    });

    expect(response.status).toBe(200);
    expect(response.body.data!.id).toBe(created.id);
    expect(response.body.data!.assignedToSignedInDriver).toBe(true);

    // And it completes the same way, through the same walk of the same machine.
    await passChecklist(taxiTerminal);
    await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/start',
      headers: auth(taxiTerminal.token),
      payload: {},
    });
    await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/complete',
      headers: auth(taxiTerminal.token),
      payload: {},
    });

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: created.id } });
    expect(trip.status).toBe(TripStatus.COMPLETED);
  });

  it('says so when the paperwork names another driver', async () => {
    const other = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleet.id,
      driver: true,
    });
    await prisma.driver.update({
      where: { id: other.driverId! },
      data: { verificationStatus: VerificationStatus.VERIFIED },
    });

    await dispatch(owner, vehicle.id, other.driverId!);

    const response = await request<DispatchBody | null>({
      method: 'GET',
      url: '/api/v1/device-gateway/terminal/trip/current',
      headers: auth(terminal.token),
    });

    // Shown, not hidden. The job belongs to the vehicle and the driver in the
    // driver at the wheel is the one driving it — but they are entitled to know
    // before setting off that the trip names a colleague.
    expect(response.body.data).not.toBeNull();
    expect(response.body.data!.assignedToSignedInDriver).toBe(false);
  });

  // -------------------------------------------------------------------------
  // The terminal moving the fleet's trip
  // -------------------------------------------------------------------------

  it('starts the fleet trip when the driver sets off', async () => {
    const created = await dispatch(owner, vehicle.id, driver.driverId!);
    await passChecklist(terminal);

    const response = await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/start',
      headers: auth(terminal.token),
      payload: { latitude: START_LAT, longitude: START_LNG },
    });
    expect(response.status).toBe(200);

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: created.id } });
    expect(trip.status).toBe(TripStatus.STARTED);
    // Without this the fleet's screen had no departure time to measure against,
    // so every duration and every delay on the trip was unanswerable.
    expect(trip.actualStartAt).not.toBeNull();
  });

  it('leaves the terminal working when there is no trip to start', async () => {
    await passChecklist(terminal);

    const response = await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/start',
      headers: auth(terminal.token),
      payload: {},
    });

    // A driver starting a shift on a vehicle with no assigned work is the
    // ordinary case. The session still goes TRIP_ACTIVE.
    expect(response.status).toBe(200);
    const session = await prisma.terminalSession.findFirstOrThrow({
      where: { vehicleId: vehicle.id },
      orderBy: { requestedAt: 'desc' },
    });
    expect(session.status).toBe(TerminalSessionStatus.TRIP_ACTIVE);
  });

  it('refuses to move the fleet trip before the safety check passes', async () => {
    const created = await dispatch(owner, vehicle.id, driver.driverId!);

    const response = await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/start',
      headers: auth(terminal.token),
      payload: {},
    });
    expect(response.status).toBe(422);

    // The session service is what enforces the check, and the dispatch must not
    // slip past it by being a separate write.
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: created.id } });
    expect(trip.status).toBe(TripStatus.ASSIGNED);
  });

  it('records an arrival and closes the trip when the driver finishes', async () => {
    const created = await dispatch(owner, vehicle.id, driver.driverId!);
    await passChecklist(terminal);
    await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/start',
      headers: auth(terminal.token),
      payload: {},
    });

    const response = await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/complete',
      headers: auth(terminal.token),
      payload: { latitude: 13.05, longitude: 77.65 },
    });
    expect(response.status).toBe(200);

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: created.id } });
    // The trip machine has no STARTED → COMPLETED edge, and rightly: a journey
    // with no recorded arrival has no duration. The arrival is recorded first.
    expect(trip.status).toBe(TripStatus.COMPLETED);
    expect(trip.actualArrivalAt).not.toBeNull();

    // And the vehicle is dispatchable again, which is the whole point of the
    // fleet's screen following the vehicle rather than the other way round.
    const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(truck.currentTripId).toBeNull();
  });

  it('leaves a trip the driver never set off on alone', async () => {
    const created = await dispatch(owner, vehicle.id, driver.driverId!);
    await passChecklist(terminal);
    await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/start',
      headers: auth(terminal.token),
      payload: {},
    });
    // Wind the trip back to where a driver who signed on and never departed
    // would leave it — the session is under way, the journey is not.
    await prisma.trip.update({
      where: { id: created.id },
      data: { status: TripStatus.ASSIGNED, actualStartAt: null },
    });

    await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/trip/complete',
      headers: auth(terminal.token),
      payload: {},
    });

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: created.id } });
    // Closing the fleet's job on their behalf would lose work nobody cancelled.
    expect(trip.status).toBe(TripStatus.ASSIGNED);
  });

  it('refuses the dispatch to a terminal with nobody signed on', async () => {
    await dispatch(owner, vehicle.id, driver.driverId!);

    const bare = await pairTerminal(owner, (await createVehicle(fleet.id)).id);
    const response = await request({
      method: 'GET',
      url: '/api/v1/device-gateway/terminal/trip/current',
      headers: auth(bare.token),
    });

    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * A vehicle, of whatever kind the case is about.
 *
 * `prisma.truck` is the model's name and not a statement about what is in the
 * yard — the default here is an open-body lorry because that is the commonest
 * case, and the parameters exist because a fleet's taxis, buses and vans run
 * through exactly the same dispatch path.
 */
async function createVehicle(
  organizationId: string,
  options: {
    vehicleType?: VehicleType;
    truckType?: TruckType;
    capacityTons?: number;
  } = {},
): Promise<{ id: string; registration: string }> {
  const registration = unique('KA01').toUpperCase().slice(-12);
  const truck = await prisma.truck.create({
    data: {
      organizationId,
      registrationNumber: registration,
      vehicleType: options.vehicleType ?? VehicleType.TRUCK,
      truckType: options.truckType ?? TruckType.OPEN_BODY,
      capacityTons: options.capacityTons ?? 20,
      odometerKm: 184_230,
    },
  });
  return { id: truck.id, registration };
}

/** A trip, created the way a dispatcher creates one — through the API. */
async function dispatch(
  owner: TestUser,
  truckId: string,
  driverId: string,
): Promise<{ id: string }> {
  const response = await request<{ id: string }>({
    method: 'POST',
    url: '/api/v1/trips',
    user: owner,
    payload: {
      truckId,
      driverId,
      origin: {
        addressLine: 'Fleet depot, Yeshwanthpur',
        latitude: START_LAT,
        longitude: START_LNG,
      },
      destination: {
        addressLine: 'Peenya Industrial Area, Bengaluru',
        latitude: 13.05,
        longitude: 77.65,
      },
    },
  });

  expect(response.status).toBe(201);
  return response.body.data;
}

async function passChecklist(terminal: EnrolledTerminal): Promise<void> {
  const submitted = await request({
    method: 'POST',
    url: '/api/v1/device-gateway/terminal/checklist',
    headers: auth(terminal.token),
    payload: { items: CHECKLIST_PASS },
  });
  expect(submitted.status).toBe(201);
}

/** A terminal paired to a vehicle, with nobody signed on to it. */
async function pairTerminal(
  owner: TestUser,
  vehicleId: string,
): Promise<EnrolledTerminal> {
  const issued = await request<{ pairingCode: string }>({
    method: 'POST',
    url: `/api/v1/fleet/vehicles/${vehicleId}/terminal-pairing`,
    user: owner,
    payload: {},
  });
  // Asserted rather than assumed: a refusal here — a vehicle type with no
  // HARDWARE capability, a plan at its device ceiling — otherwise surfaces
  // twenty lines later as "cannot read pairingCode of undefined", which names
  // neither the cause nor the vehicle.
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);

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

  return {
    deviceIdentifier: enrolled.body.data.deviceIdentifier,
    token: paired.body.data.token.accessToken,
  };
}

/** A paired terminal with an approved driver on it, ready for a checklist. */
async function signOnDriver(
  owner: TestUser,
  driver: TestUser,
  vehicleId: string,
): Promise<EnrolledTerminal> {
  const terminal = await pairTerminal(owner, vehicleId);

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
