import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, PlanTier, RoleName, TruckType } from '@saarthi/shared';
import bcrypt from 'bcryptjs';
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
 * The Saarthi Device client: enrolment, QR pairing, reassignment and unpairing.
 *
 * The assertions here are mostly about what a phone must *not* be able to do.
 * A device credential is a credential somebody carries into a workshop, so the
 * questions worth testing are whether an enrolled identity can reach tenant
 * data before anyone approved it, whether a pairing code can be spent twice,
 * whether one fleet's code works on another fleet's device, and whether
 * unpairing actually silences a unit rather than politely asking it to stop.
 */

interface EnrolledDevice {
  deviceIdentifier: string;
  secret: string;
  token: string;
  enrolmentId: string;
}

async function enrol(overrides: Record<string, unknown> = {}): Promise<EnrolledDevice> {
  const response = await request<{
    deviceIdentifier: string;
    secret: string;
    enrolmentId: string;
    token: { accessToken: string };
  }>({
    method: 'POST',
    url: '/api/v1/device-gateway/enroll',
    payload: {
      installationId: unique('install-0000000000000000'),
      platform: 'ANDROID',
      deviceModel: 'Pixel 7a',
      osVersion: '14',
      appVersion: '1.0.0',
      ...overrides,
    },
  });

  expect(response.status).toBe(201);
  return {
    deviceIdentifier: response.body.data.deviceIdentifier,
    secret: response.body.data.secret,
    token: response.body.data.token.accessToken,
    enrolmentId: response.body.data.enrolmentId,
  };
}

function deviceAuth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('Saarthi Device client', () => {
  let fleet: TestOrganization;
  let otherFleet: TestOrganization;
  let owner: TestUser;
  let otherOwner: TestUser;
  let dispatcher: TestUser;
  let vehicle: { id: string; registrationNumber: string };
  let secondVehicle: { id: string; registrationNumber: string };

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  // `unique()` puts a timestamp before its counter, so truncating it to a
  // registration-number length can drop the part that makes it unique. A plain
  // counter is enough here: the database is truncated between tests.
  let plateCounter = 0;
  async function makeVehicle(organizationId: string) {
    plateCounter += 1;
    const truck = await prisma.truck.create({
      data: {
        organizationId,
        registrationNumber: `UP32AB${String(plateCounter).padStart(4, '0')}`,
        truckType: TruckType.TIPPER,
        capacityTons: 25,
      },
    });
    return { id: truck.id, registrationNumber: truck.registrationNumber };
  }

  async function issuePairingToken(
    user: TestUser,
    vehicleId: string,
    payload: Record<string, unknown> = {},
  ) {
    return request<{ id: string; token: string; qrPayload: Record<string, unknown> }>({
      method: 'POST',
      url: `/api/v1/fleet/vehicles/${vehicleId}/pairing-token`,
      user,
      payload: { deviceType: 'MOBILE_TEST_DEVICE', ...payload },
    });
  }

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    otherOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: otherFleet.id });
    dispatcher = await createUser({ role: RoleName.DISPATCHER, organizationId: fleet.id });
    vehicle = await makeVehicle(fleet.id);
    secondVehicle = await makeVehicle(fleet.id);
  });

  // -------------------------------------------------------------------------
  // Enrolment
  // -------------------------------------------------------------------------

  describe('enrolment', () => {
    it('issues an identity that belongs to nobody', async () => {
      const device = await enrol();

      expect(device.deviceIdentifier).toMatch(/^SAARTHI-DEV-\d{3,}$/);
      expect(device.secret).toHaveLength(32);

      // The whole point: no HardwareDevice row exists yet, so no organization
      // has acquired a device it did not ask for.
      expect(await prisma.hardwareDevice.count()).toBe(0);

      const enrolment = await prisma.deviceEnrolment.findUniqueOrThrow({
        where: { id: device.enrolmentId },
      });
      expect(enrolment.status).toBe('PENDING');
      expect(enrolment.deviceId).toBeNull();
    });

    it('never stores the secret in recoverable form', async () => {
      const device = await enrol();
      const enrolment = await prisma.deviceEnrolment.findUniqueOrThrow({
        where: { id: device.enrolmentId },
      });

      expect(enrolment.secretHash).not.toBe(device.secret);
      expect(enrolment.secretHash.startsWith('$2')).toBe(true);
      await expect(bcrypt.compare(device.secret, enrolment.secretHash)).resolves.toBe(true);
    });

    it('is idempotent by installation, so a reinstall does not accumulate identities', async () => {
      const installationId = unique('install-0000000000000000');
      const first = await enrol({ installationId });
      const second = await enrol({ installationId });

      expect(second.deviceIdentifier).toBe(first.deviceIdentifier);
      expect(await prisma.deviceEnrolment.count()).toBe(1);
      // A new secret each time, because the caller proved nothing.
      expect(second.secret).not.toBe(first.secret);
    });

    it('refuses an installation identifier too short to be unique', async () => {
      const response = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/enroll',
        payload: { installationId: 'short', platform: 'ANDROID' },
      });
      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Credentials
  // -------------------------------------------------------------------------

  describe('credentials', () => {
    it('exchanges the secret for a short-lived token', async () => {
      const device = await enrol();
      const response = await request<{ accessToken: string; expiresIn: number }>({
        method: 'POST',
        url: '/api/v1/device-gateway/token',
        headers: {
          'x-device-id': device.deviceIdentifier,
          'x-device-secret': device.secret,
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.expiresIn).toBeGreaterThan(0);
      expect(response.body.data.accessToken.split('.')).toHaveLength(3);
    });

    it('gives the same answer for a wrong secret and an unknown device', async () => {
      const device = await enrol();

      const wrongSecret = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/token',
        headers: { 'x-device-id': device.deviceIdentifier, 'x-device-secret': 'wrong-secret-here' },
      });
      const unknownDevice = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/token',
        headers: { 'x-device-id': 'SAARTHI-DEV-999999', 'x-device-secret': 'wrong-secret-here' },
      });

      // Identical status *and* identical message, so the endpoint cannot be
      // used to discover which identifiers exist.
      expect(wrongSecret.status).toBe(401);
      expect(unknownDevice.status).toBe(401);
      expect(wrongSecret.body.error?.message).toBe(unknownDevice.body.error?.message);
    });

    it('accepts HTTP Basic, for firmware that cannot set custom headers', async () => {
      const device = await enrol();
      const basic = Buffer.from(`${device.deviceIdentifier}:${device.secret}`).toString('base64');

      const response = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/token',
        headers: { authorization: `Basic ${basic}` },
      });
      expect(response.status).toBe(200);
    });

    it('refuses a request with no credentials at all', async () => {
      const response = await request({ method: 'GET', url: '/api/v1/device-gateway/me' });
      expect(response.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Before pairing
  // -------------------------------------------------------------------------

  describe('an unpaired device', () => {
    it('can read its own identity and nothing else', async () => {
      const device = await enrol();
      const response = await request<{ paired: boolean; vehicle: unknown; organizationId: unknown }>(
        {
          method: 'GET',
          url: '/api/v1/device-gateway/me',
          headers: deviceAuth(device.token),
        },
      );

      expect(response.status).toBe(200);
      expect(response.body.data.paired).toBe(false);
      expect(response.body.data.vehicle).toBeNull();
      expect(response.body.data.organizationId).toBeNull();
    });

    it('cannot read configuration, because it has no vehicle to be configured for', async () => {
      const device = await enrol();
      const response = await request({
        method: 'GET',
        url: '/api/v1/device-gateway/config',
        headers: deviceAuth(device.token),
      });
      expect(response.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  // Issuing pairing codes
  // -------------------------------------------------------------------------

  describe('issuing a pairing code', () => {
    it('returns a QR payload carrying only a token', async () => {
      const response = await issuePairingToken(owner, vehicle.id);
      expect(response.status).toBe(201);

      const qr = response.body.data.qrPayload as Record<string, unknown>;
      expect(qr.kind).toBe('saarthi.device.pair');
      expect(qr.token).toBe(response.body.data.token);

      // Nothing about the vehicle, the fleet or anyone in it. A QR on a screen
      // is photographed by whoever walks past.
      const serialised = JSON.stringify(qr);
      expect(serialised).not.toContain(vehicle.registrationNumber);
      expect(serialised).not.toContain(fleet.id);
      expect(serialised).not.toContain(vehicle.id);
    });

    it('stores only a hash of the token', async () => {
      const response = await issuePairingToken(owner, vehicle.id);
      const stored = await prisma.devicePairingToken.findUniqueOrThrow({
        where: { id: response.body.data.id },
      });
      expect(stored.tokenHash).not.toBe(response.body.data.token);
      expect(stored.tokenHash).toHaveLength(64);
    });

    it('supersedes any code still outstanding for the same vehicle', async () => {
      const first = await issuePairingToken(owner, vehicle.id);
      const second = await issuePairingToken(owner, vehicle.id);

      const firstRecord = await prisma.devicePairingToken.findUniqueOrThrow({
        where: { id: first.body.data.id },
      });
      expect(firstRecord.revokedAt).not.toBeNull();

      const device = await enrol();
      const stale = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: first.body.data.token },
      });
      expect(stale.status).toBe(422);

      const fresh = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: second.body.data.token },
      });
      expect(fresh.status).toBe(201);
    });

    it('refuses a caller without the pairing grant', async () => {
      const response = await issuePairingToken(dispatcher, vehicle.id);
      expect(response.status).toBe(403);
    });

    it('refuses a fleet trying to claim provisioned hardware', async () => {
      // A fleet may pair its own phone; fitting a recorder Saarthi ships is
      // still central, and the type is what enforces the boundary.
      const response = await issuePairingToken(owner, vehicle.id, { deviceType: 'DASHCAM' });
      expect(response.status).toBe(403);
    });

    it('refuses a vehicle in another organization', async () => {
      const response = await issuePairingToken(otherOwner, vehicle.id);
      expect(response.status).toBe(404);
    });

    it('can be cancelled before it is used', async () => {
      const issued = await issuePairingToken(owner, vehicle.id);
      const revoked = await request({
        method: 'DELETE',
        url: `/api/v1/devices/pairing-tokens/${issued.body.data.id}`,
        user: owner,
      });
      expect(revoked.status).toBe(200);

      const device = await enrol();
      const attempt = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: issued.body.data.token },
      });
      expect(attempt.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  describe('pairing', () => {
    it('promotes the enrolment into a device inside the issuing fleet', async () => {
      const device = await enrol();
      const issued = await issuePairingToken(owner, vehicle.id);

      const paired = await request<{
        identity: {
          deviceId: string;
          paired: boolean;
          organizationId: string;
          vehicle: { registrationNumber: string };
          cameras: unknown[];
          role: string;
        };
        token: { accessToken: string };
      }>({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: issued.body.data.token },
      });

      expect(paired.status).toBe(201);
      expect(paired.body.data.identity.paired).toBe(true);
      expect(paired.body.data.identity.organizationId).toBe(fleet.id);
      expect(paired.body.data.identity.vehicle.registrationNumber).toBe(vehicle.registrationNumber);
      expect(paired.body.data.identity.role).toBe('TELEMETRY');

      const stored = await prisma.hardwareDevice.findUniqueOrThrow({
        where: { deviceIdentifier: device.deviceIdentifier },
      });
      expect(stored.organizationId).toBe(fleet.id);
      expect(stored.provider).toBe('MOBILE');
      expect(stored.deviceType).toBe('MOBILE_TEST_DEVICE');
      expect(stored.selfEnrolled).toBe(true);

      const enrolment = await prisma.deviceEnrolment.findUniqueOrThrow({
        where: { id: device.enrolmentId },
      });
      expect(enrolment.status).toBe('CLAIMED');
      expect(enrolment.deviceId).toBe(stored.id);
    });

    it('registers the phone cameras so the dashboard shows the vehicle, not the device', async () => {
      const device = await enrol();
      const issued = await issuePairingToken(owner, vehicle.id);
      const paired = await request<{ identity: { deviceId: string; cameras: { channel: number }[] } }>(
        {
          method: 'POST',
          url: '/api/v1/device-gateway/pair',
          headers: deviceAuth(device.token),
          payload: { token: issued.body.data.token },
        },
      );

      expect(paired.body.data.identity.cameras.map((camera) => camera.channel)).toEqual([1, 2]);

      const cameras = await prisma.deviceCamera.findMany({
        where: { deviceId: paired.body.data.identity.deviceId },
      });
      expect(cameras).toHaveLength(2);
      // A phone records only while the app asks it to.
      expect(cameras.every((camera) => camera.continuousRecording === false)).toBe(true);
    });

    it('returns a working device token, so pairing is one round trip', async () => {
      const device = await enrol();
      const issued = await issuePairingToken(owner, vehicle.id);
      const paired = await request<{ token: { accessToken: string } }>({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: issued.body.data.token },
      });

      const me = await request<{ paired: boolean }>({
        method: 'GET',
        url: '/api/v1/device-gateway/me',
        headers: deviceAuth(paired.body.data.token.accessToken),
      });
      expect(me.status).toBe(200);
      expect(me.body.data.paired).toBe(true);
    });

    it('leaves the enrolment secret working after promotion', async () => {
      const device = await enrol();
      const issued = await issuePairingToken(owner, vehicle.id);
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: issued.body.data.token },
      });

      const exchanged = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/token',
        headers: {
          'x-device-id': device.deviceIdentifier,
          'x-device-secret': device.secret,
        },
      });
      expect(exchanged.status).toBe(200);
    });

    it('spends a pairing code exactly once', async () => {
      const first = await enrol();
      const second = await enrol();
      const issued = await issuePairingToken(owner, vehicle.id);

      const won = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(first.token),
        payload: { token: issued.body.data.token },
      });
      expect(won.status).toBe(201);

      const lost = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(second.token),
        payload: { token: issued.body.data.token },
      });
      expect(lost.status).toBe(422);
      expect(await prisma.hardwareDevice.count()).toBe(1);
    });

    it('refuses an expired code', async () => {
      const device = await enrol();
      const issued = await issuePairingToken(owner, vehicle.id);
      await prisma.devicePairingToken.update({
        where: { id: issued.body.data.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const attempt = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: issued.body.data.token },
      });
      expect(attempt.status).toBe(422);
    });

    it('reports an unknown code as invalid rather than as missing', async () => {
      const device = await enrol();
      const attempt = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: 'A'.repeat(43) },
      });
      expect(attempt.status).toBe(404);
    });

    it('refuses a code issued by another organization to an established device', async () => {
      // Pair a device into this fleet first, so it is an established device
      // rather than a fresh enrolment.
      const device = await enrol();
      const issued = await issuePairingToken(owner, vehicle.id);
      const paired = await request<{ token: { accessToken: string } }>({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: issued.body.data.token },
      });

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/unpair',
        headers: deviceAuth(paired.body.data.token.accessToken),
      });

      const fresh = await request<{ accessToken: string }>({
        method: 'POST',
        url: '/api/v1/device-gateway/token',
        headers: {
          'x-device-id': device.deviceIdentifier,
          'x-device-secret': device.secret,
        },
      });

      const foreignVehicle = await makeVehicle(otherFleet.id);
      const foreignToken = await issuePairingToken(otherOwner, foreignVehicle.id);

      const attempt = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(fresh.body.data.accessToken),
        payload: { token: foreignToken.body.data.token },
      });

      // Reported as an invalid code, never as a tenant mismatch — a device must
      // not be able to learn that a code belongs to some other fleet.
      expect(attempt.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-device vehicles
  // -------------------------------------------------------------------------

  describe('multiple devices on one vehicle', () => {
    it('allows only one telemetry source', async () => {
      const device = await enrol();
      const issued = await issuePairingToken(owner, vehicle.id);
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: issued.body.data.token },
      });

      const second = await issuePairingToken(owner, vehicle.id);
      expect(second.status).toBe(409);
      expect(second.body.error?.message).toContain('only one telemetry source');
    });

    it('leaves camera devices unrestricted alongside a telemetry source', async () => {
      const device = await enrol();
      const issued = await issuePairingToken(owner, vehicle.id);
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: issued.body.data.token },
      });

      // A YC06 is a camera unit, so it takes no position slot. Fitted directly,
      // as Saarthi provisions it.
      const recorder = await prisma.hardwareDevice.create({
        data: {
          organizationId: fleet.id,
          deviceIdentifier: unique('YC06-').toUpperCase().slice(0, 16),
          provider: 'YC06',
          deviceType: 'MULTI_CAMERA',
          role: 'CAMERA',
          serialNumber: unique('SN-'),
          secretHash: await bcrypt.hash('device-secret', 4),
          status: 'ACTIVE',
          supportedMetrics: [],
          observedMetrics: [],
        },
      });

      const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: fleet.id });
      const assigned = await request({
        method: 'POST',
        url: `/api/v1/devices/${recorder.id}/assign`,
        user: admin,
        payload: { vehicleId: vehicle.id },
      });

      expect(assigned.status).toBe(200);
      const active = await prisma.deviceAssignment.count({
        where: { vehicleId: vehicle.id, status: 'ACTIVE' },
      });
      expect(active).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Unpairing and reassignment
  // -------------------------------------------------------------------------

  describe('unpairing and reassignment', () => {
    async function pairTo(vehicleId: string) {
      const device = await enrol();
      const issued = await issuePairingToken(owner, vehicleId);
      const paired = await request<{
        identity: { deviceId: string };
        token: { accessToken: string };
      }>({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: issued.body.data.token },
      });
      return { ...device, deviceId: paired.body.data.identity.deviceId, deviceToken: paired.body.data.token.accessToken };
    }

    it('closes the assignment rather than deleting it', async () => {
      const device = await pairTo(vehicle.id);

      const unpaired = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/unpair',
        headers: deviceAuth(device.deviceToken),
        payload: { reason: 'Driver handed the phone back' },
      });
      expect(unpaired.status).toBe(200);

      const assignment = await prisma.deviceAssignment.findFirstOrThrow({
        where: { deviceId: device.deviceId },
      });
      expect(assignment.status).toBe('ENDED');
      expect(assignment.unassignedAt).not.toBeNull();
      expect(assignment.vehicleId).toBe(vehicle.id);
      expect(assignment.removalReason).toBe('Driver handed the phone back');
    });

    it('revokes outstanding tokens immediately, not at their next expiry', async () => {
      const device = await pairTo(vehicle.id);

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/unpair',
        headers: deviceAuth(device.deviceToken),
      });

      const afterwards = await request({
        method: 'GET',
        url: '/api/v1/device-gateway/me',
        headers: deviceAuth(device.deviceToken),
      });
      expect(afterwards.status).toBe(401);
    });

    it('keeps historical telemetry attached to the vehicle that produced it', async () => {
      const device = await pairTo(vehicle.id);

      await prisma.telemetryReading.create({
        data: {
          deviceId: device.deviceId,
          vehicleId: vehicle.id,
          organizationId: fleet.id,
          metrics: ['LOCATION'],
          latitude: 28.61,
          longitude: 77.2,
          recordedAt: new Date(),
        },
      });

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/unpair',
        headers: deviceAuth(device.deviceToken),
      });

      const fresh = await request<{ accessToken: string }>({
        method: 'POST',
        url: '/api/v1/device-gateway/token',
        headers: {
          'x-device-id': device.deviceIdentifier,
          'x-device-secret': device.secret,
        },
      });
      const reissued = await issuePairingToken(owner, secondVehicle.id);
      const repaired = await request<{ identity: { vehicle: { registrationNumber: string } } }>({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(fresh.body.data.accessToken),
        payload: { token: reissued.body.data.token },
      });

      expect(repaired.status).toBe(201);
      expect(repaired.body.data.identity.vehicle.registrationNumber).toBe(
        secondVehicle.registrationNumber,
      );

      // The reading recorded before the move still belongs to the first vehicle.
      const readings = await prisma.telemetryReading.findMany({
        where: { deviceId: device.deviceId },
      });
      expect(readings).toHaveLength(1);
      expect(readings[0]?.vehicleId).toBe(vehicle.id);

      // And both assignments survive, in order.
      const assignments = await prisma.deviceAssignment.findMany({
        where: { deviceId: device.deviceId },
        orderBy: { assignedAt: 'asc' },
      });
      expect(assignments.map((a) => a.status)).toEqual(['ENDED', 'ACTIVE']);
    });

    it('frees the telemetry slot for another device', async () => {
      const device = await pairTo(vehicle.id);
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/unpair',
        headers: deviceAuth(device.deviceToken),
      });

      const reissued = await issuePairingToken(owner, vehicle.id);
      expect(reissued.status).toBe(201);
    });

    it('refuses to unpair a device that is not paired', async () => {
      const device = await pairTo(vehicle.id);
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/unpair',
        headers: deviceAuth(device.deviceToken),
      });

      const fresh = await request<{ accessToken: string }>({
        method: 'POST',
        url: '/api/v1/device-gateway/token',
        headers: {
          'x-device-id': device.deviceIdentifier,
          'x-device-secret': device.secret,
        },
      });
      const again = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/unpair',
        headers: deviceAuth(fresh.body.data.accessToken),
      });
      expect(again.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  // Credential revocation
  // -------------------------------------------------------------------------

  describe('revocation', () => {
    it('kills a device token when the unit is suspended', async () => {
      const device = await enrol();
      const issued = await issuePairingToken(owner, vehicle.id);
      const paired = await request<{
        identity: { deviceId: string };
        token: { accessToken: string };
      }>({
        method: 'POST',
        url: '/api/v1/device-gateway/pair',
        headers: deviceAuth(device.token),
        payload: { token: issued.body.data.token },
      });

      const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: fleet.id });
      await request({
        method: 'PATCH',
        url: `/api/v1/devices/${paired.body.data.identity.deviceId}`,
        user: admin,
        payload: { status: 'SUSPENDED' },
      });

      const afterwards = await request({
        method: 'GET',
        url: '/api/v1/device-gateway/me',
        headers: deviceAuth(paired.body.data.token.accessToken),
      });
      expect(afterwards.status).toBe(401);
    });
  });
});
