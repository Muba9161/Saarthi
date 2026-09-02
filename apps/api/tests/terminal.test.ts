import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DeviceType,
  OrganizationType,
  QrSubjectType,
  RoleName,
  TerminalSessionStatus,
  TruckType,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { runTerminalApprovalSweep } from '../src/modules/terminal/approval-sweep.service';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  multipart,
  request,
  requestRaw,
  resetDatabase,
  sampleJpeg,
  unique,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Saarthi Terminal — the driver-authorisation workflow.
 *
 * Almost every assertion here is about something the system must *refuse*.
 * The terminal is the surface that decides whether a person takes a
 * forty-tonne vehicle onto a public road, so the questions worth testing are:
 *
 *  * Can a terminal reach anything before somebody paired it?
 *  * Can a driver sign on to a vehicle in another fleet?
 *  * Does scanning a QR authorise anybody? (It must not.)
 *  * Can a trip start without the safety check?
 *  * Does the fifteen-minute SLA ever approve anybody? (It must not.)
 *  * Can a terminal grade its own checklist?
 */

interface EnrolledTerminal {
  deviceIdentifier: string;
  secret: string;
  token: string;
}

async function enrolTerminal(): Promise<EnrolledTerminal> {
  const response = await request<{
    deviceIdentifier: string;
    secret: string;
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

  expect(response.status).toBe(201);
  return {
    deviceIdentifier: response.body.data.deviceIdentifier,
    secret: response.body.data.secret,
    token: response.body.data.token.accessToken,
  };
}

function terminalAuth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function createVehicle(organizationId: string): Promise<{ id: string; registration: string }> {
  // `slice(-12)` keeps the tail. `unique` puts its counter last, so taking the
  // first twelve characters cut the counter off — two vehicles created in the
  // same millisecond got the same registration and the second insert failed.
  const registration = unique('UP32').toUpperCase().slice(-12);
  const truck = await prisma.truck.create({
    data: {
      organizationId,
      registrationNumber: registration,
      truckType: TruckType.OPEN_BODY,
      capacityTons: 20,
      odometerKm: 184_230,
    },
  });
  return { id: truck.id, registration };
}

describe('Saarthi Terminal', () => {
  let fleet: TestOrganization;
  let otherFleet: TestOrganization;
  let owner: TestUser;
  let driver: TestUser;
  let outsideDriver: TestUser;
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
    otherFleet = await createOrganization(OrganizationType.FLEET_OWNER);

    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    driver = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleet.id,
      driver: true,
    });
    outsideDriver = await createUser({
      role: RoleName.DRIVER,
      organizationId: otherFleet.id,
      driver: true,
    });

    vehicle = await createVehicle(fleet.id);
  });

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  describe('pairing', () => {
    it('connects a terminal to a vehicle with a typed code', async () => {
      const issued = await request<{ pairingCode: string; token: string }>({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/terminal-pairing`,
        user: owner,
        payload: {},
      });
      expect(issued.status).toBe(201);
      expect(issued.body.data.pairingCode).toMatch(/^STH-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

      const terminal = await enrolTerminal();
      const paired = await request<{ identity: { vehicle: { registrationNumber: string } } }>({
        method: 'POST',
        url: '/api/v1/device-gateway/terminal/pair',
        headers: terminalAuth(terminal.token),
        payload: { pairingCode: issued.body.data.pairingCode },
      });

      expect(paired.status).toBe(201);
      expect(paired.body.data.identity.vehicle.registrationNumber).toBe(vehicle.registration);
    });

    it('connects with the scanned token as well as the typed code', async () => {
      const issued = await request<{ token: string }>({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/terminal-pairing`,
        user: owner,
        payload: {},
      });

      const terminal = await enrolTerminal();
      const paired = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/terminal/pair',
        headers: terminalAuth(terminal.token),
        payload: { token: issued.body.data.token },
      });

      expect(paired.status).toBe(201);
    });

    it('spends a pairing code exactly once', async () => {
      const issued = await request<{ pairingCode: string }>({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/terminal-pairing`,
        user: owner,
        payload: {},
      });

      const first = await enrolTerminal();
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/terminal/pair',
        headers: terminalAuth(first.token),
        payload: { pairingCode: issued.body.data.pairingCode },
      });

      const second = await enrolTerminal();
      const replay = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/terminal/pair',
        headers: terminalAuth(second.token),
        payload: { pairingCode: issued.body.data.pairingCode },
      });

      expect(replay.status).toBeGreaterThanOrEqual(400);
    });

    it('refuses a code that was never issued', async () => {
      const terminal = await enrolTerminal();
      const response = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/terminal/pair',
        headers: terminalAuth(terminal.token),
        payload: { pairingCode: 'STH-0000-0000' },
      });

      expect(response.status).toBe(404);
    });

    it('refuses a terminal pairing code to a driver, who cannot fit hardware', async () => {
      const response = await request({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/terminal-pairing`,
        user: driver,
        payload: {},
      });

      expect(response.status).toBe(403);
    });

    it('gives an unpaired terminal a state rather than a refusal', async () => {
      // "Not connected to a vehicle" is the first screen the app ever shows.
      // Answering it with a 4xx would be a worse way to say it.
      const terminal = await enrolTerminal();
      const response = await request<{ state: string; terminal: { paired: boolean } }>({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/state',
        headers: terminalAuth(terminal.token),
      });

      expect(response.status).toBe(200);
      expect(response.body.data.state).toBe('UNPAIRED');
      expect(response.body.data.terminal.paired).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // The vehicle QR
  // -------------------------------------------------------------------------

  describe('the vehicle QR', () => {
    let terminal: EnrolledTerminal;

    beforeEach(async () => {
      terminal = await pairTerminal(owner, vehicle.id);
    });

    it('shows the vehicle\'s own permanent code, not a new one per driver', async () => {
      const first = await request<{ qrCodeId: string }>({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/vehicle-qr',
        headers: terminalAuth(terminal.token),
      });
      const second = await request<{ qrCodeId: string }>({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/vehicle-qr',
        headers: terminalAuth(terminal.token),
      });

      expect(first.status).toBe(200);
      // The same code twice. Section 10: the vehicle QR is permanent identity,
      // and the terminal must never mint a temporary driver-session code.
      expect(second.body.data.qrCodeId).toBe(first.body.data.qrCodeId);

      const codes = await prisma.qrCode.findMany({
        where: { subjectType: QrSubjectType.VEHICLE, subjectId: vehicle.id },
      });
      expect(codes).toHaveLength(1);
    });

    it('renders an image the terminal can display without a QR encoder', async () => {
      const response = await request<{ imageDataUri: string; shortLabel: string }>({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/vehicle-qr',
        headers: terminalAuth(terminal.token),
      });

      // PNG specifically. Android's BitmapFactory cannot decode SVG, so the
      // browser-friendly form of this URI renders as nothing on a terminal and
      // does it silently. This assertion is the regression guard.
      expect(response.body.data.imageDataUri).toMatch(/^data:image\/png;base64,/);
      expect(response.body.data.shortLabel.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Driver arrival
  // -------------------------------------------------------------------------

  describe('driver arrival', () => {
    let terminal: EnrolledTerminal;
    let qrToken: string;

    beforeEach(async () => {
      terminal = await pairTerminal(owner, vehicle.id);
      await request({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/vehicle-qr',
        headers: terminalAuth(terminal.token),
      });
      const code = await prisma.qrCode.findFirstOrThrow({
        where: { subjectType: QrSubjectType.VEHICLE, subjectId: vehicle.id },
      });
      qrToken = code.token;
    });

    it('opens a request, and that request authorises nothing', async () => {
      const response = await request<{ status: string; state: string }>({
        method: 'POST',
        url: '/api/v1/terminal/assignments/request',
        user: driver,
        payload: { qrToken, latitude: 28.61, longitude: 77.2 },
      });

      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe(TerminalSessionStatus.DRIVER_IDENTIFIED);

      // Section 52: scanning a vehicle QR does not itself authorise the driver.
      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(truck.currentDriverId).toBeNull();
    });

    it('refuses a driver from another fleet, as a not-found', async () => {
      const response = await request({
        method: 'POST',
        url: '/api/v1/terminal/assignments/request',
        user: outsideDriver,
        payload: { qrToken },
      });

      // Not 403: an outsider must not be able to use this endpoint to discover
      // which vehicles belong to whom.
      expect(response.status).toBe(404);
    });

    it('refuses a non-driver account', async () => {
      const response = await request({
        method: 'POST',
        url: '/api/v1/terminal/assignments/request',
        user: owner,
        payload: { qrToken },
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    /**
     * The arrival photo, through the real multipart path.
     *
     * The other cases in this file write the selfie straight to the database,
     * which is why this one exists: the browser sends the photo *and* a
     * thumbnail, two file parts, and the server was configured to accept one.
     * Busboy aborted the second and answered "reach files limit" — a message
     * about no photo, no limit anybody had chosen, and nothing a driver
     * standing beside a truck could act on.
     */
    it('accepts the photo and its thumbnail in one upload', async () => {
      const created = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/terminal/assignments/request',
        user: driver,
        payload: { qrToken },
      });
      const sessionId = created.body.data.id;

      const body = multipart({ capturedAt: new Date().toISOString() }, [
        {
          fieldName: 'file',
          fileName: 'arrival.jpg',
          contentType: 'image/jpeg',
          content: sampleJpeg(2_048),
        },
        {
          fieldName: 'thumbnail',
          fileName: 'arrival-thumb.jpg',
          contentType: 'image/jpeg',
          content: sampleJpeg(256),
        },
      ]);

      const response = await request<{ status: string; selfieCapturedAt: string | null }>({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${sessionId}/selfie`,
        user: driver,
        payload: body.payload,
        headers: body.headers,
      });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe(TerminalSessionStatus.SELFIE_SUBMITTED);
      expect(response.body.data.selfieCapturedAt).not.toBeNull();
    });

    it('will not submit for approval without an arrival photo', async () => {
      const created = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/terminal/assignments/request',
        user: driver,
        payload: { qrToken },
      });

      const submitted = await request({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${created.body.data.id}/submit`,
        user: driver,
        payload: {},
      });

      // Section 9 of the constraints: the selfie is required before approval.
      expect(submitted.status).toBe(422);
    });

    it('returns the driver\'s existing request rather than opening a second one', async () => {
      const first = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/terminal/assignments/request',
        user: driver,
        payload: { qrToken },
      });
      const second = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/terminal/assignments/request',
        user: driver,
        payload: { qrToken },
      });

      // A driver reopening the app is not a second arrival.
      expect(second.body.data.id).toBe(first.body.data.id);
    });
  });

  // -------------------------------------------------------------------------
  // Approval
  // -------------------------------------------------------------------------

  describe('approval', () => {
    let terminal: EnrolledTerminal;
    let sessionId: string;

    beforeEach(async () => {
      terminal = await pairTerminal(owner, vehicle.id);
      sessionId = await openSubmittedRequest(terminal, driver, vehicle.id);
    });

    it('assigns the driver to the vehicle', async () => {
      const response = await request<{ status: string; state: string }>({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${sessionId}/approve`,
        user: owner,
        payload: { assignVehicle: true },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe(TerminalSessionStatus.APPROVED);
      // Approved but not yet ready: the safety check is still outstanding.
      expect(response.body.data.state).toBe('CHECKLIST_REQUIRED');

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(truck.currentDriverId).toBe(driver.driverId);
    });

    it('refuses an approval from another fleet', async () => {
      const outsideOwner = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: otherFleet.id,
      });

      const response = await request({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${sessionId}/approve`,
        user: outsideOwner,
        payload: {},
      });

      expect(response.status).toBe(404);
    });

    it('refuses an approval from a driver', async () => {
      // The grant that puts somebody behind a wheel is not one a driver holds.
      const response = await request({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${sessionId}/approve`,
        user: driver,
        payload: {},
      });

      expect(response.status).toBe(403);
    });

    it('requires a reason to reject, and shows it to the driver', async () => {
      const withoutReason = await request({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${sessionId}/reject`,
        user: owner,
        payload: {},
      });
      expect(withoutReason.status).toBe(400);

      const rejected = await request<{ status: string; rejectionReason: string }>({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${sessionId}/reject`,
        user: owner,
        payload: { reason: 'You are rostered on a different vehicle today.' },
      });

      expect(rejected.status).toBe(200);
      expect(rejected.body.data.status).toBe(TerminalSessionStatus.REJECTED);
      expect(rejected.body.data.rejectionReason).toContain('rostered');

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(truck.currentDriverId).toBeNull();
    });

    it('cannot be approved twice into two assignments', async () => {
      await request({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${sessionId}/approve`,
        user: owner,
        payload: {},
      });
      await request({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${sessionId}/approve`,
        user: owner,
        payload: {},
      });

      const assignments = await prisma.truckAssignment.findMany({
        where: { truckId: vehicle.id, status: 'ACTIVE' },
      });
      expect(assignments).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // The SLA
  // -------------------------------------------------------------------------

  describe('the fifteen-minute SLA', () => {
    it('escalates an unanswered request but never approves it', async () => {
      const terminal = await pairTerminal(owner, vehicle.id);
      const sessionId = await openSubmittedRequest(terminal, driver, vehicle.id);

      // Wind the clock back past the escalation threshold.
      await prisma.terminalSession.update({
        where: { id: sessionId },
        data: { submittedAt: new Date(Date.now() - 20 * 60_000) },
      });

      const result = await runTerminalApprovalSweep();
      expect(result.escalated).toBe(1);

      const session = await prisma.terminalSession.findUniqueOrThrow({
        where: { id: sessionId },
      });

      // The assertion the whole feature rests on. Section 15: fifteen minutes
      // is an escalation, not an approval.
      expect(session.status).toBe(TerminalSessionStatus.PENDING_APPROVAL);
      expect(session.escalatedAt).not.toBeNull();
      expect(session.decidedAt).toBeNull();

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(truck.currentDriverId).toBeNull();
    });

    it('expires a request nobody ever answered, failing closed', async () => {
      const terminal = await pairTerminal(owner, vehicle.id);
      const sessionId = await openSubmittedRequest(terminal, driver, vehicle.id);

      await prisma.terminalSession.update({
        where: { id: sessionId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const result = await runTerminalApprovalSweep();
      expect(result.expired).toBe(1);

      const session = await prisma.terminalSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(session.status).toBe(TerminalSessionStatus.EXPIRED);

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(truck.currentDriverId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Checklist and trip
  // -------------------------------------------------------------------------

  describe('the pre-trip check', () => {
    let terminal: EnrolledTerminal;

    beforeEach(async () => {
      terminal = await pairTerminal(owner, vehicle.id);
      const sessionId = await openSubmittedRequest(terminal, driver, vehicle.id);
      await request({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${sessionId}/approve`,
        user: owner,
        payload: {},
      });
    });

    it('offers the ten default points when a fleet has configured nothing', async () => {
      const response = await request<{
        template: { isDefault: boolean };
        items: { code: string; manualInputRequired: boolean }[];
      }>({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/checklist',
        headers: terminalAuth(terminal.token),
      });

      expect(response.status).toBe(200);
      expect(response.body.data.template.isDefault).toBe(true);
      expect(response.body.data.items).toHaveLength(10);
    });

    it('asks for a manual inspection when the vehicle reports nothing', async () => {
      const response = await request<{
        items: { code: string; status: string | null; manualInputRequired: boolean }[];
      }>({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/checklist',
        headers: terminalAuth(terminal.token),
      });

      const coolant = response.body.data.items.find((entry) => entry.code === 'COOLANT');
      // Section 18: never claim a reading the vehicle did not produce.
      expect(coolant?.status).toBeNull();
      expect(coolant?.manualInputRequired).toBe(true);
    });

    it('makes the driver ready when the check passes', async () => {
      const submitted = await request<{ outcome: string }>({
        method: 'POST',
        url: '/api/v1/device-gateway/terminal/checklist',
        headers: terminalAuth(terminal.token),
        payload: {
          items: [
            'TYRES', 'COOLANT', 'ENGINE_OIL', 'BRAKES', 'LIGHTS',
            'BATTERY', 'FUEL', 'MIRRORS', 'EMERGENCY_EQUIPMENT', 'DOCUMENTS',
          ].map((code) => ({ code, status: 'OK' })),
        },
      });

      expect(submitted.status).toBe(201);

      const state = await request<{ state: string }>({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/state',
        headers: terminalAuth(terminal.token),
      });
      expect(state.body.data.state).toBe('READY');
    });

    it('blocks the trip when a blocking item is faulty', async () => {
      const submitted = await request<{ outcome: string; blockedBy: string[] }>({
        method: 'POST',
        url: '/api/v1/device-gateway/terminal/checklist',
        headers: terminalAuth(terminal.token),
        payload: {
          items: [
            { code: 'BRAKES', status: 'CRITICAL' },
            { code: 'TYRES', status: 'OK' },
          ],
        },
      });

      expect(submitted.body.data.outcome).toBe('FAILED');
      expect(submitted.body.data.blockedBy).toContain('Brakes');

      const state = await request<{ state: string }>({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/state',
        headers: terminalAuth(terminal.token),
      });
      // Still not ready. A failed check does not become a trip.
      expect(state.body.data.state).toBe('CHECKLIST_REQUIRED');
    });

    it('refuses to start a trip before the check is complete', async () => {
      const response = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/terminal/trip/start',
        headers: terminalAuth(terminal.token),
        payload: {},
      });

      expect(response.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  // Authorisation boundaries on the terminal surface
  // -------------------------------------------------------------------------

  describe('terminal authorisation', () => {
    it('refuses the checklist to a terminal with nobody signed on', async () => {
      const terminal = await pairTerminal(owner, vehicle.id);
      const response = await request({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/checklist',
        headers: terminalAuth(terminal.token),
      });

      expect(response.status).toBe(403);
    });

    it('refuses the terminal surface to a user session', async () => {
      // A person's access token is not an accepted identity on the device
      // gateway, and vice versa. Two credential populations, two signing keys.
      const response = await request({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/state',
        user: owner,
      });

      expect(response.status).toBe(401);
    });

    it('refuses the terminal surface to a Saarthi Device test phone', async () => {
      const phone = await request<{ token: { accessToken: string } }>({
        method: 'POST',
        url: '/api/v1/device-gateway/enroll',
        payload: {
          installationId: unique('phone-00000000000000'),
          platform: 'ANDROID',
          deviceType: DeviceType.MOBILE_TEST_DEVICE,
        },
      });

      const response = await request({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/vehicle-qr',
        headers: terminalAuth(phone.body.data.token.accessToken),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  // -------------------------------------------------------------------------
  // The arrival photo on the terminal
  // -------------------------------------------------------------------------

  /**
   * The cockpit shows the face of whoever is signed on.
   *
   * The session view carries a `selfieUrl`, but it points at the media endpoint,
   * which authenticates a *person*. A terminal holds a device credential signed
   * with a different key, so it knew the URL and was refused at it every time —
   * the cab screen showed a name and no face, which is the one thing the
   * photograph exists to provide.
   */
  describe('the arrival photo', () => {
    it('serves the photo of the driver signed on to that terminal', async () => {
      const terminal = await pairTerminal(owner, vehicle.id);
      const sessionId = await openSubmittedRequest(terminal, driver, vehicle.id, {
        realSelfie: true,
      });
      await request({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${sessionId}/approve`,
        user: owner,
        payload: { assignVehicle: true },
      });

      // Raw: the body is a JPEG, and parsing it as JSON throws before a
      // single assertion runs.
      const response = await requestRaw({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/selfie',
        headers: terminalAuth(terminal.token),
      });

      expect(response.status).toBe(200);
      expect(String(response.headers['content-type'])).toContain('image/');
      expect(response.body.length).toBeGreaterThan(0);
      // Never a shared cache. This is a photograph of a person, and one driver
      // signing off must not leave their face available to the next.
      expect(String(response.headers['cache-control'])).toContain('private');
    });

    it('refuses a terminal with nobody signed on', async () => {
      const terminal = await pairTerminal(owner, vehicle.id);

      const response = await request({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/selfie',
        headers: terminalAuth(terminal.token),
      });

      expect(response.status).toBe(403);
    });

    it('does not serve another terminal photo', async () => {
      // The endpoint takes no media id: a terminal asks for "whoever is signed
      // on to me". A second terminal, with its own driver, must therefore never
      // be able to reach the first one photo — not even by guessing.
      const terminal = await pairTerminal(owner, vehicle.id);
      await openSubmittedRequest(terminal, driver, vehicle.id, { realSelfie: true });

      const otherVehicle = await createVehicle(fleet.id);
      const otherTerminal = await pairTerminal(owner, otherVehicle.id);

      const response = await request({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/selfie',
        headers: terminalAuth(otherTerminal.token),
      });

      expect(response.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Disconnecting
  // -------------------------------------------------------------------------

  /**
   * A vehicle carries exactly one telemetry source, so a terminal that cannot
   * be removed makes the first one fitted permanent. That is not a tidiness
   * problem: the vehicle can never take a replacement, and the tablet in the
   * cab may be broken, stolen, or in another truck.
   */
  describe('disconnecting', () => {
    it('lets the fleet remove a terminal and connect another one', async () => {
      const terminal = await pairTerminal(owner, vehicle.id);
      const device = await prisma.hardwareDevice.findFirstOrThrow({
        where: { deviceIdentifier: terminal.deviceIdentifier },
      });

      const unpaired = await request({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/devices/${device.id}/unpair`,
        user: owner,
        payload: { reason: 'Tablet replaced.' },
      });

      expect(unpaired.status).toBe(200);

      // The point of the removal: the slot is free again.
      const replacement = await pairTerminal(owner, vehicle.id);
      const state = await request({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/state',
        headers: terminalAuth(replacement.token),
      });
      expect(state.status).toBe(200);
    });

    it('stops the removed terminal reporting immediately', async () => {
      const terminal = await pairTerminal(owner, vehicle.id);
      const device = await prisma.hardwareDevice.findFirstOrThrow({
        where: { deviceIdentifier: terminal.deviceIdentifier },
      });

      await request({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/devices/${device.id}/unpair`,
        user: owner,
        payload: {},
      });

      // Not when its current token happens to expire — now. A tablet removed
      // because it was stolen must not keep writing to the vehicle it left.
      const afterwards = await request({
        method: 'GET',
        url: '/api/v1/device-gateway/terminal/state',
        headers: terminalAuth(terminal.token),
      });
      expect(afterwards.status).toBe(401);
    });

    it('signs off the driver the terminal was carrying', async () => {
      const terminal = await pairTerminal(owner, vehicle.id);
      const sessionId = await openSubmittedRequest(terminal, driver, vehicle.id);
      await request({
        method: 'POST',
        url: `/api/v1/terminal/assignments/${sessionId}/approve`,
        user: owner,
        payload: { assignVehicle: true },
      });

      const device = await prisma.hardwareDevice.findFirstOrThrow({
        where: { deviceIdentifier: terminal.deviceIdentifier },
      });
      await request({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/devices/${device.id}/unpair`,
        user: owner,
        payload: {},
      });

      // A session that outlived its terminal would sit in the approval queue
      // naming a live driver, with nothing left on the truck able to end it.
      const session = await prisma.terminalSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(session.status).toBe(TerminalSessionStatus.COMPLETED);
      expect(session.endedAt).not.toBeNull();

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(truck.currentDriverId).toBeNull();
    });

    it('refuses to remove a terminal from another fleet', async () => {
      const terminal = await pairTerminal(owner, vehicle.id);
      const device = await prisma.hardwareDevice.findFirstOrThrow({
        where: { deviceIdentifier: terminal.deviceIdentifier },
      });
      const outsideOwner = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: otherFleet.id,
      });

      const response = await request({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/devices/${device.id}/unpair`,
        user: outsideOwner,
        payload: {},
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);

      const assignment = await prisma.deviceAssignment.findFirstOrThrow({
        where: { deviceId: device.id },
      });
      expect(assignment.status).toBe('ACTIVE');
    });

    it('refuses to remove a terminal to a driver', async () => {
      const terminal = await pairTerminal(owner, vehicle.id);
      const device = await prisma.hardwareDevice.findFirstOrThrow({
        where: { deviceIdentifier: terminal.deviceIdentifier },
      });

      const response = await request({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/devices/${device.id}/unpair`,
        user: driver,
        payload: {},
      });

      expect(response.status).toBe(403);
    });
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Issue a code and redeem it, returning the paired terminal's credentials.
 *
 * The token is taken from the *pairing response*, not from enrolment. That is
 * not a detail: the moment an enrolment is claimed, the token it was issued
 * stops resolving — correctly, because the caller is now a device with a
 * different subject. A terminal that kept using its enrolment token would 401
 * on its very next request, which is exactly what the first run of these tests
 * demonstrated.
 */
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

  const terminal = await enrolTerminal();
  const paired = await request<{ token: { accessToken: string } }>({
    method: 'POST',
    url: '/api/v1/device-gateway/terminal/pair',
    headers: terminalAuth(terminal.token),
    payload: { pairingCode: issued.body.data.pairingCode },
  });
  expect(paired.status).toBe(201);

  return { ...terminal, token: paired.body.data.token.accessToken };
}

/**
 * A request that has reached PENDING_APPROVAL.
 *
 * The selfie is written directly rather than uploaded, because the multipart
 * path has its own coverage in the media tests and what these cases are about
 * is the decision that follows it.
 */
async function openSubmittedRequest(
  terminal: EnrolledTerminal,
  driver: TestUser,
  vehicleId: string,
  options: { realSelfie?: boolean } = {},
): Promise<string> {
  await request({
    method: 'GET',
    url: '/api/v1/device-gateway/terminal/vehicle-qr',
    headers: terminalAuth(terminal.token),
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

  const sessionId = created.body.data.id;

  if (options.realSelfie) {
    // Through the upload path, so a stored asset actually exists. The shortcut
    // below writes a media id that resolves to nothing, which is fine for a
    // test about approval and useless for one about serving the image.
    const body = multipart({ capturedAt: new Date().toISOString() }, [
      {
        fieldName: 'file',
        fileName: 'arrival.jpg',
        contentType: 'image/jpeg',
        content: sampleJpeg(2_048),
      },
    ]);
    const uploaded = await request({
      method: 'POST',
      url: `/api/v1/terminal/assignments/${sessionId}/selfie`,
      user: driver,
      payload: body.payload,
      headers: body.headers,
    });
    expect(uploaded.status).toBe(200);
  } else {
    await prisma.terminalSession.update({
      where: { id: sessionId },
      data: {
        status: TerminalSessionStatus.SELFIE_SUBMITTED,
        selfieMediaId: crypto.randomUUID(),
        selfieCapturedAt: new Date(),
      },
    });
  }

  const submitted = await request({
    method: 'POST',
    url: `/api/v1/terminal/assignments/${sessionId}/submit`,
    user: driver,
    payload: {},
  });
  expect(submitted.status).toBe(200);

  return sessionId;
}
