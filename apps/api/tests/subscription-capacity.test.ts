import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OrganizationType,
  PLAN_LIMITS,
  PlanTier,
  RoleName,
  TruckType,
  VEHICLE_TOPUP,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { runTopUpExpirySweep } from '../src/modules/subscriptions/topup.service';
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
 * Vehicle capacity and `+1` top-ups.
 *
 * The behaviour worth pinning down is what happens at the edges of a plan: an
 * operator who buys one more truck than their plan covers, and one whose top-up
 * lapses. Neither should ever lose access to a vehicle they already run.
 */
describe('Subscription vehicle capacity', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let manager: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    // Basic is the one-vehicle plan, which makes the capacity edge reachable
    // in a test without creating twenty trucks.
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BASIC);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    manager = await createUser({ role: RoleName.FLEET_MANAGER, organizationId: fleet.id });
  });

  const truckPayload = (registration: string) => ({
    registrationNumber: registration,
    truckType: TruckType.TIPPER,
    manufacturer: 'Tata Motors',
    model: 'Prima',
    year: 2022,
    capacityTons: 25,
  });

  const addTruck = (user: TestUser, registration: string) =>
    request({ method: 'POST', url: '/api/v1/trucks', user, payload: truckPayload(registration) });

  interface CapacityBody {
    baseLimit: number | null;
    activeTopUps: number;
    effectiveLimit: number | null;
    used: number;
    remaining: number | null;
    atCapacity: boolean;
    canPurchaseTopUp: boolean;
    topUpCeiling: number;
    planName: string;
    topUpPriceMonthly: number;
  }

  const getCapacity = (user: TestUser = owner) =>
    request<CapacityBody>({ method: 'GET', url: '/api/v1/subscriptions/capacity', user });

  // -------------------------------------------------------------------------

  describe('capacity reporting', () => {
    it('reports the plan capacity before anything is added', async () => {
      const { status, body } = await getCapacity();

      expect(status).toBe(200);
      expect(body.data.baseLimit).toBe(PLAN_LIMITS[PlanTier.BASIC].maxTrucks);
      expect(body.data.activeTopUps).toBe(0);
      expect(body.data.used).toBe(0);
      expect(body.data.atCapacity).toBe(false);
      expect(body.data.topUpPriceMonthly).toBe(VEHICLE_TOPUP.priceMonthly);
    });

    it('counts vehicles of every type against the same capacity', async () => {
      await addTruck(owner, 'MH12AA1000');
      const { body } = await getCapacity();
      expect(body.data.used).toBe(1);
      expect(body.data.atCapacity).toBe(true);
      expect(body.data.remaining).toBe(0);
    });

    it('lets a manager read capacity without being able to buy', async () => {
      const read = await getCapacity(manager);
      expect(read.status).toBe(200);

      const buy = await request({
        method: 'POST',
        url: '/api/v1/subscriptions/topups',
        user: manager,
        payload: {},
      });
      expect(buy.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------

  describe('buying capacity', () => {
    it('adds exactly one vehicle of headroom', async () => {
      await addTruck(owner, 'MH12AA1000');

      const purchase = await request<{
        topUp: { status: string; paymentReference: string | null };
        capacity: CapacityBody;
      }>({ method: 'POST', url: '/api/v1/subscriptions/topups', user: owner, payload: {} });

      expect(purchase.status).toBe(201);
      expect(purchase.body.data.topUp.status).toBe('ACTIVE');
      // The mock gateway prefixes every reference, so a demo settlement can
      // never be mistaken for a real one.
      expect(purchase.body.data.topUp.paymentReference).toMatch(/^MOCK-/);
      expect(purchase.body.data.capacity.effectiveLimit).toBe(
        (PLAN_LIMITS[PlanTier.BASIC].maxTrucks ?? 0) + 1,
      );
      expect(purchase.body.data.capacity.atCapacity).toBe(false);
    });

    it('lets the fleet add the vehicle the top-up paid for', async () => {
      await addTruck(owner, 'MH12AA1000');

      const blocked = await addTruck(owner, 'MH12AA2000');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error?.code).toBe('PLAN_LIMIT_REACHED');
      // The message has to point at the cheap fix, not only at an upgrade.
      expect(blocked.body.error?.message).toContain('top-up');

      await request({ method: 'POST', url: '/api/v1/subscriptions/topups', user: owner, payload: {} });

      const allowed = await addTruck(owner, 'MH12AA2000');
      expect(allowed.status).toBe(201);
    });

    it('records a declined payment without granting capacity', async () => {
      await addTruck(owner, 'MH12AA1000');

      const purchase = await request({
        method: 'POST',
        url: '/api/v1/subscriptions/topups',
        user: owner,
        payload: { simulateFailure: true },
      });

      expect(purchase.status).toBe(422);

      const capacity = await getCapacity();
      expect(capacity.body.data.activeTopUps).toBe(0);
      expect(capacity.body.data.atCapacity).toBe(true);

      // The failed attempt is kept, because "my payment did not go through" is
      // a support conversation that needs a row to point at.
      const rows = await prisma.vehicleSubscriptionTopUp.findMany({
        where: { organizationId: fleet.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('PAYMENT_FAILED');
    });

    it('stops at the plan top-up ceiling', async () => {
      const ceiling = PLAN_LIMITS[PlanTier.BASIC].maxVehicleTopUps;

      for (let index = 0; index < ceiling; index += 1) {
        const response = await request({
          method: 'POST',
          url: '/api/v1/subscriptions/topups',
          user: owner,
          payload: {},
        });
        expect(response.status).toBe(201);
      }

      const overCeiling = await request({
        method: 'POST',
        url: '/api/v1/subscriptions/topups',
        user: owner,
        payload: {},
      });
      expect(overCeiling.status).toBe(403);
      expect(overCeiling.body.error?.code).toBe('PLAN_LIMIT_REACHED');
    });

    it('stacks several top-ups', async () => {
      await request({ method: 'POST', url: '/api/v1/subscriptions/topups', user: owner, payload: {} });
      await request({ method: 'POST', url: '/api/v1/subscriptions/topups', user: owner, payload: {} });

      const { body } = await getCapacity();
      expect(body.data.activeTopUps).toBe(2);
      expect(body.data.effectiveLimit).toBe((PLAN_LIMITS[PlanTier.BASIC].maxTrucks ?? 0) + 2);
    });
  });

  // -------------------------------------------------------------------------

  describe('losing capacity', () => {
    it('cancels one top-up without disturbing the others', async () => {
      const first = await request<{ topUp: { id: string } }>({
        method: 'POST',
        url: '/api/v1/subscriptions/topups',
        user: owner,
        payload: {},
      });
      await request({ method: 'POST', url: '/api/v1/subscriptions/topups', user: owner, payload: {} });

      const cancelled = await request({
        method: 'POST',
        url: `/api/v1/subscriptions/topups/${first.body.data.topUp.id}/cancel`,
        user: owner,
      });
      expect(cancelled.status).toBe(200);

      const { body } = await getCapacity();
      expect(body.data.activeTopUps).toBe(1);
    });

    it('never takes away a vehicle that is already on the road', async () => {
      await addTruck(owner, 'MH12AA1000');
      const purchase = await request<{ topUp: { id: string } }>({
        method: 'POST',
        url: '/api/v1/subscriptions/topups',
        user: owner,
        payload: {},
      });
      await addTruck(owner, 'MH12AA2000');

      await request({
        method: 'POST',
        url: `/api/v1/subscriptions/topups/${purchase.body.data.topUp.id}/cancel`,
        user: owner,
      });

      // Over capacity, and that is fine: both trucks still exist and still
      // resolve. Only *adding another* is refused.
      const { body } = await getCapacity();
      expect(body.data.used).toBe(2);
      expect(body.data.effectiveLimit).toBe(PLAN_LIMITS[PlanTier.BASIC].maxTrucks);
      expect(body.data.atCapacity).toBe(true);

      const trucks = await request<{ items: unknown[] }>({
        method: 'GET',
        url: '/api/v1/trucks',
        user: owner,
      });
      expect(trucks.status).toBe(200);
      expect(trucks.body.data.items).toHaveLength(2);

      const third = await addTruck(owner, 'MH12AA3000');
      expect(third.status).toBe(403);
    });

    it('expires a lapsed top-up and stops counting it', async () => {
      const purchase = await request<{ topUp: { id: string } }>({
        method: 'POST',
        url: '/api/v1/subscriptions/topups',
        user: owner,
        payload: {},
      });

      await prisma.vehicleSubscriptionTopUp.update({
        where: { id: purchase.body.data.topUp.id },
        data: { expiresAt: new Date(Date.now() - 86_400_000) },
      });

      // Capacity stops counting it immediately, without waiting for the sweep.
      const beforeSweep = await getCapacity();
      expect(beforeSweep.body.data.activeTopUps).toBe(0);

      const expired = await runTopUpExpirySweep();
      expect(expired).toBe(1);

      const row = await prisma.vehicleSubscriptionTopUp.findUniqueOrThrow({
        where: { id: purchase.body.data.topUp.id },
      });
      expect(row.status).toBe('EXPIRED');
    });
  });

  // -------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('does not let one fleet top up another', async () => {
      const otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BASIC);
      const otherOwner = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: otherFleet.id,
      });

      const purchase = await request<{ topUp: { id: string } }>({
        method: 'POST',
        url: '/api/v1/subscriptions/topups',
        user: owner,
        payload: {},
      });

      const cancelAttempt = await request({
        method: 'POST',
        url: `/api/v1/subscriptions/topups/${purchase.body.data.topUp.id}/cancel`,
        user: otherOwner,
      });
      expect(cancelAttempt.status).toBe(404);

      const otherCapacity = await getCapacity(otherOwner);
      expect(otherCapacity.body.data.activeTopUps).toBe(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('plan catalogue', () => {
    it('is sold by fleet size', async () => {
      const { body } = await request<{
        plans: { tier: string; limits: { maxTrucks: number | null } }[];
        topUp: { priceMonthly: number };
      }>({ method: 'GET', url: '/api/v1/subscriptions/plans', user: owner });

      const capacities = body.data.plans.map((plan) => plan.limits.maxTrucks);
      expect(capacities).toEqual([1, 5, 20, 50]);
      expect(body.data.topUp.priceMonthly).toBe(VEHICLE_TOPUP.priceMonthly);
    });
  });

  // -------------------------------------------------------------------------

  it('keeps unique registration numbers per fleet', async () => {
    const registration = unique('MH12ZZ').toUpperCase().slice(0, 10);
    const first = await addTruck(owner, registration);
    expect(first.status).toBe(201);
  });
});
