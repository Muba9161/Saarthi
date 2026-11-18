import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, PlanTier, RoleName, SubscriptionStatus } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { invalidateEntitlements } from '../src/modules/subscriptions/entitlements.service';
import { runSubscriptionLifecycleSweep } from '../src/modules/subscriptions/autopay.service';
import { remindFreeMonthsEnding } from '../src/modules/subscriptions/coupon.service';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * The two hard-coded coupons: SAARTHIFREE grants three free months at once,
 * WELCOME50 halves the next three plan charges. Payments run on the mock
 * gateway; the Business plan is ₹239 a month.
 */

const DAY = 86_400_000;
const PERIOD = 30 * DAY;
const COUPON_SPAN = 3 * PERIOD;

interface CouponView {
  code: string;
  percentOff: number;
  monthsLeft: number | null;
  freeUntil: string | null;
}

interface BillingView {
  status: string;
  monthlyTotal: number;
  regularMonthlyTotal: number;
  coupon: CouponView | null;
  couponLockedUntil: string | null;
  autopay: { status: string } | null;
}

describe('subscription coupons', () => {
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
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS, {
      vehicleTopUps: 0,
    });
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
  });

  const redeem = (code: string, user: TestUser = owner) =>
    request<BillingView>({
      method: 'POST',
      url: '/api/v1/subscriptions/billing/coupon',
      user,
      payload: { code },
    });

  const subscriptionOf = (organizationId = fleet.id) =>
    prisma.subscription.findUniqueOrThrow({ where: { organizationId } });

  async function setPeriod(status: SubscriptionStatus, endsInMs: number): Promise<Date> {
    const endsAt = new Date(Date.now() + endsInMs);
    await prisma.subscription.update({
      where: { organizationId: fleet.id },
      data: { status, endsAt },
    });
    invalidateEntitlements(fleet.id);
    return endsAt;
  }

  /** As if the last coupon was entered just over three months ago. */
  const passLock = () =>
    prisma.subscription.update({
      where: { organizationId: fleet.id },
      data: { couponAppliedAt: new Date(Date.now() - COUPON_SPAN - DAY) },
    });

  const payNow = () =>
    request({ method: 'POST', url: '/api/v1/subscriptions/billing/pay', user: owner });

  async function planCharges(): Promise<number[]> {
    const payments = await prisma.payment.findMany({
      where: { organizationId: fleet.id, reference: { startsWith: 'PLAN-' } },
      orderBy: { createdAt: 'asc' },
    });
    return payments.map((payment) => Number(payment.amount));
  }

  describe('checking the code', () => {
    it('refuses an unknown code and changes nothing', async () => {
      const before = await subscriptionOf();
      const { status, body } = await redeem('FREEMONEY');

      expect(status).toBe(422);
      expect(body.error?.message).toContain('not valid');
      const after = await subscriptionOf();
      expect(after.endsAt?.getTime()).toBe(before.endsAt?.getTime());
      expect(after.couponCode).toBeNull();
    });

    it('refuses an empty code', async () => {
      expect((await redeem('   ')).status).toBe(400);
    });

    it('only lets an owner apply one', async () => {
      const manager = await createUser({ role: RoleName.FLEET_MANAGER, organizationId: fleet.id });
      expect((await redeem('SAARTHIFREE', manager)).status).toBe(403);
    });

    it('has nothing to take off Saarthi Free', async () => {
      const household = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.FREE);
      const person = await createUser({ role: RoleName.FLEET_OWNER, organizationId: household.id });
      const { status, body } = await redeem('WELCOME50', person);
      expect(status).toBe(422);
      expect(body.error?.message).toContain('Saarthi Free');
    });
  });

  describe('SAARTHIFREE', () => {
    it('adds three free months after the trial, whatever the case or spacing', async () => {
      const trialEnd = await setPeriod(SubscriptionStatus.TRIALING, 10 * DAY);

      const { status, body } = await redeem(' saarthi free ');
      expect(status).toBe(200);
      expect(body.data.coupon).toMatchObject({
        code: 'SAARTHIFREE',
        percentOff: 100,
        monthsLeft: null,
      });

      const subscription = await subscriptionOf();
      expect(subscription.status).toBe(SubscriptionStatus.ACTIVE);
      expect(subscription.endsAt?.getTime()).toBe(trialEnd.getTime() + COUPON_SPAN);
      expect(subscription.couponFreeUntil?.getTime()).toBe(trialEnd.getTime() + COUPON_SPAN);
      // Nothing is charged for free months.
      expect(await prisma.payment.count({ where: { organizationId: fleet.id } })).toBe(0);
    });

    it('locks both codes for three months once one is entered', async () => {
      await setPeriod(SubscriptionStatus.ACTIVE, -DAY);
      const applied = await redeem('SAARTHIFREE');
      const lockedFor = Date.parse(applied.body.data.couponLockedUntil!) - Date.now();
      expect(lockedFor).toBeGreaterThan(COUPON_SPAN - DAY);
      expect(lockedFor).toBeLessThanOrEqual(COUPON_SPAN);
      const endsAt = (await subscriptionOf()).endsAt!.getTime();

      for (const code of ['SAARTHIFREE', 'WELCOME50']) {
        const again = await redeem(code);
        expect(again.status).toBe(422);
        expect(again.body.error?.message).toContain('You can enter another one after');
      }
      expect((await subscriptionOf()).endsAt!.getTime()).toBe(endsAt);
    });

    it('tops up to three months once the lock has passed, never stacking', async () => {
      // Entered during a trial over three months ago: a month of free time is still left.
      await setPeriod(SubscriptionStatus.ACTIVE, PERIOD);
      await prisma.subscription.update({
        where: { organizationId: fleet.id },
        data: {
          couponCode: 'SAARTHIFREE',
          couponPercentOff: 100,
          couponFreeUntil: new Date(Date.now() + PERIOD),
        },
      });
      await passLock();

      expect((await redeem('SAARTHIFREE')).status).toBe(200);
      const topped = (await subscriptionOf()).endsAt!.getTime() - Date.now();
      expect(topped).toBeGreaterThan(COUPON_SPAN - DAY);
      expect(topped).toBeLessThanOrEqual(COUPON_SPAN);
    });

    it('unlocks an archived account from the expired screen', async () => {
      await setPeriod(SubscriptionStatus.TRIALING, -4 * DAY);
      await runSubscriptionLifecycleSweep();
      const archived = await prisma.organization.findUniqueOrThrow({ where: { id: fleet.id } });
      expect(archived.billingArchivedAt).not.toBeNull();

      const { status } = await redeem('SAARTHIFREE');
      expect(status).toBe(200);

      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: fleet.id } });
      expect(organization.billingArchivedAt).toBeNull();
      expect(organization.dataPurgeAt).toBeNull();
      const subscription = await subscriptionOf();
      expect(subscription.status).toBe(SubscriptionStatus.ACTIVE);
      expect(subscription.endsAt!.getTime()).toBeGreaterThan(Date.now() + COUPON_SPAN - DAY);
    });

    it('stops autopay, which would otherwise charge during the free months', async () => {
      await request({ method: 'POST', url: '/api/v1/subscriptions/billing/autopay', user: owner });
      expect((await subscriptionOf()).autopayStatus).toBe('ACTIVE');

      const { body } = await redeem('SAARTHIFREE');
      expect(body.data.autopay?.status).toBe('CANCELLED');
    });

    it('shows in the billing history', async () => {
      await redeem('SAARTHIFREE');
      const { body } = await request<{ entries: { title: string; detail: string | null }[] }>({
        method: 'GET',
        url: '/api/v1/subscriptions/billing/history',
        user: owner,
      });
      const entry = body.data.entries.find((row) => row.title === 'Coupon SAARTHIFREE applied');
      expect(entry?.detail).toMatch(/^Free until /);
    });

    it('warns three days before the free months end, once', async () => {
      const endsAt = await setPeriod(SubscriptionStatus.ACTIVE, 2 * DAY);
      await prisma.subscription.update({
        where: { organizationId: fleet.id },
        data: { couponCode: 'SAARTHIFREE', couponPercentOff: 100, couponFreeUntil: endsAt },
      });

      expect(await remindFreeMonthsEnding()).toBe(1);
      expect(await remindFreeMonthsEnding()).toBe(0);
    });
  });

  describe('WELCOME50', () => {
    it('halves the next three plan charges, then returns to the full price', async () => {
      await setPeriod(SubscriptionStatus.ACTIVE, -DAY);

      const { status, body } = await redeem('welcome50');
      expect(status).toBe(200);
      expect(body.data.monthlyTotal).toBe(119.5);
      expect(body.data.regularMonthlyTotal).toBe(239);
      expect(body.data.coupon).toMatchObject({ code: 'WELCOME50', percentOff: 50, monthsLeft: 3 });

      for (let month = 0; month < 4; month += 1) {
        expect((await payNow()).status).toBe(200);
      }
      expect(await planCharges()).toEqual([119.5, 119.5, 119.5, 239]);

      const billing = await request<BillingView>({
        method: 'GET',
        url: '/api/v1/subscriptions/billing',
        user: owner,
      });
      expect(billing.body.data.coupon).toBeNull();
      expect(billing.body.data.monthlyTotal).toBe(239);
    });

    it('tops back up to three discounted months once the lock has passed', async () => {
      await redeem('WELCOME50');
      await payNow();
      expect((await subscriptionOf()).couponMonthsLeft).toBe(2);
      expect((await redeem('WELCOME50')).status).toBe(422);

      await passLock();
      expect((await redeem('WELCOME50')).status).toBe(200);
      expect((await subscriptionOf()).couponMonthsLeft).toBe(3);
    });

    it('lowers what autopay takes', async () => {
      await request({ method: 'POST', url: '/api/v1/subscriptions/billing/autopay', user: owner });
      await redeem('WELCOME50');
      await setPeriod(SubscriptionStatus.ACTIVE, -DAY);

      expect((await runSubscriptionLifecycleSweep()).renewed).toBe(1);
      const charge = await prisma.payment.findFirstOrThrow({
        where: { organizationId: fleet.id, reference: { startsWith: 'AUTOPAY-' } },
      });
      expect(Number(charge.amount)).toBe(119.5);
      expect((await subscriptionOf()).couponMonthsLeft).toBe(2);
    });

    it('lowers the price of renewing an archived account', async () => {
      await setPeriod(SubscriptionStatus.TRIALING, -4 * DAY);
      await runSubscriptionLifecycleSweep();

      const { status, body } = await redeem('WELCOME50');
      expect(status).toBe(200);
      expect(body.data.monthlyTotal).toBe(119.5);

      // Still locked until the discounted month is paid.
      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: fleet.id } });
      expect(organization.billingArchivedAt).not.toBeNull();
      expect((await payNow()).status).toBe(200);
      expect(await planCharges()).toEqual([119.5]);
    });

    it('is refused while SAARTHIFREE months are still running, even after the lock', async () => {
      await redeem('SAARTHIFREE');
      await passLock();
      const { status, body } = await redeem('WELCOME50');
      expect(status).toBe(422);
      expect(body.error?.message).toContain('SAARTHIFREE already makes your plan free');
    });

    it('gives way to SAARTHIFREE once the lock has passed', async () => {
      await redeem('WELCOME50');
      await passLock();
      expect((await redeem('SAARTHIFREE')).status).toBe(200);
      const subscription = await subscriptionOf();
      expect(subscription.couponCode).toBe('SAARTHIFREE');
      expect(subscription.couponMonthsLeft).toBe(0);
    });
  });
});
