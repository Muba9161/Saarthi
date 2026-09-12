import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GST_RATE,
  OrganizationType,
  PLAN_LIMITS,
  PlanTier,
  RoleName,
  TruckType,
  VEHICLE_TOPUP,
  VEHICLE_TRACKER,
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
  uniquePhone,
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
    // Personal is the one-vehicle plan, which makes the capacity edge reachable
    // in a test without creating twenty vehicles.
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    manager = await createUser({ role: RoleName.FLEET_MANAGER, organizationId: fleet.id });

    /*
     * Clear the Personal account-holder Aadhaar check.
     *
     * Every case in this file is about capacity — how many vehicles a plan
     * covers, what a top-up adds, what a lapse takes away. A Personal account
     * now meets an earlier and unrelated gate before any of that: its holder
     * confirms their own identity before a vehicle goes on the account. Left
     * unverified, every add below would fail on identity and the capacity rules
     * would silently go untested.
     */
    await prisma.user.update({
      where: { id: owner.id },
      data: { aadhaarVerifiedAt: new Date() },
    });
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
      expect(body.data.baseLimit).toBe(PLAN_LIMITS[PlanTier.PERSONAL].maxTrucks);
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
        (PLAN_LIMITS[PlanTier.PERSONAL].maxTrucks ?? 0) + 1,
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
      const ceiling = PLAN_LIMITS[PlanTier.PERSONAL].maxVehicleTopUps;

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
      expect(body.data.effectiveLimit).toBe((PLAN_LIMITS[PlanTier.PERSONAL].maxTrucks ?? 0) + 2);
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
      expect(body.data.effectiveLimit).toBe(PLAN_LIMITS[PlanTier.PERSONAL].maxTrucks);
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
      const otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
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
    it('sells three plans, and both paid ones start at one vehicle', async () => {
      const { body } = await request<{
        plans: { tier: string; limits: { maxTrucks: number | null } }[];
        topUp: { priceMonthly: number };
        tracker: { priceOneTime: number };
      }>({ method: 'GET', url: '/api/v1/subscriptions/plans', user: owner });

      expect(body.data.plans.map((plan) => plan.tier)).toEqual([
        PlanTier.FREE,
        PlanTier.PERSONAL,
        PlanTier.BUSINESS,
      ]);

      /*
       * Free covers no vehicle, and the two paid plans cover exactly one.
       *
       * That is the whole pricing model rather than an accident of the
       * catalogue: fleet size is bought per vehicle, so an upgrade is never the
       * answer to "I need room for another". A plan that bundled five would
       * make this test's own top-up cases unreachable on the entry plan.
       *
       * The zero is a different kind of number from the ones beside it. It is
       * not a smaller allowance but the absence of one — a Free account does
       * not operate a vehicle, so there is nothing for a plan to cover and
       * nowhere to fit a tracker.
       */
      expect(body.data.plans.map((plan) => plan.limits.maxTrucks)).toEqual([0, 1, 1]);

      expect(body.data.topUp.priceMonthly).toBe(VEHICLE_TOPUP.priceMonthly);
      // Charged once, so the tracker has no monthly figure to report at all.
      expect(body.data.tracker.priceOneTime).toBe(VEHICLE_TRACKER.priceOneTime);
    });
  });

  // -------------------------------------------------------------------------

  describe('the order taken at signup', () => {
    /**
     * Registering with a configuration priced on the pricing card.
     *
     * The failure this guards is quiet and expensive: somebody sets three
     * vehicles and two trackers, agrees to a total, and lands on a bare
     * one-vehicle plan with no hardware. Nothing errors, nothing looks broken,
     * and they have been sold something other than what they bought.
     */
    async function registerWithOrder(order: {
      planTier: PlanTier;
      planVehicles: number;
      planTrackers: number;
      planBilling?: 'monthly' | 'yearly';
    }): Promise<TestUser> {
      const email = `${unique('order').toLowerCase()}@saarthi.test`;
      const { status, body } = await request<{
        accessToken: string;
        session: { user: { id: string }; organization: { id: string } | null };
      }>({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Anil',
          lastName: 'Verma',
          email,
          phone: uniquePhone(),
          password: 'Monsoon2026road',
          role: RoleName.FLEET_OWNER,
          organizationName: unique('Verma Transport '),
          acceptedTerms: true,
          ...order,
        },
      });

      expect(status).toBe(201);
      const organizationId = body.data.session.organization?.id ?? null;
      expect(organizationId).toBeTruthy();

      return {
        id: body.data.session.user.id,
        email,
        organizationId,
        accessToken: body.data.accessToken,
      };
    }

    it('provisions the vehicles and trackers that were priced', async () => {
      const user = await registerWithOrder({
        planTier: PlanTier.BUSINESS,
        planVehicles: 3,
        planTrackers: 2,
      });
      const organizationId = user.organizationId as string;

      // Two top-ups, because the plan covers the first vehicle itself.
      expect(
        await prisma.vehicleSubscriptionTopUp.count({
          where: { organizationId, status: 'ACTIVE' },
        }),
      ).toBe(2);

      const trackers = await prisma.vehicleTracker.findMany({ where: { organizationId } });
      expect(trackers).toHaveLength(2);
      expect(trackers.every((tracker) => tracker.status === 'ACTIVE')).toBe(true);
      // Unfitted: there are no vehicles on the account yet.
      expect(trackers.every((tracker) => tracker.truckId === null)).toBe(true);

      // One charge for the whole order, not one per unit.
      expect(new Set(trackers.map((tracker) => tracker.paymentReference)).size).toBe(1);
    });

    it('grants the capacity it charged for, so all three vehicles can be added', async () => {
      const user = await registerWithOrder({
        planTier: PlanTier.BUSINESS,
        planVehicles: 3,
        planTrackers: 0,
      });

      for (let index = 0; index < 3; index += 1) {
        const created = await addTruck(user, `MH14OR${1000 + index}`);
        expect(created.status, `vehicle ${index + 1} of the three that were paid for`).toBe(201);
      }

      // The fourth is beyond what was bought.
      const fourth = await addTruck(user, 'MH14OR9999');
      expect(fourth.status).toBe(403);
      expect(fourth.body.error?.code).toBe('PLAN_LIMIT_REACHED');
    });

    it('takes nothing extra when the order is just the plan', async () => {
      const user = await registerWithOrder({
        planTier: PlanTier.PERSONAL,
        planVehicles: 1,
        planTrackers: 0,
      });
      const organizationId = user.organizationId as string;

      expect(await prisma.vehicleSubscriptionTopUp.count({ where: { organizationId } })).toBe(0);
      expect(await prisma.vehicleTracker.count({ where: { organizationId } })).toBe(0);
    });

    it('clamps an order to what the plan can hold rather than failing the signup', async () => {
      /*
       * Personal cannot hold a hundred vehicles. The pricing card disables its
       * own Subscribe button in that case, so reaching here means a hand-edited
       * link — and the useful outcome is an account with the capacity the plan
       * allows, not a rejected registration.
       */
      const user = await registerWithOrder({
        planTier: PlanTier.PERSONAL,
        planVehicles: 100,
        planTrackers: 100,
      });
      const organizationId = user.organizationId as string;

      expect(
        await prisma.vehicleSubscriptionTopUp.count({
          where: { organizationId, status: 'ACTIVE' },
        }),
      ).toBe(PLAN_LIMITS[PlanTier.PERSONAL].maxVehicleTopUps);
    });

    it('holds a Personal customer’s trackers until their Aadhaar is verified', async () => {
      /*
       * A Personal subscription asks the person for their own Aadhaar before
       * hardware goes on the account, and signup is the one path that would
       * otherwise slip past it: these trackers are provisioned seconds after
       * registration, when nobody has had the chance to verify anything.
       *
       * Held rather than refused. The registration succeeds, the vehicle
       * capacity is provisioned as normal, and the customer is not charged for
       * hardware they cannot yet fit — which is a better outcome than a charge
       * followed by a refund.
       */
      const user = await registerWithOrder({
        planTier: PlanTier.PERSONAL,
        planVehicles: 3,
        planTrackers: 2,
      });
      const organizationId = user.organizationId as string;

      expect(await prisma.vehicleTracker.count({ where: { organizationId } })).toBe(0);

      // The capacity they priced still arrives — only the hardware waits.
      expect(
        await prisma.vehicleSubscriptionTopUp.count({
          where: { organizationId, status: 'ACTIVE' },
        }),
      ).toBe(2);
    });

    it('provisions a Business customer’s trackers at signup as before', async () => {
      // The Personal rule is about a person verifying themselves, so it must
      // not have leaked into the plan every business buys. This is the same
      // assertion as the first case in this block, kept as its own test so a
      // regression names the tier it broke.
      const user = await registerWithOrder({
        planTier: PlanTier.BUSINESS,
        planVehicles: 2,
        planTrackers: 2,
      });
      const organizationId = user.organizationId as string;

      expect(
        await prisma.vehicleTracker.count({ where: { organizationId, status: 'ACTIVE' } }),
      ).toBe(2);
    });

    it('charges the GST-inclusive total, not the catalogue price', async () => {
      /*
       * The money assertion.
       *
       * Two vehicles and one tracker on Business is one top-up at 75 and one
       * tracker at 499 — 574 before tax, 677.32 with GST at 18%. Charging 574
       * would mean Saarthi absorbing the tax on every order, which is the kind
       * of bug that is invisible on screen and expensive at the year end.
       *
       * Asserted through the audit row rather than the mock gateway, because
       * the audit row is what a reconciliation would actually be read against.
       */
      const user = await registerWithOrder({
        planTier: PlanTier.BUSINESS,
        planVehicles: 2,
        planTrackers: 1,
      });

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: {
          organizationId: user.organizationId as string,
          action: 'subscription.signup_order',
        },
      });

      const after = entry.afterData as unknown as { subtotal: number; gst: number; charged: number };

      // The plan itself is on trial, so only the add-ons are charged.
      expect(after.subtotal).toBe(VEHICLE_TOPUP.priceMonthly + VEHICLE_TRACKER.priceOneTime);
      expect(after.gst).toBeCloseTo(after.subtotal * GST_RATE, 2);
      expect(after.charged).toBeCloseTo(after.subtotal * (1 + GST_RATE), 2);
      // And it is a definite amount of money, not a float.
      expect(Math.round(after.charged * 100)).toBe(after.charged * 100);
    });

    it('reports the plan cost with GST separated out', async () => {
      const user = await registerWithOrder({
        planTier: PlanTier.BUSINESS,
        planVehicles: 3,
        planTrackers: 0,
      });

      const { status, body } = await request<{
        monthlySubtotal: number;
        monthlyGst: number;
        monthlyTotal: number;
        gstRate: number;
      }>({ method: 'GET', url: '/api/v1/subscriptions/plan', user });

      expect(status).toBe(200);
      // The plan plus two top-ups, before tax.
      expect(body.data.monthlySubtotal).toBe(199 + 2 * VEHICLE_TOPUP.priceMonthly);
      expect(body.data.gstRate).toBe(GST_RATE);
      expect(body.data.monthlyGst).toBeCloseTo(body.data.monthlySubtotal * GST_RATE, 2);
      expect(body.data.monthlyTotal).toBeCloseTo(
        body.data.monthlySubtotal + body.data.monthlyGst,
        2,
      );
    });

    it('refuses more trackers than vehicles', async () => {
      const { status, body } = await request({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          firstName: 'Anil',
          lastName: 'Verma',
          email: `${unique('order').toLowerCase()}@saarthi.test`,
          phone: uniquePhone(),
          password: 'Monsoon2026road',
          role: RoleName.FLEET_OWNER,
          organizationName: unique('Verma Transport '),
          planTier: PlanTier.BUSINESS,
          planVehicles: 2,
          planTrackers: 5,
          acceptedTerms: true,
        },
      });

      // A tracker is fitted to a vehicle, so five for two is not an order
      // anybody could actually receive.
      expect(status).toBe(400);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  it('taxes a top-up bought in-app the same way', async () => {
    const { status } = await request({
      method: 'POST',
      url: '/api/v1/subscriptions/topups',
      user: owner,
      payload: {},
    });
    expect(status).toBe(201);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: fleet.id, action: 'subscription.topup_purchased' },
    });
    const after = entry.afterData as unknown as { price: number; gst: number; charged: number };

    // The row keeps the pre-tax price — that is what the plan costs and what an
    // invoice itemises — while the charge is the taxed figure.
    expect(after.price).toBe(VEHICLE_TOPUP.priceMonthly);
    expect(after.charged).toBeCloseTo(VEHICLE_TOPUP.priceMonthly * (1 + GST_RATE), 2);
  });

  // -------------------------------------------------------------------------

  it('keeps unique registration numbers per fleet', async () => {
    const registration = unique('MH12ZZ').toUpperCase().slice(0, 10);
    const first = await addTruck(owner, registration);
    expect(first.status).toBe(201);
  });
});
