import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrganizationType, RoleName, VerificationStatus } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  closeApp,
  createOrganization,
  createUser,
  request,
  resetDatabase,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Verification, including the demo-mode shortcuts.
 *
 * The shortcuts exist so a freshly registered organization can dispatch a trip
 * without a platform reviewer draining a queue nobody owns. They must still
 * respect tenant boundaries — a fleet approving another fleet's driver would be
 * a straightforward privilege escalation, so that is the case these tests care
 * about most.
 */

let fleet: TestOrganization;
let otherFleet: TestOrganization;
let owner: TestUser;
let otherOwner: TestUser;

async function createTruck(organizationId: string, status = VerificationStatus.PENDING) {
  return prisma.truck.create({
    data: {
      organizationId,
      registrationNumber: `DL01AB${Math.floor(1000 + Math.random() * 8999)}`,
      truckType: 'TIPPER',
      capacityTons: 25,
      fuelType: 'DIESEL',
      verificationStatus: status,
    },
  });
}

beforeAll(async () => {
  await resetDatabase();
  fleet = await createOrganization(OrganizationType.FLEET_OWNER);
  otherFleet = await createOrganization(OrganizationType.FLEET_OWNER);
  owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
  otherOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: otherFleet.id });
});

afterAll(async () => {
  await closeApp();
});

describe('Verification', () => {
  describe('demo direct verification', () => {
    it('verifies a truck without requiring documents first', async () => {
      const truck = await createTruck(fleet.id);

      const response = await request<{ status: string }>({
        method: 'POST',
        url: `/api/v1/verification/subject/truck/${truck.id}/demo-verify`,
        user: owner,
        payload: {},
      });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe(VerificationStatus.VERIFIED);

      // The subject itself must change, not just the case — trip assignment
      // reads the truck's own verificationStatus.
      const stored = await prisma.truck.findUniqueOrThrow({ where: { id: truck.id } });
      expect(stored.verificationStatus).toBe(VerificationStatus.VERIFIED);
    });

    it('records an audit trail that says no documents were reviewed', async () => {
      const truck = await createTruck(fleet.id);

      await request({
        method: 'POST',
        url: `/api/v1/verification/subject/truck/${truck.id}/demo-verify`,
        user: owner,
        payload: {},
      });

      const verificationCase = await prisma.verificationCase.findFirstOrThrow({
        where: { subjectId: truck.id },
        include: { events: true },
      });
      expect(verificationCase.events.some((event) => event.note?.includes('demo mode'))).toBe(true);
    });

    it('refuses to verify a truck belonging to another organization', async () => {
      const truck = await createTruck(otherFleet.id);

      const response = await request({
        method: 'POST',
        url: `/api/v1/verification/subject/truck/${truck.id}/demo-verify`,
        user: owner,
        payload: {},
      });

      // 404 rather than 403 so ids cannot be probed across tenants.
      expect(response.status).toBe(404);

      const stored = await prisma.truck.findUniqueOrThrow({ where: { id: truck.id } });
      expect(stored.verificationStatus).toBe(VerificationStatus.PENDING);
    });

    it('rejects a malformed identifier with a validation error, not a crash', async () => {
      const response = await request({
        method: 'POST',
        url: '/api/v1/verification/subject/truck/not-a-uuid/demo-verify',
        user: owner,
        payload: {},
      });

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unsupported subject type', async () => {
      const truck = await createTruck(fleet.id);

      const response = await request({
        method: 'POST',
        url: `/api/v1/verification/subject/spaceship/${truck.id}/demo-verify`,
        user: owner,
        payload: {},
      });

      expect(response.status).toBe(400);
    });

    it('is idempotent — verifying twice leaves the record verified', async () => {
      const truck = await createTruck(fleet.id);
      const url = `/api/v1/verification/subject/truck/${truck.id}/demo-verify`;

      const first = await request({ method: 'POST', url, user: owner, payload: {} });
      const second = await request({ method: 'POST', url, user: owner, payload: {} });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const cases = await prisma.verificationCase.count({ where: { subjectId: truck.id } });
      expect(cases).toBe(1);
    });
  });

  describe('self-approval of a submitted case', () => {
    it('refuses a case belonging to another organization', async () => {
      const truck = await createTruck(otherFleet.id);
      await request({
        method: 'POST',
        url: `/api/v1/verification/subject/truck/${truck.id}/demo-verify`,
        user: otherOwner,
        payload: {},
      });

      const verificationCase = await prisma.verificationCase.findFirstOrThrow({
        where: { subjectId: truck.id },
      });

      const response = await request({
        method: 'POST',
        url: `/api/v1/verification/${verificationCase.id}/self-approve`,
        user: owner,
        payload: {},
      });

      expect(response.status).toBe(404);
    });
  });

  describe('listing', () => {
    it('shows an organization only its own submissions', async () => {
      const mine = await createTruck(fleet.id);
      const theirs = await createTruck(otherFleet.id);

      for (const [truck, user] of [
        [mine, owner],
        [theirs, otherOwner],
      ] as const) {
        await request({
          method: 'POST',
          url: `/api/v1/verification/subject/truck/${truck.id}/demo-verify`,
          user,
          payload: {},
        });
      }

      const response = await request<{ items: { id: string }[] }>({
        method: 'GET',
        url: '/api/v1/verification?pageSize=100',
        user: owner,
      });

      expect(response.status).toBe(200);
      expect(response.body.data.items.length).toBeGreaterThan(0);

      const visible = await prisma.verificationCase.findMany({
        where: { id: { in: response.body.data.items.map((entry) => entry.id) } },
        select: { organizationId: true },
      });
      expect(visible.every((entry) => entry.organizationId === fleet.id)).toBe(true);
    });
  });
});
