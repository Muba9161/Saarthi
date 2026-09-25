import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PaymentTrigger,
  OrganizationType,
  PlanTier,
  RoleName,
  UserReferralStatus,
  WalletEntryStatus,
  isReferralProgramCode,
  type ReferralProgramSummary,
  type WalletSummary,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { qualifyPayment } from '../src/modules/sales/qualification';
import {
  closeApp,
  createOrganization,
  createUser,
  request,
  resetDatabase,
  unique,
  uniquePhone,
  type TestUser,
} from './helpers';

/**
 * Refer & Earn — the generic referral program, and the wallet it pays into.
 *
 * Pinned here: ₹100 is credited the moment a referred account starts a paid
 * plan, with no payment and no approval; it is held, then released or voided
 * on its own; a Free signup earns nothing; a program code never creates a
 * salesman attribution; and a salesperson stays on their GODID channel.
 *
 * The test environment has no Cashfree Payouts keys, so cash-out and bank
 * connection are exercised only up to the point where they refuse to run.
 */

const PATH = '/api/v1/referral-program';
const WALLET = '/api/v1/wallet';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeApp();
});

async function referrer() {
  const organization = await createOrganization(OrganizationType.CUSTOMER, PlanTier.FREE);
  return createUser({ role: RoleName.CUSTOMER, organizationId: organization.id });
}

async function codeOf(user: TestUser): Promise<string> {
  const { body } = await request<ReferralProgramSummary>({ method: 'GET', url: `${PATH}/me`, user });
  return body.data.code;
}

async function registerWith(referralCode: string, planTier: PlanTier = PlanTier.BUSINESS) {
  const free = planTier === PlanTier.FREE;
  const { status, body } = await request<{ session: { organization: { id: string } | null } }>({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      firstName: 'Meera',
      lastName: 'Iyer',
      email: `${unique('referred').toLowerCase()}@saarthi.test`,
      phone: uniquePhone(),
      password: 'Monsoon2026road',
      role: free ? RoleName.CUSTOMER : RoleName.FLEET_OWNER,
      organizationName: unique('Iyer Logistics '),
      acceptedTerms: true,
      planTier,
      referralCode,
    },
  });
  expect(status).toBe(201);
  return body.data.session.organization?.id as string;
}

async function walletOf(user: TestUser): Promise<WalletSummary> {
  const { status, body } = await request<WalletSummary>({ method: 'GET', url: WALLET, user });
  expect(status).toBe(200);
  return body.data;
}

/** Move a held reward to the end of its hold, as time passing would. */
async function endHold(organizationId: string): Promise<void> {
  const referral = await prisma.userReferral.findUniqueOrThrow({ where: { organizationId } });
  await prisma.walletEntry.update({
    where: { userReferralId: referral.id },
    data: { availableAt: new Date(Date.now() - 1000) },
  });
}

describe('referral codes', () => {
  it('issues one code per person, on first request, whatever their plan', async () => {
    const user = await referrer();

    const first = await request<ReferralProgramSummary>({ method: 'GET', url: `${PATH}/me`, user });
    expect(first.status).toBe(200);
    expect(isReferralProgramCode(first.body.data.code)).toBe(true);
    expect(first.body.data.url).toContain(`/register?ref=${first.body.data.code}`);
    expect(first.body.data.stats).toEqual({ total: 0, rewarded: 0, earned: 0 });
    expect(first.body.data.reward).toEqual({ amount: 100, holdDays: 7 });

    expect(await codeOf(user)).toBe(first.body.data.code);
    expect(await prisma.referralProgramCode.count()).toBe(1);
  });

  it('keeps a salesperson on their GODID channel', async () => {
    const salesman = await createUser({ role: RoleName.SALESMAN, organizationId: null });
    expect((await request({ method: 'GET', url: `${PATH}/me`, user: salesman })).status).toBe(403);
    // They still have a wallet: their own referral rewards are paid into it.
    expect((await request({ method: 'GET', url: WALLET, user: salesman })).status).toBe(200);
  });
});

describe('the ₹100 reward', () => {
  it('credits the referrer the moment a paid-plan trial starts, held', async () => {
    const user = await referrer();
    const organizationId = await registerWith((await codeOf(user)).toLowerCase());

    const referral = await prisma.userReferral.findUniqueOrThrow({ where: { organizationId } });
    expect(referral.referrerUserId).toBe(user.id);
    expect(referral.status).toBe(UserReferralStatus.SIGNED_UP);
    // A separate program: nothing lands in the salesman channel.
    expect(await prisma.referralAttribution.count({ where: { organizationId } })).toBe(0);

    const wallet = await walletOf(user);
    expect(wallet).toMatchObject({ available: 0, held: 100, totalEarned: 100 });

    const history = await request<{ items: { reward: { amount: number; status: string } | null }[] }>(
      { method: 'GET', url: `${PATH}/me/referrals`, user },
    );
    expect(history.body.data.items[0]?.reward).toMatchObject({
      amount: 100,
      status: WalletEntryStatus.HELD,
    });

    const summary = await request<ReferralProgramSummary>({ method: 'GET', url: `${PATH}/me`, user });
    expect(summary.body.data.stats).toEqual({ total: 1, rewarded: 1, earned: 100 });
  });

  it('pays every referral, not only the first', async () => {
    const user = await referrer();
    const code = await codeOf(user);
    await registerWith(code);
    await registerWith(code);

    expect((await walletOf(user)).held).toBe(200);
  });

  it('pays nothing for a Free-plan signup', async () => {
    const user = await referrer();
    const organizationId = await registerWith(await codeOf(user), PlanTier.FREE);

    expect(await prisma.userReferral.count({ where: { organizationId } })).toBe(1);
    expect(await walletOf(user)).toMatchObject({ available: 0, held: 0, totalEarned: 0 });
  });

  it('becomes withdrawable once the hold passes with the trial still running', async () => {
    const user = await referrer();
    const organizationId = await registerWith(await codeOf(user));
    await endHold(organizationId);

    expect(await walletOf(user)).toMatchObject({ available: 100, held: 0, totalEarned: 100 });
  });

  it('is voided if the referred account left its trial before the hold ended', async () => {
    const user = await referrer();
    const organizationId = await registerWith(await codeOf(user));
    await prisma.subscription.update({ where: { organizationId }, data: { status: 'CANCELLED' } });
    await endHold(organizationId);

    expect(await walletOf(user)).toMatchObject({ available: 0, held: 0, totalEarned: 0 });
    const entry = await prisma.walletEntry.findFirstOrThrow({ where: { userId: user.id } });
    expect(entry.status).toBe(WalletEntryStatus.VOID);
  });

  it('still creates the account when the code belongs to nobody', async () => {
    const organizationId = await registerWith('SAARTHI-ZZZZZZ');
    expect(organizationId).toBeTruthy();
    expect(await prisma.userReferral.count()).toBe(0);
    expect(await prisma.walletEntry.count()).toBe(0);
  });
});

describe('cash-out without Cashfree Payouts configured', () => {
  it('keeps the balance and refuses to move money', async () => {
    const user = await referrer();
    const organizationId = await registerWith(await codeOf(user));
    await endHold(organizationId);

    const wallet = await walletOf(user);
    expect(wallet.cashoutEnabled).toBe(false);
    expect(wallet.minCashout).toBe(100);

    const bank = await request({
      method: 'PUT',
      url: `${WALLET}/bank-account`,
      user,
      payload: { accountHolderName: 'Test User', accountNumber: '123456789012', ifsc: 'HDFC0001234' },
    });
    expect(bank.status).toBe(503);

    const cashout = await request({ method: 'POST', url: `${WALLET}/cashouts`, user });
    expect(cashout.status).toBe(503);
    expect((await walletOf(user)).available).toBe(100);
  });
});

describe('qualification', () => {
  it('records the first subscription payment only, and pays no second reward', async () => {
    const user = await referrer();
    const organizationId = await registerWith(await codeOf(user));

    // Hardware is not the qualifying subscription.
    await qualifyPayment({
      organizationId,
      baseAmount: 3000,
      paymentReference: unique('PAY-'),
      trigger: PaymentTrigger.TRACKER,
    });
    expect(
      (await prisma.userReferral.findUniqueOrThrow({ where: { organizationId } })).status,
    ).toBe(UserReferralStatus.SIGNED_UP);

    const firstReference = unique('PAY-');
    await qualifyPayment({
      organizationId,
      baseAmount: 1499,
      paymentReference: firstReference,
      trigger: PaymentTrigger.SUBSCRIPTION,
    });
    await qualifyPayment({
      organizationId,
      baseAmount: 1499,
      paymentReference: unique('PAY-'),
      trigger: PaymentTrigger.SUBSCRIPTION,
    });

    const referral = await prisma.userReferral.findUniqueOrThrow({ where: { organizationId } });
    expect(referral.status).toBe(UserReferralStatus.QUALIFIED);
    expect(referral.qualifyingPaymentReference).toBe(firstReference);
    expect(await prisma.walletEntry.count({ where: { userId: user.id } })).toBe(1);
  });
});
