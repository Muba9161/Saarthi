import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MembershipStatus, OrganizationType, PlanTier, RoleName } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  type SessionPayload,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * A driver's life across fleets: joining with a code, being removed, and
 * joining the next one — with their history intact throughout.
 */

describe('fleet membership', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let driver: TestUser;

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
    driver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
  });

  describe('the joining code', () => {
    it('shows the owner their code and lets them issue a new one', async () => {
      const current = await request<{ inviteCode: string }>({
        method: 'GET',
        url: '/api/v1/organizations/current/invite-code',
        user: owner,
      });
      expect(current.status).toBe(200);
      expect(current.body.data.inviteCode).toBe(fleet.inviteCode);

      const regenerated = await request<{ inviteCode: string }>({
        method: 'POST',
        url: '/api/v1/organizations/current/invite-code/regenerate',
        user: owner,
      });
      expect(regenerated.status).toBe(200);
      expect(regenerated.body.data.inviteCode).toMatch(/^SR-[A-Z0-9]{6}$/);
      expect(regenerated.body.data.inviteCode).not.toBe(fleet.inviteCode);
    });

    it('keeps the code from a driver', async () => {
      const { status } = await request({
        method: 'GET',
        url: '/api/v1/organizations/current/invite-code',
        user: driver,
      });
      expect(status).toBe(403);
    });
  });

  describe('removing a driver', () => {
    it('releases them without deleting them, available for work', async () => {
      const released = await request({
        method: 'DELETE',
        url: `/api/v1/drivers/${driver.driverId}`,
        user: owner,
      });
      expect(released.status).toBe(200);

      const row = await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId! } });
      // The same driver record — history keyed to it stays theirs.
      expect(row.archivedAt).toBeNull();
      expect(row.availability).toBe('AVAILABLE');
      expect(row.organizationId).not.toBe(fleet.id);

      // The fleet keeps the record that they worked there.
      const membership = await prisma.membership.findUniqueOrThrow({
        where: { userId_organizationId: { userId: driver.id, organizationId: fleet.id } },
      });
      expect(membership.status).toBe(MembershipStatus.REMOVED);

      // The driver can still use their account, and is asked for a code.
      const me = await request<SessionPayload>({ method: 'GET', url: '/api/v1/auth/me', user: driver });
      expect(me.status).toBe(200);
      expect(me.body.data.driver?.awaitingFleet).toBe(true);
      expect(me.body.data.organization?.isPersonalSeat).toBe(true);

      // And the fleet no longer sees them.
      const list = await request<{ items: { id: string }[] }>({
        method: 'GET',
        url: '/api/v1/drivers',
        user: owner,
      });
      expect(list.body.data.items.map((item) => item.id)).not.toContain(driver.driverId);
    });

    it('lets a released driver join the next fleet with its code', async () => {
      await request({ method: 'DELETE', url: `/api/v1/drivers/${driver.driverId}`, user: owner });

      const next = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
      await createUser({ role: RoleName.FLEET_OWNER, organizationId: next.id });

      const joined = await request<{ session: SessionPayload }>({
        method: 'POST',
        url: '/api/v1/drivers/me/fleet',
        user: driver,
        payload: { fleetInviteCode: next.inviteCode },
      });
      expect(joined.status).toBe(200);
      expect(joined.body.data.session.organization?.id).toBe(next.id);
      expect(joined.body.data.session.driver?.awaitingFleet).toBe(false);

      const row = await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId! } });
      expect(row.organizationId).toBe(next.id);
    });

    it('refuses to join a driver to an organization nobody runs', async () => {
      await request({ method: 'DELETE', url: `/api/v1/drivers/${driver.driverId}`, user: owner });
      const empty = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);

      const { status } = await request({
        method: 'POST',
        url: '/api/v1/drivers/me/fleet',
        user: driver,
        payload: { fleetInviteCode: empty.inviteCode },
      });
      expect(status).toBe(400);
    });
  });
});
