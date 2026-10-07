import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DeviceAssignmentStatus,
  DeviceProvider,
  DeviceRole,
  DeviceType,
  OrganizationType,
  PlanTier,
  RoleName,
  TerminalSessionStatus,
  TrackerProduct,
  TruckType,
  type TerminalVehicleSetup,
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
 * A driver's own phone, paired through the Saarthi Driver app.
 *
 * The flow the owner relies on:
 *
 *   * the owner assigns a driver; that driver scans the vehicle QR and the phone
 *     pairs at once and stays paired across shifts;
 *   * every shift is still approved, and the phone's position counts only
 *     during an approved shift — it is somebody's personal phone;
 *   * another driver approved onto the vehicle replaces the assigned one, and
 *     the owner reassigning or unassigning ends the old phone's pairing;
 *   * with a Saarthi OBD the app is told to connect the adapter, and with a 4G
 *     tracker the phone stays paired but its position is not used.
 */
describe('Driver phone pairing', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let ramesh: TestUser;
  let suresh: TestUser;
  let vehicle: { id: string; registration: string };

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    ramesh = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
    suresh = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });

    const registration = unique('MH12').toUpperCase().slice(-12);
    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: registration,
        truckType: TruckType.OPEN_BODY,
        capacityTons: 20,
      },
    });
    vehicle = { id: truck.id, registration };
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function deviceAuth(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  async function assign(driver: TestUser): Promise<void> {
    const response = await request({
      method: 'POST',
      url: `/api/v1/trucks/${vehicle.id}/assign-driver`,
      user: owner,
      payload: { driverId: driver.driverId },
    });
    expect(response.status).toBe(200);
  }

  /** The driver scans the vehicle (by registration, the same path as the QR). */
  async function scan(
    driver: TestUser,
  ): Promise<{ id: string; status: string; vehicleSetup: TerminalVehicleSetup }> {
    const response = await request<{
      id: string;
      status: string;
      vehicleSetup: TerminalVehicleSetup;
    }>({
      method: 'POST',
      url: '/api/v1/terminal/assignments/request',
      user: driver,
      payload: { registrationNumber: vehicle.registration },
    });
    expect(response.status).toBe(201);
    return response.body.data;
  }

  /** The driver app asking for a pairing code for the vehicle it is on. */
  async function issuePairingCode(driver: TestUser, sessionId: string): Promise<string> {
    const issued = await request<{ pairingCode: string }>({
      method: 'POST',
      url: `/api/v1/terminal/assignments/${sessionId}/vehicle-pairing`,
      user: driver,
      payload: {},
    });
    expect(issued.status).toBe(201);
    return issued.body.data.pairingCode;
  }

  /** A fresh install of the app taking a device identity. */
  async function enrolPhone(): Promise<{
    enrolmentId: string;
    deviceIdentifier: string;
    secret: string;
    token: string;
  }> {
    const enrolled = await request<{
      enrolmentId: string;
      deviceIdentifier: string;
      secret: string;
      token: { accessToken: string };
    }>({
      method: 'POST',
      url: '/api/v1/device-gateway/enroll',
      payload: {
        installationId: unique('driver-phone-0000000000'),
        platform: 'ANDROID',
        deviceModel: 'Redmi Note 12',
        appVersion: '1.0.0',
        deviceType: DeviceType.VEHICLE_TERMINAL,
      },
    });
    expect(enrolled.status).toBe(201);
    const { enrolmentId, deviceIdentifier, secret, token } = enrolled.body.data;
    return { enrolmentId, deviceIdentifier, secret, token: token.accessToken };
  }

  function redeem(phoneToken: string, pairingCode: string) {
    return request<{ identity: { deviceId: string }; token: { accessToken: string } }>({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/pair',
      headers: deviceAuth(phoneToken),
      payload: { pairingCode },
    });
  }

  /** What the driver app does: ask for a code, then redeem it on the phone. */
  async function pairPhone(
    driver: TestUser,
    sessionId: string,
  ): Promise<{ token: string; deviceId: string }> {
    const pairingCode = await issuePairingCode(driver, sessionId);
    const phone = await enrolPhone();
    const paired = await redeem(phone.token, pairingCode);
    expect(paired.status).toBe(201);
    return {
      token: paired.body.data.token.accessToken,
      deviceId: paired.body.data.identity.deviceId,
    };
  }

  async function approve(driver: TestUser, sessionId: string): Promise<void> {
    await prisma.terminalSession.update({
      where: { id: sessionId },
      data: {
        status: TerminalSessionStatus.SELFIE_SUBMITTED,
        selfieMediaId: crypto.randomUUID(),
        selfieCapturedAt: new Date(),
      },
    });
    const submitted = await request({
      method: 'POST',
      url: `/api/v1/terminal/assignments/${sessionId}/submit`,
      user: driver,
      payload: {},
    });
    expect(submitted.status).toBe(200);
    const approved = await request({
      method: 'POST',
      url: `/api/v1/terminal/assignments/${sessionId}/approve`,
      user: owner,
      payload: {},
    });
    expect(approved.status).toBe(200);
  }

  /** The driver walks away from a request, leaving the vehicle free to scan. */
  async function cancel(driver: TestUser, sessionId: string): Promise<void> {
    const response = await request({
      method: 'POST',
      url: `/api/v1/terminal/assignments/${sessionId}/cancel`,
      user: driver,
      payload: {},
    });
    expect(response.status).toBe(200);
  }

  async function report(token: string): Promise<{ accepted: number; reasons: string[] }> {
    const response = await request<{ accepted: number; reasons: string[] }>({
      method: 'POST',
      url: '/api/v1/device-gateway/location',
      headers: deviceAuth(token),
      payload: {
        points: [
          {
            eventId: unique('evt-000000000000'),
            latitude: 19.07,
            longitude: 72.87,
            recordedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    return response.body.data;
  }

  function activePairing(deviceId: string) {
    return prisma.deviceAssignment.findFirst({
      where: { deviceId, status: DeviceAssignmentStatus.ACTIVE },
    });
  }

  // -------------------------------------------------------------------------
  // The assigned driver
  // -------------------------------------------------------------------------

  it('pairs the assigned driver’s phone as soon as they scan, before any approval', async () => {
    await assign(ramesh);
    const session = await scan(ramesh);
    expect(session.vehicleSetup).toEqual({ assignedToYou: true, tracker: null });

    const phone = await pairPhone(ramesh, session.id);
    const pairing = await activePairing(phone.deviceId);
    expect(pairing?.vehicleId).toBe(vehicle.id);
    expect(pairing?.driverId).toBe(ramesh.driverId);
    expect(pairing?.releaseOnSignOff).toBe(false);
  });

  it('records the phone’s position only during an approved shift', async () => {
    await assign(ramesh);
    const session = await scan(ramesh);
    const phone = await pairPhone(ramesh, session.id);

    const beforeApproval = await report(phone.token);
    expect(beforeApproval.accepted).toBe(0);
    expect(await prisma.telemetryReading.count()).toBe(0);

    await approve(ramesh, session.id);
    const onShift = await report(phone.token);
    expect(onShift.accepted).toBe(1);
  });

  it('keeps the assigned driver and their phone after the shift ends', async () => {
    await assign(ramesh);
    const session = await scan(ramesh);
    const phone = await pairPhone(ramesh, session.id);
    await approve(ramesh, session.id);

    const signedOff = await request({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/session/end',
      headers: deviceAuth(phone.token),
      payload: {},
    });
    expect(signedOff.status).toBe(200);

    expect((await activePairing(phone.deviceId))?.vehicleId).toBe(vehicle.id);
    const assignment = await prisma.truckAssignment.findFirst({
      where: { truckId: vehicle.id, driverId: ramesh.driverId, status: 'ACTIVE' },
    });
    expect(assignment).not.toBeNull();

    // And off shift, nothing it sends is recorded.
    expect((await report(phone.token)).accepted).toBe(0);
  });

  it('pairs the owner’s phone when they type the number of the vehicle they assigned themselves', async () => {
    const ownerDriver = await createUser({
      role: RoleName.FLEET_OWNER,
      organizationId: fleet.id,
      driver: true,
    });
    await assign(ownerDriver);

    // The owner's own sign-on is approved by them, and leaves the standing
    // assignment in place.
    const session = await scan(ownerDriver);
    expect(session.status).toBe(TerminalSessionStatus.APPROVED);
    expect(session.vehicleSetup.assignedToYou).toBe(true);

    const phone = await pairPhone(ownerDriver, session.id);
    const pairing = await activePairing(phone.deviceId);
    expect(pairing?.vehicleId).toBe(vehicle.id);
    expect(pairing?.driverId).toBe(ownerDriver.driverId);
    expect(pairing?.releaseOnSignOff).toBe(false);
  });

  // -------------------------------------------------------------------------
  // A phone whose identity Saarthi refuses
  // -------------------------------------------------------------------------

  it('lets a phone with a refused identity redeem the same code after enrolling afresh', async () => {
    await assign(ramesh);
    const session = await scan(ramesh);
    const pairingCode = await issuePairingCode(ramesh, session.id);

    // Installed days before the driver reached the vehicle: the enrolment the
    // phone still holds has lapsed on the server.
    const stale = await enrolPhone();
    await prisma.deviceEnrolment.update({
      where: { id: stale.enrolmentId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    expect((await redeem(stale.token, pairingCode)).status).toBe(401);
    const exchange = await request({
      method: 'POST',
      url: '/api/v1/device-gateway/token',
      payload: { deviceIdentifier: stale.deviceIdentifier, secret: stale.secret },
    });
    expect(exchange.status).toBe(401);

    // The refusal did not spend the code, so the app's fresh identity can.
    const fresh = await enrolPhone();
    const paired = await redeem(fresh.token, pairingCode);
    expect(paired.status).toBe(201);
    expect((await activePairing(paired.body.data.identity.deviceId))?.vehicleId).toBe(vehicle.id);
  });

  // -------------------------------------------------------------------------
  // Someone else
  // -------------------------------------------------------------------------

  it('pairs a driver who is not assigned only once approved, and only for that shift', async () => {
    await assign(ramesh);
    const rameshSession = await scan(ramesh);
    const rameshPhone = await pairPhone(ramesh, rameshSession.id);
    await cancel(ramesh, rameshSession.id);

    const session = await scan(suresh);
    expect(session.vehicleSetup.assignedToYou).toBe(false);

    const early = await request({
      method: 'POST',
      url: `/api/v1/terminal/assignments/${session.id}/vehicle-pairing`,
      user: suresh,
      payload: {},
    });
    expect(early.status).toBeGreaterThanOrEqual(400);

    await approve(suresh, session.id);

    // Approving Suresh replaced Ramesh, and Ramesh's phone went with him.
    expect(await activePairing(rameshPhone.deviceId)).toBeNull();
    const rameshAssignment = await prisma.truckAssignment.findFirst({
      where: { truckId: vehicle.id, driverId: ramesh.driverId, status: 'ACTIVE' },
    });
    expect(rameshAssignment).toBeNull();

    const sureshPhone = await pairPhone(suresh, session.id);
    expect((await activePairing(sureshPhone.deviceId))?.releaseOnSignOff).toBe(true);
  });

  it('unpairs the old driver’s phone when the owner assigns someone else', async () => {
    await assign(ramesh);
    const session = await scan(ramesh);
    const phone = await pairPhone(ramesh, session.id);
    await cancel(ramesh, session.id);

    await assign(suresh);
    expect(await activePairing(phone.deviceId)).toBeNull();
  });

  it('unpairs the phone when the owner unassigns the driver', async () => {
    await assign(ramesh);
    const session = await scan(ramesh);
    const phone = await pairPhone(ramesh, session.id);
    await cancel(ramesh, session.id);

    const response = await request({
      method: 'POST',
      url: `/api/v1/trucks/${vehicle.id}/unassign-driver`,
      user: owner,
      payload: {},
    });
    expect(response.status).toBe(200);
    expect(await activePairing(phone.deviceId)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Trackers
  // -------------------------------------------------------------------------

  it('tells the driver app that the vehicle has a Saarthi OBD to connect', async () => {
    await prisma.vehicleTracker.create({
      data: {
        organizationId: fleet.id,
        status: 'ACTIVE',
        product: TrackerProduct.OBD_BLUETOOTH,
        pricePaid: 599,
        truckId: vehicle.id,
      },
    });
    await assign(ramesh);

    const session = await scan(ramesh);
    expect(session.vehicleSetup).toEqual({
      assignedToYou: true,
      tracker: TrackerProduct.OBD_BLUETOOTH,
    });
  });

  it('keeps the phone paired but ignores its position on a vehicle with a 4G tracker', async () => {
    const tracker = await prisma.hardwareDevice.create({
      data: {
        organizationId: fleet.id,
        deviceIdentifier: unique('4G-').toUpperCase(),
        provider: DeviceProvider.FREEMATICS,
        role: DeviceRole.TELEMETRY,
        serialNumber: unique('SN-'),
        secretHash: 'not-a-real-hash',
        status: 'ACTIVE',
      },
    });
    await prisma.deviceAssignment.create({
      data: {
        deviceId: tracker.id,
        vehicleId: vehicle.id,
        organizationId: fleet.id,
        status: DeviceAssignmentStatus.ACTIVE,
      },
    });
    await assign(ramesh);

    const session = await scan(ramesh);
    const phone = await pairPhone(ramesh, session.id);
    const device = await prisma.hardwareDevice.findUniqueOrThrow({ where: { id: phone.deviceId } });
    expect(device.role).toBe(DeviceRole.AUXILIARY);

    await approve(ramesh, session.id);
    const sent = await report(phone.token);
    expect(sent.accepted).toBe(0);
    expect(await prisma.telemetryReading.count()).toBe(0);

    // The vehicle's device is the tracker, not the phone.
    const summary = await request<{ device: { deviceId: string } | null }>({
      method: 'GET',
      url: `/api/v1/fleet/vehicles/${vehicle.id}`,
      user: owner,
    });
    expect(summary.body.data.device?.deviceId).toBe(tracker.id);
  });
});
