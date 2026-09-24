import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TRIAL_DAYS,
  Feature,
  OrganizationType,
  PlanTier,
  RoleName,
  SubscriptionStatus,
  VEHICLE_TOPUP,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { invalidateEntitlements } from '../src/modules/subscriptions/entitlements.service';
import { runSubscriptionLifecycleSweep } from '../src/modules/subscriptions/autopay.service';
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
 * The plan's billing: the 30-day trial, what ends it, autopay and paying now,
 * and the Cashfree webhook boundary. Payments run on the mock gateway here.
 */

const DAY = 86_400_000;

async function registerPersonal(): Promise<TestUser> {
  const email = `${unique('trial').toLowerCase()}@saarthi.test`;
  const { status, body } = await request<{
    accessToken: string;
    session: { user: { id: string }; organization: { id: string } | null };
  }>({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      firstName: 'Ravi',
      lastName: 'Kumar',
      email,
      phone: uniquePhone(),
      password: 'Monsoon2026road',
      planTier: PlanTier.PERSONAL,
      acceptedTerms: true,
    },
  });
  expect(status).toBe(201);
  return {
    id: body.data.session.user.id,
    email,
    organizationId: body.data.session.organization?.id ?? null,
    accessToken: body.data.accessToken,
  };
}

async function endPeriod(organizationId: string, status: SubscriptionStatus): Promise<void> {
  await prisma.subscription.update({
    where: { organizationId },
    data: { status, endsAt: new Date(Date.now() - DAY) },
  });
  invalidateEntitlements(organizationId);
}

describe('subscription billing', () => {
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

  describe('the 30-day trial', () => {
    it('starts every paid registration on a 30-day trial', async () => {
      const user = await registerPersonal();
      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { organizationId: user.organizationId! },
      });

      expect(DEFAULT_TRIAL_DAYS).toBe(30);
      expect(subscription.status).toBe(SubscriptionStatus.TRIALING);
      const days = (subscription.endsAt!.getTime() - subscription.startsAt.getTime()) / DAY;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);
    });

    it('reports the days left and the price that follows', async () => {
      const user = await registerPersonal();
      const { status, body } = await request<{
        trialDaysLeft: number | null;
        monthlyTotal: number;
        billable: boolean;
      }>({ method: 'GET', url: '/api/v1/subscriptions/billing', user });

      expect(status).toBe(200);
      expect(body.data.trialDaysLeft).toBe(30);
      expect(body.data.monthlyTotal).toBe(119);
      expect(body.data.billable).toBe(true);
    });

    it('ends an unpaid trial into three days of grace, with everything still working', async () => {
      await endPeriod(fleet.id, SubscriptionStatus.TRIALING);

      await runSubscriptionLifecycleSweep();

      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { organizationId: fleet.id },
      });
      // Archiving after the grace is covered in account-retention.test.ts.
      expect(subscription.status).toBe(SubscriptionStatus.PAST_DUE);

      const { body } = await request<{ subscription: { features: string[] } | null }>({
        method: 'GET',
        url: '/api/v1/auth/me',
        user: owner,
      });
      expect(body.data.subscription?.features).toContain(Feature.AI_COPILOT);
    });

    it('never lapses a Free account', async () => {
      const customer = await createOrganization(OrganizationType.CUSTOMER, PlanTier.FREE);
      await endPeriod(customer.id, SubscriptionStatus.ACTIVE);
      await runSubscriptionLifecycleSweep();
      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { organizationId: customer.id },
      });
      expect(subscription.status).toBe(SubscriptionStatus.ACTIVE);
    });
  });

  describe('autopay and paying now', () => {
    it('sets up autopay and renews the period when it ends', async () => {
      const setup = await request<{ status: { autopay: { status: string } | null } }>({
        method: 'POST',
        url: '/api/v1/subscriptions/billing/autopay',
        user: owner,
      });
      expect(setup.status).toBe(200);
      expect(setup.body.data.status.autopay?.status).toBe('ACTIVE');

      await endPeriod(fleet.id, SubscriptionStatus.TRIALING);
      const result = await runSubscriptionLifecycleSweep();
      expect(result.renewed).toBe(1);

      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { organizationId: fleet.id },
      });
      expect(subscription.status).toBe(SubscriptionStatus.ACTIVE);
      expect(subscription.endsAt!.getTime()).toBeGreaterThan(Date.now() + 28 * DAY);

      // Recorded once, at the monthly price, GST included.
      const charges = await prisma.payment.findMany({
        where: { organizationId: fleet.id, reference: { startsWith: 'AUTOPAY-' } },
      });
      expect(charges).toHaveLength(1);
      expect(Number(charges[0]!.amount)).toBe(239);

      // Running again charges nothing more.
      expect((await runSubscriptionLifecycleSweep()).renewed).toBe(0);
    });

    it('renews a lapsed subscription when a month is paid for', async () => {
      await endPeriod(fleet.id, SubscriptionStatus.EXPIRED);

      const { status } = await request({
        method: 'POST',
        url: '/api/v1/subscriptions/billing/pay',
        user: owner,
      });
      expect(status).toBe(200);

      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { organizationId: fleet.id },
      });
      expect(subscription.status).toBe(SubscriptionStatus.ACTIVE);
      expect(subscription.endsAt!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    });

    it('extends active top-ups with the plan period', async () => {
      await request({ method: 'POST', url: '/api/v1/subscriptions/topups', user: owner, payload: {} });
      await request({ method: 'POST', url: '/api/v1/subscriptions/billing/pay', user: owner });

      const [subscription, topUp] = await Promise.all([
        prisma.subscription.findUniqueOrThrow({ where: { organizationId: fleet.id } }),
        prisma.vehicleSubscriptionTopUp.findFirstOrThrow({
          where: { organizationId: fleet.id, status: 'ACTIVE', expiresAt: { not: null } },
        }),
      ]);
      expect(Number(topUp.priceMonthly)).toBe(VEHICLE_TOPUP.priceMonthly);
      expect(topUp.expiresAt?.getTime()).toBe(subscription.endsAt?.getTime());
    });

    it('starts the trial when a Free account moves onto a paid plan', async () => {
      const household = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.FREE);
      const person = await createUser({ role: RoleName.FLEET_OWNER, organizationId: household.id });

      const { status } = await request({
        method: 'POST',
        url: '/api/v1/subscriptions/plan',
        user: person,
        payload: { tier: PlanTier.PERSONAL },
      });
      expect(status).toBe(200);

      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { organizationId: household.id },
      });
      expect(subscription.status).toBe(SubscriptionStatus.TRIALING);
      expect(subscription.endsAt!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    });

    it('keeps a supplier on the Supplier plan', async () => {
      const supplier = await createOrganization(OrganizationType.SUPPLIER, PlanTier.SUPPLIER);
      const supplierOwner = await createUser({ role: RoleName.SUPPLIER, organizationId: supplier.id });

      const { status } = await request({
        method: 'POST',
        url: '/api/v1/subscriptions/plan',
        user: supplierOwner,
        payload: { tier: PlanTier.BUSINESS },
      });
      expect([403, 422]).toContain(status);
    });
  });

  describe('the Cashfree webhook', () => {
    const post = async (rawBody: string, headers: Record<string, string>) => {
      const app = await getApp();
      return app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/cashfree',
        payload: rawBody,
        headers: { 'content-type': 'application/json', ...headers },
      });
    };

    const signed = (rawBody: string) => {
      const timestamp = String(Date.now());
      const signature = createHmac('sha256', 'test-webhook-secret')
        .update(timestamp + rawBody)
        .digest('base64');
      return { 'x-webhook-timestamp': timestamp, 'x-webhook-signature': signature };
    };

    it('refuses a delivery with a bad signature', async () => {
      const rawBody = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: {} });
      const response = await post(rawBody, {
        'x-webhook-timestamp': String(Date.now()),
        'x-webhook-signature': 'forged',
      });
      expect(response.statusCode).toBe(401);
      expect(await prisma.paymentWebhookEvent.count()).toBe(0);
    });

    it('applies a delivery once, however often it arrives', async () => {
      const rawBody = JSON.stringify({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: { order: { order_id: 'NOT-A-SAARTHI-ORDER' } },
      });
      const headers = signed(rawBody);

      const first = await post(rawBody, headers);
      const second = await post(rawBody, headers);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().data.duplicate).toBe(true);
      expect(await prisma.paymentWebhookEvent.count()).toBe(1);
    });
  });
});
