import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DATA_PURGE_AFTER_DAYS,
  Feature,
  MembershipStatus,
  OrganizationType,
  PlanTier,
  RoleName,
  SubscriptionStatus,
  TruckType,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { invalidateEntitlements } from '../src/modules/subscriptions/entitlements.service';
import { runSubscriptionLifecycleSweep } from '../src/modules/subscriptions/autopay.service';
import { runAccountPurgeSweep } from '../src/modules/account-retention/account-purge.service';
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
 * An unpaid paid plan: three days' grace with a warning, then archived and
 * locked, then — 90 days on — the business's own data deleted. Renewing at
 * any point before that restores everything.
 */

const DAY = 86_400_000;

async function endPeriod(organizationId: string, daysAgo: number): Promise<void> {
  await prisma.subscription.update({
    where: { organizationId },
    data: { status: SubscriptionStatus.TRIALING, endsAt: new Date(Date.now() - daysAgo * DAY) },
  });
  invalidateEntitlements(organizationId);
}

async function addTruck(organizationId: string): Promise<string> {
  const truck = await prisma.truck.create({
    data: {
      organizationId,
      registrationNumber: unique('UP32AR').toUpperCase().slice(0, 12),
      truckType: TruckType.TIPPER,
      capacityTons: 25,
      odometerKm: 1000,
    },
  });
  return truck.id;
}

describe('unpaid account retention', () => {
  let fleet: TestOrganization;
  let owner: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS, { vehicleTopUps: 0 });
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
  });

  describe('the grace period', () => {
    it('warns once when a period ends unpaid, and keeps everything working', async () => {
      await endPeriod(fleet.id, 1);

      await runSubscriptionLifecycleSweep();
      await runSubscriptionLifecycleSweep();

      const subscription = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: fleet.id } });
      expect(subscription.status).toBe(SubscriptionStatus.PAST_DUE);

      const warnings = await prisma.notification.findMany({
        where: { organizationId: fleet.id, title: 'Renew now to keep your account' },
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.body).toContain('archived');
      expect(warnings[0]!.body).toContain(`${DATA_PURGE_AFTER_DAYS} days`);

      // Full access during the grace.
      const me = await request<{ subscription: { features: string[] } | null }>({
        method: 'GET',
        url: '/api/v1/auth/me',
        user: owner,
      });
      expect(me.body.data.subscription?.features).toContain(Feature.AI_COPILOT);
      const trucks = await request({ method: 'GET', url: '/api/v1/trucks', user: owner });
      expect(trucks.status).toBe(200);

      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: fleet.id } });
      expect(organization.billingArchivedAt).toBeNull();
    });
  });

  describe('archiving', () => {
    it('archives and locks the account three days after the period ended', async () => {
      await endPeriod(fleet.id, 4);
      const result = await runSubscriptionLifecycleSweep();
      expect(result.expired).toBe(1);

      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: fleet.id } });
      expect(organization.billingArchivedAt).not.toBeNull();
      const purgeInDays = (organization.dataPurgeAt!.getTime() - Date.now()) / DAY;
      expect(purgeInDays).toBeGreaterThan(DATA_PURGE_AFTER_DAYS - 0.1);
      expect(purgeInDays).toBeLessThan(DATA_PURGE_AFTER_DAYS + 0.1);

      const subscription = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: fleet.id } });
      expect(subscription.status).toBe(SubscriptionStatus.EXPIRED);

      // Locked: the product refuses, and says why.
      const trucks = await request<unknown>({ method: 'GET', url: '/api/v1/trucks', user: owner });
      expect(trucks.status).toBe(402);
      expect(JSON.stringify(trucks.body)).toContain('ACCOUNT_ARCHIVED');

      // What renews it is still open, and the session says it is archived.
      const me = await request<{ organization: { billingArchivedAt: string | null } | null }>({
        method: 'GET',
        url: '/api/v1/auth/me',
        user: owner,
      });
      expect(me.status).toBe(200);
      expect(me.body.data.organization?.billingArchivedAt).not.toBeNull();
      const billing = await request({ method: 'GET', url: '/api/v1/subscriptions/billing', user: owner });
      expect(billing.status).toBe(200);
    });

    it('archives an account whose trial ended, whatever the warning did', async () => {
      await endPeriod(fleet.id, 1);
      await runSubscriptionLifecycleSweep();
      await endPeriod(fleet.id, 5);
      await prisma.subscription.update({
        where: { organizationId: fleet.id },
        data: { status: SubscriptionStatus.PAST_DUE },
      });
      await runSubscriptionLifecycleSweep();

      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: fleet.id } });
      expect(organization.billingArchivedAt).not.toBeNull();
    });

    it('restores everything the moment a renewal is paid', async () => {
      await endPeriod(fleet.id, 4);
      await runSubscriptionLifecycleSweep();

      const pay = await request({ method: 'POST', url: '/api/v1/subscriptions/billing/pay', user: owner });
      expect(pay.status).toBe(200);

      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: fleet.id } });
      expect(organization.billingArchivedAt).toBeNull();
      expect(organization.dataPurgeAt).toBeNull();

      const subscription = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: fleet.id } });
      expect(subscription.status).toBe(SubscriptionStatus.ACTIVE);

      const trucks = await request({ method: 'GET', url: '/api/v1/trucks', user: owner });
      expect(trucks.status).toBe(200);
    });

    it('never archives a Free account', async () => {
      const customer = await createOrganization(OrganizationType.CUSTOMER, PlanTier.FREE);
      await prisma.subscription.update({
        where: { organizationId: customer.id },
        data: { status: SubscriptionStatus.ACTIVE, endsAt: new Date(Date.now() - 10 * DAY) },
      });
      await runSubscriptionLifecycleSweep();

      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: customer.id } });
      expect(organization.billingArchivedAt).toBeNull();
    });
  });

  describe('deleting the data', () => {
    async function archiveLongAgo(): Promise<void> {
      await prisma.organization.update({
        where: { id: fleet.id },
        data: {
          billingArchivedAt: new Date(Date.now() - (DATA_PURGE_AFTER_DAYS + 1) * DAY),
          dataPurgeAt: new Date(Date.now() - DAY),
        },
      });
      await prisma.subscription.update({
        where: { organizationId: fleet.id },
        data: { status: SubscriptionStatus.EXPIRED },
      });
    }

    it('deletes the business’s own data and keeps what others and the law need', async () => {
      const truckId = await addTruck(fleet.id);
      const driver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
      const payment = await prisma.payment.create({
        data: {
          reference: unique('PAY-KEEP'),
          organizationId: fleet.id,
          initiatedByUserId: owner.id,
          amount: 239,
          purpose: 'SUBSCRIPTION',
          status: 'SUCCEEDED',
          provider: 'mock',
        },
      });
      await archiveLongAgo();

      const result = await runAccountPurgeSweep();
      expect(result.purged).toBe(1);

      // Own data: gone.
      expect(await prisma.truck.findUnique({ where: { id: truckId } })).toBeNull();

      // The driver is released with their profile intact.
      const released = await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId! } });
      expect(released.organizationId).not.toBe(fleet.id);
      const seat = await prisma.organization.findUniqueOrThrow({ where: { id: released.organizationId } });
      expect(seat.isPersonalSeat).toBe(true);

      // Payments stay; the organization row stays, marked purged.
      expect(await prisma.payment.findUnique({ where: { id: payment.id } })).not.toBeNull();
      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: fleet.id } });
      expect(organization.dataPurgedAt).not.toBeNull();

      // Team access ended.
      const membership = await prisma.membership.findFirstOrThrow({
        where: { userId: owner.id, organizationId: fleet.id },
      });
      expect(membership.status).toBe(MembershipStatus.REMOVED);

      // Once only.
      expect((await runAccountPurgeSweep()).purged).toBe(0);
    });

    it('keeps a vehicle a customer’s order points at, archived', async () => {
      const truckId = await addTruck(fleet.id);
      const customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.FREE);
      const customer =
        (await prisma.customer.findUnique({ where: { organizationId: customerOrg.id } })) ??
        (await prisma.customer.create({ data: { organizationId: customerOrg.id } }));
      const route = {
        originAddress: 'Lucknow',
        originLatitude: 26.85,
        originLongitude: 80.95,
        destinationAddress: 'Kanpur',
        destinationLatitude: 26.45,
        destinationLongitude: 80.33,
      };
      const trip = await prisma.trip.create({
        data: { organizationId: fleet.id, truckId, reference: unique('TRP'), createdById: owner.id, ...route },
      });
      await prisma.order.create({
        data: {
          reference: unique('ORD'),
          customerId: customer.id,
          customerOrganizationId: customerOrg.id,
          fleetOrganizationId: fleet.id,
          materialName: 'Sand',
          quantity: 10,
          requiredCapacityTons: 10,
          createdById: owner.id,
          tripId: trip.id,
          ...route,
        },
      });
      await archiveLongAgo();

      await runAccountPurgeSweep();

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: truckId } });
      expect(truck.archivedAt).not.toBeNull();
      expect(await prisma.trip.findUnique({ where: { id: trip.id } })).not.toBeNull();
    });

    it('does nothing before the date, or once the account has renewed', async () => {
      const truckId = await addTruck(fleet.id);
      await prisma.organization.update({
        where: { id: fleet.id },
        data: { billingArchivedAt: new Date(), dataPurgeAt: new Date(Date.now() + 10 * DAY) },
      });
      expect((await runAccountPurgeSweep()).purged).toBe(0);

      await prisma.organization.update({
        where: { id: fleet.id },
        data: { dataPurgeAt: new Date(Date.now() - DAY) },
      });
      await prisma.subscription.update({
        where: { organizationId: fleet.id },
        data: { status: SubscriptionStatus.ACTIVE },
      });
      expect((await runAccountPurgeSweep()).purged).toBe(0);
      expect(await prisma.truck.findUnique({ where: { id: truckId } })).not.toBeNull();
    });
  });
});
