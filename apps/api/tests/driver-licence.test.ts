import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrganizationType, RoleName, type SessionPayload } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { AuditAction } from '../src/modules/audit/audit.service';
import {
  TEST_PASSWORD,
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  unique,
  uniquePhone,
  type TestOrganization,
} from './helpers';

/**
 * A driver may register without a driving licence ("I'll do it later") and add
 * it afterwards from the app with `PUT /drivers/me/licence`.
 */

const LICENCE_URL = '/api/v1/drivers/me/licence';
const DUPLICATE_MESSAGE = 'This licence number is already registered with the fleet.';

interface Registration {
  accessToken: string;
  session: SessionPayload;
}

function registerDriver(extra: Record<string, unknown> = {}) {
  return request<Registration>({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      firstName: 'Mahesh',
      lastName: 'Patel',
      email: `${unique('dl-later')}@test.local`,
      phone: uniquePhone(),
      password: TEST_PASSWORD,
      role: RoleName.DRIVER,
      acceptedTerms: true,
      ...extra,
    },
  });
}

function addLicence(accessToken: string, licenseNumber: unknown) {
  return request<{ licenseNumber: string }>({
    method: 'PUT',
    url: LICENCE_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { licenseNumber },
  });
}

let sequence = 0;
/** A licence number no other test uses, so the per-fleet unique rule never collides. */
function nextLicence(): string {
  sequence += 1;
  return `UP32${Date.now().toString().slice(-7)}${String(1000 + sequence)}`;
}

/** A fleet somebody runs — an owner-less organization employs nobody. */
async function staffedFleet(): Promise<TestOrganization> {
  const fleet = await createOrganization(OrganizationType.FLEET_OWNER);
  await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
  return fleet;
}

describe('driver licence added later', () => {
  beforeAll(async () => {
    await resetDatabase();
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('registration', () => {
    it('registers a driver who skips the licence, and says so on the session', async () => {
      const { status, body } = await registerDriver();

      expect(status).toBe(201);
      expect(body.data.session.driver).not.toBeNull();
      expect(body.data.session.driver?.licenseNumber).toBeNull();

      const driver = await prisma.driver.findUniqueOrThrow({
        where: { id: body.data.session.driver?.id ?? '' },
      });
      expect(driver.licenseNumber).toBeNull();
    });

    it('treats a blank licence as not added rather than as an empty one', async () => {
      const { status, body } = await registerDriver({ licenseNumber: '   ' });

      expect(status).toBe(201);
      expect(body.data.session.driver?.licenseNumber).toBeNull();
    });

    it('lets several drivers without a licence register into one fleet', async () => {
      const fleet = await staffedFleet();

      const first = await registerDriver({ fleetInviteCode: fleet.inviteCode });
      const second = await registerDriver({ fleetInviteCode: fleet.inviteCode });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.session.organization?.id).toBe(fleet.id);
    });

    it('still registers a driver who gives their licence', async () => {
      const licence = nextLicence();
      const { status, body } = await registerDriver({ licenseNumber: licence });

      expect(status).toBe(201);
      expect(body.data.session.driver?.licenseNumber).toBe(licence);
    });
  });

  describe('PUT /drivers/me/licence', () => {
    it('lets the driver add their licence once, and the session then carries it', async () => {
      const registration = await registerDriver();
      const token = registration.body.data.accessToken;
      const driverId = registration.body.data.session.driver?.id ?? '';
      const licence = nextLicence();

      // Typed in lowercase with stray spaces; stored as printed on the card.
      const { status, body } = await addLicence(token, `  ${licence.toLowerCase()} `);

      expect(status).toBe(200);
      expect(body.data).toEqual({ licenseNumber: licence });

      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.licenseNumber).toBe(licence);

      const me = await request<SessionPayload>({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.body.data.driver?.licenseNumber).toBe(licence);

      const audit = await prisma.auditLog.findFirst({
        where: { action: AuditAction.DRIVER_UPDATED, entityId: driverId },
      });
      expect(audit).not.toBeNull();
    });

    it('refuses a second licence once one is on record', async () => {
      const registration = await registerDriver();
      const token = registration.body.data.accessToken;
      const driverId = registration.body.data.session.driver?.id ?? '';
      const licence = nextLicence();

      expect((await addLicence(token, licence)).status).toBe(200);
      const second = await addLicence(token, nextLicence());

      expect(second.status).toBe(409);
      expect(second.body.error?.code).toBe('CONFLICT');
      expect(second.body.error?.message).toMatch(/already on record/i);

      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.licenseNumber).toBe(licence);
    });

    it('refuses a driver who registered with a licence', async () => {
      const registration = await registerDriver({ licenseNumber: nextLicence() });

      const { status, body } = await addLicence(registration.body.data.accessToken, nextLicence());

      expect(status).toBe(409);
      expect(body.error?.code).toBe('CONFLICT');
    });

    it('refuses a licence another driver in the same fleet already holds', async () => {
      const fleet = await staffedFleet();
      const licence = nextLicence();
      // Registered as typed, in lowercase: still the same licence.
      const holder = await registerDriver({
        fleetInviteCode: fleet.inviteCode,
        licenseNumber: licence.toLowerCase(),
      });
      expect(holder.status).toBe(201);

      const latecomer = await registerDriver({ fleetInviteCode: fleet.inviteCode });
      const latecomerId = latecomer.body.data.session.driver?.id ?? '';

      const { status, body } = await addLicence(latecomer.body.data.accessToken, licence);

      expect(status).toBe(409);
      expect(body.error?.code).toBe('DUPLICATE_RESOURCE');
      expect(body.error?.message).toBe(DUPLICATE_MESSAGE);
      expect(body.error?.details?.fields).toEqual({ licenseNumber: [DUPLICATE_MESSAGE] });

      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: latecomerId } });
      expect(driver.licenseNumber).toBeNull();
    });

    it('allows the same licence in a different organization', async () => {
      const licence = nextLicence();
      await registerDriver({ licenseNumber: licence });
      const other = await registerDriver();

      const { status } = await addLicence(other.body.data.accessToken, licence);

      expect(status).toBe(200);
    });

    it('validates the number', async () => {
      const registration = await registerDriver();

      const tooShort = await addLicence(registration.body.data.accessToken, 'AB1');
      const missing = await request({
        method: 'PUT',
        url: LICENCE_URL,
        headers: { authorization: `Bearer ${registration.body.data.accessToken}` },
        payload: {},
      });

      expect(tooShort.status).toBe(400);
      expect(tooShort.body.error?.code).toBe('VALIDATION_ERROR');
      expect(missing.status).toBe(400);
    });

    it('is only for a driver account', async () => {
      const fleet = await createOrganization(OrganizationType.FLEET_OWNER);
      const owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });

      const { status } = await request({
        method: 'PUT',
        url: LICENCE_URL,
        user: owner,
        payload: { licenseNumber: nextLicence() },
      });

      expect(status).toBe(403);
    });

    it('requires a signed-in caller', async () => {
      const { status } = await request({
        method: 'PUT',
        url: LICENCE_URL,
        payload: { licenseNumber: nextLicence() },
      });

      expect(status).toBe(401);
    });
  });

  describe('joining a fleet without a licence', () => {
    it('is not mistaken for a licence clash with another licence-less driver', async () => {
      const fleet = await staffedFleet();
      // Already in the fleet, also without a licence.
      const employed = await registerDriver({ fleetInviteCode: fleet.inviteCode });
      expect(employed.status).toBe(201);

      const solo = await registerDriver();
      const joined = await request<Registration>({
        method: 'POST',
        url: '/api/v1/drivers/me/fleet',
        headers: { authorization: `Bearer ${solo.body.data.accessToken}` },
        payload: { fleetInviteCode: fleet.inviteCode },
      });

      expect(joined.status).toBe(200);
      expect(joined.body.data.session.organization?.id).toBe(fleet.id);
    });
  });
});
