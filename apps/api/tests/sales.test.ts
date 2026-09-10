import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CommissionStatus,
  CommissionTrigger,
  CommissionType,
  OrganizationType,
  PlanTier,
  ReferralSource,
  ReferralStatus,
  RoleName,
  SalesLeadStatus,
  SalesmanStatus,
  TrackerHandoverStatus,
  computeCommission,
  isPlausibleGodId,
  normalizeGodId,
  referralUrl,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import * as commissionService from '../src/modules/sales/commission.service';
import * as referralService from '../src/modules/sales/referral.service';
import * as salesmanService from '../src/modules/sales/salesman.service';
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
 * Salesman, sales, referral and commission.
 *
 * Written against the guarantees the specification calls non-negotiable, in the
 * order it states them. Every test that matters here is a test that something
 * is *refused*:
 *
 *   * an unverified GODID earns nothing;
 *   * a second salesperson cannot take over an attributed customer;
 *   * a commission never exists without a successful payment;
 *   * a repeated payment event never pays twice;
 *   * a commission with no rule behind it cannot be approved;
 *   * a salesperson cannot approve their own commission, see a colleague's
 *     lead, or mark their own conversion.
 *
 * Nothing is stubbed. These run against the real PostgreSQL test database, so
 * the partial unique indexes and the CHECK constraint from the migration are
 * genuinely exercised — which is the point, because that is where the
 * anti-fraud rules actually live.
 */

const ADMIN_PATH = '/api/v1/sales';

interface SalesmanFixture {
  profileId: string;
  godId: string;
  user: TestUser;
}

/** A verified, active salesperson with a login. */
async function createVerifiedSalesman(overrides: { godId?: string } = {}): Promise<SalesmanFixture> {
  const godId = normalizeGodId(overrides.godId ?? unique('GOD-'));
  const user = await createUser({ role: RoleName.SALESMAN, organizationId: null });

  const profile = await prisma.salesmanProfile.create({
    data: {
      godId,
      userId: user.id,
      name: 'Test Salesperson',
      phone: uniquePhone(),
      status: SalesmanStatus.ACTIVE,
      verificationMethod: 'GODWEB',
      verifiedAt: new Date(),
      lastCheckedAt: new Date(),
      territory: 'Delhi NCR',
    },
  });

  return { profileId: profile.id, godId, user };
}

/** A salesperson whose GODID has never been checked. */
async function createPendingSalesman(): Promise<SalesmanFixture> {
  const godId = normalizeGodId(unique('GOD-'));
  const user = await createUser({ role: RoleName.SALESMAN, organizationId: null });
  const profile = await prisma.salesmanProfile.create({
    data: { godId, userId: user.id, status: SalesmanStatus.PENDING_VERIFICATION },
  });
  return { profileId: profile.id, godId, user };
}

async function createPercentageRule(rate: number, qualificationDays = 0): Promise<string> {
  const rule = await prisma.commissionRule.create({
    data: {
      name: unique('Rule '),
      trigger: CommissionTrigger.TRACKER,
      commissionType: CommissionType.PERCENTAGE,
      commissionRate: rate,
      qualificationDays,
      active: true,
    },
  });
  return rule.id;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeApp();
});

// ---------------------------------------------------------------------------
// GODID handling
// ---------------------------------------------------------------------------

describe('GODID normalisation', () => {
  it('treats the same identity typed three ways as one', () => {
    expect(normalizeGodId(' god-7f42k ')).toBe('GOD-7F42K');
    expect(normalizeGodId('GOD 7F42K')).toBe('GOD7F42K');
    expect(normalizeGodId('GOD-7F42K')).toBe('GOD-7F42K');
  });

  it('keeps obvious rubbish out of a provider call and out of a URL', () => {
    expect(isPlausibleGodId('GOD-7F42K')).toBe(true);
    expect(isPlausibleGodId('AB')).toBe(false);
    expect(isPlausibleGodId('god/../../etc')).toBe(false);
    expect(isPlausibleGodId('a'.repeat(40))).toBe(false);
  });

  it('builds a referral URL on the base the caller supplies', () => {
    // The base is passed in rather than read from a constant so a link made in
    // development is followable from the phone that scanned it.
    expect(referralUrl('https://saarthi.vorldx.com/', 'god-7f42k')).toBe(
      'https://saarthi.vorldx.com/r/GOD-7F42K',
    );
  });
});

// ---------------------------------------------------------------------------
// Verification gates selling
// ---------------------------------------------------------------------------

describe('salesman verification', () => {
  it('does not resolve an unverified GODID for attribution', async () => {
    const pending = await createPendingSalesman();
    await expect(salesmanService.resolveVerifiedSalesman(pending.godId)).resolves.toBeNull();
  });

  it('reports an unverified profile with the reason, not an empty screen', async () => {
    const pending = await createPendingSalesman();

    const response = await request<{
      profile: { canSell: boolean; standing: string } | null;
      attributionWindowDays: number;
    }>({ method: 'GET', url: `${ADMIN_PATH}/me`, user: pending.user });

    expect(response.status).toBe(200);
    expect(response.body.data.profile?.canSell).toBe(false);
    expect(response.body.data.profile?.standing).toMatch(/verif/i);
    // The window is echoed so no screen has to invent it.
    expect(response.body.data.attributionWindowDays).toBeGreaterThan(0);
  });

  it('refuses to mint a referral link for an unverified profile', async () => {
    const pending = await createPendingSalesman();

    const response = await request({
      method: 'GET',
      url: `${ADMIN_PATH}/referrals/mine`,
      user: pending.user,
    });

    expect(response.status).toBe(422);
  });

  it('issues a link and a QR for a verified profile', async () => {
    const salesman = await createVerifiedSalesman();

    const response = await request<{
      code: string;
      url: string;
      qrDataUri: string | null;
      attributionWindowDays: number;
    }>({ method: 'GET', url: `${ADMIN_PATH}/referrals/mine`, user: salesman.user });

    expect(response.status).toBe(200);
    expect(response.body.data.code).toBe(salesman.godId);
    expect(response.body.data.url).toContain(`/r/${salesman.godId}`);
    expect(response.body.data.qrDataUri).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('attributes nothing to an unverified salesperson at registration', async () => {
    const pending = await createPendingSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const customer = await createUser({
      role: RoleName.FLEET_OWNER,
      organizationId: organization.id,
    });

    const outcome = await referralService.attributeRegistration({
      code: pending.godId,
      organizationId: organization.id,
      customerUserId: customer.id,
    });

    expect(outcome.attributed).toBe(false);
    expect(outcome.reason).toMatch(/verified/i);
    await expect(
      prisma.referralAttribution.count({ where: { organizationId: organization.id } }),
    ).resolves.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Attribution: first valid attribution wins
// ---------------------------------------------------------------------------

describe('referral attribution', () => {
  it('credits the salesperson whose code a registration quoted', async () => {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const customer = await createUser({
      role: RoleName.FLEET_OWNER,
      organizationId: organization.id,
    });

    const outcome = await referralService.attributeRegistration({
      code: salesman.godId,
      organizationId: organization.id,
      customerUserId: customer.id,
    });

    expect(outcome.attributed).toBe(true);

    const row = await prisma.referralAttribution.findFirstOrThrow({
      where: { organizationId: organization.id },
    });
    expect(row.godId).toBe(salesman.godId);
    expect(row.status).toBe(ReferralStatus.ATTRIBUTED);
    // Stored at capture, so a later change to the configured window cannot
    // retroactively take the credit away or hand it back.
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('claims the earlier link click rather than starting a second row', async () => {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const customer = await createUser({
      role: RoleName.FLEET_OWNER,
      organizationId: organization.id,
    });

    const captured = await referralService.capture({
      code: salesman.godId,
      source: ReferralSource.REFERRAL_LINK,
      ipAddress: '203.0.113.9',
    });
    expect(captured.valid).toBe(true);

    await referralService.attributeRegistration({
      code: salesman.godId,
      organizationId: organization.id,
      customerUserId: customer.id,
    });

    const rows = await prisma.referralAttribution.findMany({
      where: { salesmanId: salesman.profileId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(captured.attributionId);
  });

  it('refuses to let a second salesperson take over an attributed customer', async () => {
    const first = await createVerifiedSalesman();
    const second = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const customer = await createUser({
      role: RoleName.FLEET_OWNER,
      organizationId: organization.id,
    });

    await referralService.attributeRegistration({
      code: first.godId,
      organizationId: organization.id,
      customerUserId: customer.id,
    });

    const stolen = await referralService.attributeRegistration({
      code: second.godId,
      organizationId: organization.id,
      customerUserId: customer.id,
    });

    expect(stolen.attributed).toBe(false);
    expect(stolen.reason).toMatch(/already attributed/i);

    const live = await referralService.liveAttributionFor(organization.id);
    expect(live?.godId).toBe(first.godId);

    // The refusal is audited, because it is a fraud signal and not a typo.
    await expect(
      prisma.auditLog.count({ where: { action: 'referral.attribution_refused' } }),
    ).resolves.toBe(1);
  });

  it('lets the database refuse two live attributions even when the check is bypassed', async () => {
    const first = await createVerifiedSalesman();
    const second = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);

    await prisma.referralAttribution.create({
      data: {
        salesmanId: first.profileId,
        godId: first.godId,
        source: ReferralSource.PHYSICAL,
        status: ReferralStatus.ATTRIBUTED,
        organizationId: organization.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    /*
     * Written straight to the table, deliberately bypassing every service
     * guard. This is the test that proves "first valid attribution wins" is a
     * database guarantee and not a race the service happens to win — the
     * partial unique index has to refuse it.
     */
    await expect(
      prisma.referralAttribution.create({
        data: {
          salesmanId: second.profileId,
          godId: second.godId,
          source: ReferralSource.MANUAL_GODID,
          status: ReferralStatus.ATTRIBUTED,
          organizationId: organization.id,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    ).rejects.toThrow();
  });

  it('frees a customer for a genuine new attribution once one is revoked', async () => {
    const first = await createVerifiedSalesman();
    const second = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    const created = await prisma.referralAttribution.create({
      data: {
        salesmanId: first.profileId,
        godId: first.godId,
        source: ReferralSource.PHYSICAL,
        status: ReferralStatus.ATTRIBUTED,
        organizationId: organization.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const revoke = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/referrals/${created.id}/revoke`,
      user: admin,
      payload: { reason: 'Recorded against the wrong salesperson.' },
    });
    expect(revoke.status).toBe(200);

    const reattributed = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/referrals/attribute`,
      user: admin,
      payload: {
        organizationId: organization.id,
        godId: second.godId,
        source: ReferralSource.MANUAL_GODID,
        reason: 'Physical sale by the second salesperson, confirmed with both.',
      },
    });
    expect(reattributed.status).toBe(201);
  });

  it('will not move a live attribution between salespeople, even for an admin', async () => {
    const first = await createVerifiedSalesman();
    const second = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    await prisma.referralAttribution.create({
      data: {
        salesmanId: first.profileId,
        godId: first.godId,
        source: ReferralSource.PHYSICAL,
        status: ReferralStatus.ATTRIBUTED,
        organizationId: organization.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const response = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/referrals/attribute`,
      user: admin,
      payload: {
        organizationId: organization.id,
        godId: second.godId,
        source: ReferralSource.MANUAL_GODID,
        reason: 'Trying to move the credit without revoking first.',
      },
    });

    expect(response.status).toBe(409);
  });

  it('tells an anonymous visitor almost nothing about a salesperson', async () => {
    const salesman = await createVerifiedSalesman();

    const response = await request<Record<string, unknown>>({
      method: 'GET',
      url: `/api/v1/referrals/public/${salesman.godId}`,
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      code: salesman.godId,
      salesmanName: 'Test Salesperson',
      territory: 'Delhi NCR',
      valid: true,
    });
    // No phone, no email, no pipeline, no customer list.
    expect(response.body.data).not.toHaveProperty('phone');
    expect(response.body.data).not.toHaveProperty('email');
  });

  it('reports an unknown code as invalid rather than 404, so signup still works', async () => {
    const response = await request<{ valid: boolean }>({
      method: 'GET',
      url: '/api/v1/referrals/public/GOD-NOBODY',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.valid).toBe(false);
  });

  it('expires an unused capture but never one with a customer behind it', async () => {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const past = new Date(Date.now() - 86_400_000);

    const stale = await prisma.referralAttribution.create({
      data: {
        salesmanId: salesman.profileId,
        godId: salesman.godId,
        source: ReferralSource.REFERRAL_LINK,
        status: ReferralStatus.CAPTURED,
        expiresAt: past,
      },
    });

    const realCustomer = await prisma.referralAttribution.create({
      data: {
        salesmanId: salesman.profileId,
        godId: salesman.godId,
        source: ReferralSource.REFERRAL_LINK,
        status: ReferralStatus.ATTRIBUTED,
        organizationId: organization.id,
        // Expired by the clock, and irrelevant: they already registered.
        expiresAt: past,
      },
    });

    await referralService.expireStaleCaptures();

    await expect(
      prisma.referralAttribution.findUniqueOrThrow({ where: { id: stale.id } }),
    ).resolves.toMatchObject({ status: ReferralStatus.EXPIRED });
    await expect(
      prisma.referralAttribution.findUniqueOrThrow({ where: { id: realCustomer.id } }),
    ).resolves.toMatchObject({ status: ReferralStatus.ATTRIBUTED });
  });
});

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

describe('commission arithmetic', () => {
  it('rounds to paise, not to rupees', () => {
    // 7.5% of 1499 is 112.425. Rounding to 112 loses money on every sale.
    expect(
      computeCommission(
        { commissionType: CommissionType.PERCENTAGE, commissionRate: 7.5, fixedAmount: null },
        1499,
      ),
    ).toEqual({ amount: 112.43, rate: 7.5, reason: null });
  });

  it('returns a null amount rather than zero when the terms cannot produce one', () => {
    const result = computeCommission(
      { commissionType: CommissionType.PERCENTAGE, commissionRate: null, fixedAmount: null },
      1000,
    );
    expect(result.amount).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it('honours a fixed rule whatever the sale was worth', () => {
    expect(
      computeCommission(
        { commissionType: CommissionType.FIXED, commissionRate: null, fixedAmount: 500 },
        99_999,
      ),
    ).toEqual({ amount: 500, rate: null, reason: null });
  });
});

describe('commission generation', () => {
  async function attributedCustomer(): Promise<{
    salesman: SalesmanFixture;
    organizationId: string;
  }> {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    await prisma.referralAttribution.create({
      data: {
        salesmanId: salesman.profileId,
        godId: salesman.godId,
        source: ReferralSource.REFERRAL_LINK,
        status: ReferralStatus.ATTRIBUTED,
        organizationId: organization.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    return { salesman, organizationId: organization.id };
  }

  it('records nothing for a customer nobody is credited with', async () => {
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);

    const result = await commissionService.generateForPayment({
      organizationId: organization.id,
      baseAmount: 4000,
      paymentReference: unique('PAY-'),
      trigger: CommissionTrigger.TRACKER,
    });

    expect(result.commissionId).toBeNull();
    expect(result.skipped).toMatch(/not attributed/i);
    await expect(prisma.commission.count()).resolves.toBe(0);
  });

  it('holds a sale with a null amount when no rule covers it', async () => {
    const { salesman, organizationId } = await attributedCustomer();

    const result = await commissionService.generateForPayment({
      organizationId,
      baseAmount: 4000,
      paymentReference: unique('PAY-'),
      trigger: CommissionTrigger.TRACKER,
    });

    expect(result.commissionId).not.toBeNull();
    // Null, and emphatically not zero — zero would read as a settled debt.
    expect(result.amount).toBeNull();

    const row = await prisma.commission.findFirstOrThrow({
      where: { salesmanId: salesman.profileId },
    });
    expect(row.commissionAmount).toBeNull();
    expect(row.unmatchedReason).toMatch(/no active commission rule/i);
    expect(row.status).toBe(CommissionStatus.PENDING);
  });

  it('computes the amount from the rule and marks the attribution converted', async () => {
    const { salesman, organizationId } = await attributedCustomer();
    await createPercentageRule(10);

    const result = await commissionService.generateForPayment({
      organizationId,
      baseAmount: 4000,
      paymentReference: unique('PAY-'),
      trigger: CommissionTrigger.TRACKER,
    });

    expect(result.amount).toBe(400);

    const attribution = await prisma.referralAttribution.findFirstOrThrow({
      where: { salesmanId: salesman.profileId },
    });
    // CONVERTED only after a real payment was seen, never on the strength of a
    // subscription record.
    expect(attribution.status).toBe(ReferralStatus.CONVERTED);
    expect(attribution.convertedAt).not.toBeNull();
  });

  it('never pays twice for one payment, however many times the event arrives', async () => {
    const { organizationId } = await attributedCustomer();
    await createPercentageRule(10);
    const reference = unique('PAY-');

    await commissionService.generateForPayment({
      organizationId,
      baseAmount: 4000,
      paymentReference: reference,
      trigger: CommissionTrigger.TRACKER,
    });
    await commissionService.generateForPayment({
      organizationId,
      baseAmount: 4000,
      paymentReference: reference,
      trigger: CommissionTrigger.TRACKER,
    });
    await commissionService.generateForPayment({
      organizationId,
      baseAmount: 4000,
      paymentReference: reference,
      trigger: CommissionTrigger.TRACKER,
    });

    await expect(prisma.commission.count()).resolves.toBe(1);
  });

  it('lets one payment earn a tracker and a top-up commission, and only one of each', async () => {
    const { organizationId } = await attributedCustomer();
    await createPercentageRule(10);
    await prisma.commissionRule.create({
      data: {
        name: unique('Top-up '),
        trigger: CommissionTrigger.VEHICLE_TOPUP,
        commissionType: CommissionType.FIXED,
        fixedAmount: 50,
        qualificationDays: 0,
        active: true,
      },
    });
    const reference = unique('SIGNUP-');

    for (const trigger of [CommissionTrigger.TRACKER, CommissionTrigger.VEHICLE_TOPUP]) {
      // Twice each, to prove the key is (trigger, reference) rather than either
      // one alone.
      await commissionService.generateForPayment({
        organizationId,
        baseAmount: 4000,
        paymentReference: reference,
        trigger,
      });
      await commissionService.generateForPayment({
        organizationId,
        baseAmount: 4000,
        paymentReference: reference,
        trigger,
      });
    }

    await expect(prisma.commission.count()).resolves.toBe(2);
  });

  it('keeps the rate a sale was computed at when the rule later changes', async () => {
    const { organizationId } = await attributedCustomer();
    const ruleId = await createPercentageRule(10);
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    await commissionService.generateForPayment({
      organizationId,
      baseAmount: 4000,
      paymentReference: unique('PAY-'),
      trigger: CommissionTrigger.TRACKER,
    });

    const updated = await request({
      method: 'PUT',
      url: `${ADMIN_PATH}/commission/rules/${ruleId}`,
      user: admin,
      payload: {
        name: 'Renegotiated',
        trigger: CommissionTrigger.TRACKER,
        commissionType: CommissionType.PERCENTAGE,
        commissionRate: 2,
        qualificationDays: 0,
        active: true,
      },
    });
    expect(updated.status).toBe(200);

    const row = await prisma.commission.findFirstOrThrow();
    // A sale made in March does not shrink because the rate fell in June.
    expect(Number(row.commissionAmount)).toBe(400);
    expect(Number(row.commissionRate)).toBe(10);
  });

  it('prices the sales that were waiting for a rule, once one exists', async () => {
    const { organizationId } = await attributedCustomer();
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    await commissionService.generateForPayment({
      organizationId,
      baseAmount: 4000,
      paymentReference: unique('PAY-'),
      trigger: CommissionTrigger.TRACKER,
    });
    await expect(
      prisma.commission.count({ where: { commissionAmount: null } }),
    ).resolves.toBe(1);

    const created = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/commission/rules`,
      user: admin,
      payload: {
        name: 'First rule',
        trigger: CommissionTrigger.TRACKER,
        commissionType: CommissionType.PERCENTAGE,
        commissionRate: 7.5,
        qualificationDays: 0,
        active: true,
      },
    });
    expect(created.status).toBe(201);

    const row = await prisma.commission.findFirstOrThrow();
    expect(Number(row.commissionAmount)).toBe(300);
    expect(row.unmatchedReason).toBeNull();
  });

  it('refuses two active rules covering the same sale', async () => {
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });
    const payload = {
      trigger: CommissionTrigger.TRACKER,
      commissionType: CommissionType.PERCENTAGE,
      commissionRate: 5,
      qualificationDays: 30,
      active: true,
    };

    const first = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/commission/rules`,
      user: admin,
      payload: { ...payload, name: 'One' },
    });
    expect(first.status).toBe(201);

    const second = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/commission/rules`,
      user: admin,
      payload: { ...payload, name: 'Two' },
    });
    // Otherwise the amount would depend on which row the planner returned.
    expect(second.status).toBe(409);
  });
});

describe('commission decisions', () => {
  async function pendingCommission(options: { rate?: number; qualificationDays?: number } = {}) {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    await prisma.referralAttribution.create({
      data: {
        salesmanId: salesman.profileId,
        godId: salesman.godId,
        source: ReferralSource.REFERRAL_LINK,
        status: ReferralStatus.ATTRIBUTED,
        organizationId: organization.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    if (options.rate !== undefined) {
      await createPercentageRule(options.rate, options.qualificationDays ?? 0);
    }
    await commissionService.generateForPayment({
      organizationId: organization.id,
      baseAmount: 4000,
      paymentReference: unique('PAY-'),
      trigger: CommissionTrigger.TRACKER,
    });
    const row = await prisma.commission.findFirstOrThrow();
    return { salesman, commissionId: row.id, organizationId: organization.id };
  }

  it('does not let a salesperson approve their own commission', async () => {
    const { salesman, commissionId } = await pendingCommission({ rate: 10 });

    const response = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/commission/${commissionId}/decision`,
      user: salesman.user,
      payload: { status: CommissionStatus.APPROVED },
    });

    expect(response.status).toBe(403);
  });

  it('does not let a commission jump from pending to paid', async () => {
    const { commissionId } = await pendingCommission({ rate: 10 });
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    const response = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/commission/${commissionId}/decision`,
      user: admin,
      payload: { status: CommissionStatus.PAID },
    });

    // APPROVED records who confirmed the figure; PAYABLE records the payout run
    // picking it up. A payment with neither has no authorisation trail.
    expect(response.status).toBe(409);
  });

  it('will not approve a commission that has no amount', async () => {
    const { commissionId } = await pendingCommission();
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    const response = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/commission/${commissionId}/decision`,
      user: admin,
      payload: { status: CommissionStatus.APPROVED },
    });

    expect(response.status).toBe(422);
    expect(response.body.error?.message).toMatch(/no amount/i);
  });

  it('will not approve inside the qualification period', async () => {
    const { commissionId } = await pendingCommission({ rate: 10, qualificationDays: 30 });
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    const response = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/commission/${commissionId}/decision`,
      user: admin,
      payload: { status: CommissionStatus.APPROVED },
    });

    expect(response.status).toBe(422);
    expect(response.body.error?.message).toMatch(/qualification period/i);
  });

  it('requires a reason to take money back', async () => {
    const { commissionId } = await pendingCommission({ rate: 10 });
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    const response = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/commission/${commissionId}/decision`,
      user: admin,
      payload: { status: CommissionStatus.REVERSED },
    });

    expect(response.status).toBe(400);
  });

  it('walks approve → payable → paid and records who did each', async () => {
    const { commissionId } = await pendingCommission({ rate: 10 });
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    for (const status of [
      CommissionStatus.APPROVED,
      CommissionStatus.PAYABLE,
      CommissionStatus.PAID,
    ]) {
      const response = await request({
        method: 'POST',
        url: `${ADMIN_PATH}/commission/${commissionId}/decision`,
        user: admin,
        payload: {
          status,
          ...(status === CommissionStatus.PAID ? { paymentReference: 'NEFT-001' } : {}),
        },
      });
      expect(response.status).toBe(200);
    }

    const row = await prisma.commission.findUniqueOrThrow({ where: { id: commissionId } });
    expect(row.status).toBe(CommissionStatus.PAID);
    expect(row.approvedByUserId).toBe(admin.id);
    expect(row.paidByUserId).toBe(admin.id);
    expect(row.payoutReference).toBe('NEFT-001');
  });

  it('refuses to settle a null amount even straight at the database', async () => {
    const { commissionId } = await pendingCommission();

    /*
     * The CHECK constraint from the migration, exercised directly. It is the
     * last line of defence: if a future code path ever approves an unpriced
     * row, this refuses rather than creating a debt of unknown size.
     */
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "commissions" SET "status" = 'APPROVED' WHERE "id" = $1::uuid`,
        commissionId,
      ),
    ).rejects.toThrow();
  });

  it('counts an unpriced sale rather than summing it as zero', async () => {
    const { salesman } = await pendingCommission();

    const totals = await commissionService.commissionTotals(salesman.profileId);

    expect(totals.pending).toBe(0);
    expect(totals.awaitingRule).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Payment qualification — no payment, no commission
// ---------------------------------------------------------------------------

describe('payment qualification', () => {
  it('records no commission without a provider reference', async () => {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    await prisma.referralAttribution.create({
      data: {
        salesmanId: salesman.profileId,
        godId: salesman.godId,
        source: ReferralSource.REFERRAL_LINK,
        status: ReferralStatus.ATTRIBUTED,
        organizationId: organization.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await createPercentageRule(10);

    // No reference means no idempotency key, so a retry could pay twice.
    await qualifyPayment({
      organizationId: organization.id,
      baseAmount: 4000,
      paymentReference: null,
      trigger: CommissionTrigger.TRACKER,
    });

    await expect(prisma.commission.count()).resolves.toBe(0);
  });

  it('never throws out of a successful purchase, whatever goes wrong', async () => {
    // A commission failure must not roll back a payment the customer has made.
    await expect(
      qualifyPayment({
        organizationId: '00000000-0000-0000-0000-000000000000',
        baseAmount: 4000,
        paymentReference: unique('PAY-'),
        trigger: CommissionTrigger.TRACKER,
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

describe('sales leads', () => {
  it('lets a salesperson work their own pipeline', async () => {
    const salesman = await createVerifiedSalesman();

    const created = await request<{ id: string; status: string; availableStatuses: string[] }>({
      method: 'POST',
      url: `${ADMIN_PATH}/leads`,
      user: salesman.user,
      payload: {
        contactName: 'Ramesh Kumar',
        businessName: 'ABC Transport',
        phone: uniquePhone(),
        city: 'Ludhiana',
        fleetSize: 10,
      },
    });

    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe(SalesLeadStatus.NEW);
    // The dropdown and the API guard are the same list.
    expect(created.body.data.availableStatuses).not.toContain(SalesLeadStatus.ACTIVATED);
  });

  it('refuses a second lead for the same phone number', async () => {
    const salesman = await createVerifiedSalesman();
    const phone = uniquePhone();

    await request({
      method: 'POST',
      url: `${ADMIN_PATH}/leads`,
      user: salesman.user,
      payload: { contactName: 'First', phone },
    });
    const duplicate = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/leads`,
      user: salesman.user,
      payload: { contactName: 'Second', phone },
    });

    expect(duplicate.status).toBe(409);
  });

  it('does not let a salesperson mark their own conversion', async () => {
    const salesman = await createVerifiedSalesman();
    const created = await request<{ id: string }>({
      method: 'POST',
      url: `${ADMIN_PATH}/leads`,
      user: salesman.user,
      payload: { contactName: 'Ramesh', phone: uniquePhone() },
    });

    const response = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/leads/${created.body.data.id}/status`,
      user: salesman.user,
      payload: { status: SalesLeadStatus.ACTIVATED },
    });

    expect(response.status).toBe(422);
    expect(response.body.error?.message).toMatch(/Saarthi sets this stage/i);
  });

  it('hides one salesperson’s leads from another', async () => {
    const mine = await createVerifiedSalesman();
    const theirs = await createVerifiedSalesman();

    const created = await request<{ id: string }>({
      method: 'POST',
      url: `${ADMIN_PATH}/leads`,
      user: mine.user,
      payload: { contactName: 'Private prospect', phone: uniquePhone() },
    });

    const peek = await request({
      method: 'GET',
      url: `${ADMIN_PATH}/leads/${created.body.data.id}`,
      user: theirs.user,
    });
    // 404 rather than 403, so the endpoint cannot be used to enumerate a
    // colleague's prospects.
    expect(peek.status).toBe(404);

    const list = await request<{ items: unknown[] }>({
      method: 'GET',
      url: `${ADMIN_PATH}/leads?salesmanId=${mine.profileId}`,
      user: theirs.user,
    });
    // The query parameter is ignored for a salesman caller.
    expect(list.body.data.items).toHaveLength(0);
  });

  it('starts an assisted signup that cannot carry a credential', async () => {
    const salesman = await createVerifiedSalesman();
    const lead = await request<{ id: string }>({
      method: 'POST',
      url: `${ADMIN_PATH}/leads`,
      user: salesman.user,
      payload: { contactName: 'Ramesh', phone: uniquePhone() },
    });

    const response = await request<{ signupUrl: string; notice: string }>({
      method: 'POST',
      url: `${ADMIN_PATH}/leads/assisted-signup`,
      user: salesman.user,
      payload: {
        leadId: lead.body.data.id,
        // Deliberately smuggled in. The schema strips unknown keys, so nothing
        // reaches the service and nothing is stored.
        password: 'Hunter2Hunter2',
        otp: '123456',
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.data.signupUrl).toContain(`ref=${salesman.godId}`);
    expect(response.body.data.notice).toMatch(/never ask/i);
    expect(JSON.stringify(response.body.data)).not.toContain('Hunter2');
  });
});

// ---------------------------------------------------------------------------
// Tracker handover
// ---------------------------------------------------------------------------

describe('tracker handover', () => {
  it('will not allocate a tracker whose payment failed', async () => {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    const tracker = await prisma.vehicleTracker.create({
      data: {
        organizationId: organization.id,
        status: 'PAYMENT_FAILED',
        pricePaid: 4000,
      },
    });

    const response = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/trackers/assign`,
      user: admin,
      payload: { trackerId: tracker.id, salesmanId: salesman.profileId },
    });

    // Otherwise a salesperson turns up with hardware nobody has bought.
    expect(response.status).toBe(422);
  });

  it('records a handover against a named person and writes the serial back', async () => {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    const tracker = await prisma.vehicleTracker.create({
      data: { organizationId: organization.id, status: 'ACTIVE', pricePaid: 4000 },
    });

    const assigned = await request<{ id: string }>({
      method: 'POST',
      url: `${ADMIN_PATH}/trackers/assign`,
      user: admin,
      payload: { trackerId: tracker.id, salesmanId: salesman.profileId },
    });
    expect(assigned.status).toBe(201);

    const handed = await request<{ status: string; acknowledgedBy: string }>({
      method: 'POST',
      url: `${ADMIN_PATH}/trackers/${assigned.body.data.id}/handover`,
      user: salesman.user,
      payload: { acknowledgedBy: 'Ramesh Kumar', serialNumber: 'SR-TRK-0099' },
    });

    expect(handed.status).toBe(200);
    expect(handed.body.data.status).toBe(TrackerHandoverStatus.HANDED_TO_CUSTOMER);
    expect(handed.body.data.acknowledgedBy).toBe('Ramesh Kumar');

    // Written onto the customer's own tracker row, so it shows on their
    // subscription screen rather than living only in a sales table.
    await expect(
      prisma.vehicleTracker.findUniqueOrThrow({ where: { id: tracker.id } }),
    ).resolves.toMatchObject({ serialNumber: 'SR-TRK-0099' });
  });

  it('refuses a handover with nobody’s name against it', async () => {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    const tracker = await prisma.vehicleTracker.create({
      data: { organizationId: organization.id, status: 'ACTIVE', pricePaid: 4000 },
    });
    const assigned = await request<{ id: string }>({
      method: 'POST',
      url: `${ADMIN_PATH}/trackers/assign`,
      user: admin,
      payload: { trackerId: tracker.id, salesmanId: salesman.profileId },
    });

    const response = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/trackers/${assigned.body.data.id}/handover`,
      user: salesman.user,
      payload: {},
    });

    expect(response.status).toBe(400);
  });

  it('does not let a salesperson allocate stock to themselves', async () => {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const tracker = await prisma.vehicleTracker.create({
      data: { organizationId: organization.id, status: 'ACTIVE', pricePaid: 4000 },
    });

    const response = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/trackers/assign`,
      user: salesman.user,
      payload: { trackerId: tracker.id, salesmanId: salesman.profileId },
    });

    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// First-vehicle demonstration
// ---------------------------------------------------------------------------

describe('first vehicle demonstration', () => {
  it('refuses to complete onboarding on a vehicle that is not set up', async () => {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);

    await prisma.referralAttribution.create({
      data: {
        salesmanId: salesman.profileId,
        godId: salesman.godId,
        source: ReferralSource.PHYSICAL,
        status: ReferralStatus.ATTRIBUTED,
        organizationId: organization.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const lead = await prisma.salesLead.create({
      data: {
        salesmanId: salesman.profileId,
        contactName: 'Ramesh',
        phone: uniquePhone(),
        organizationId: organization.id,
        status: SalesLeadStatus.SUBSCRIBED,
      },
    });

    const vehicle = await prisma.truck.create({
      data: {
        organizationId: organization.id,
        registrationNumber: unique('DL01AB'),
        capacityTons: 10,
      },
    });

    const response = await request({
      method: 'POST',
      url: `${ADMIN_PATH}/onboarding/complete`,
      user: salesman.user,
      payload: { leadId: lead.id, vehicleId: vehicle.id },
    });

    // The request carries no evidence at all; the server re-reads the real
    // device and telemetry state and says which steps are outstanding.
    expect(response.status).toBe(422);
    expect(response.body.error?.message).toMatch(/not fully set up/i);
    await expect(
      prisma.salesLead.findUniqueOrThrow({ where: { id: lead.id } }),
    ).resolves.toMatchObject({ onboardingCompletedAt: null });
  });

  it('reports every step honestly for a vehicle with nothing fitted', async () => {
    const salesman = await createVerifiedSalesman();
    const organization = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);

    await prisma.referralAttribution.create({
      data: {
        salesmanId: salesman.profileId,
        godId: salesman.godId,
        source: ReferralSource.PHYSICAL,
        status: ReferralStatus.ATTRIBUTED,
        organizationId: organization.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const vehicle = await prisma.truck.create({
      data: {
        organizationId: organization.id,
        registrationNumber: unique('DL01AB'),
        capacityTons: 10,
      },
    });

    const response = await request<{
      complete: boolean;
      steps: { step: string; state: string; detail: string }[];
    }>({
      method: 'GET',
      url: `${ADMIN_PATH}/onboarding/readiness?vehicleId=${vehicle.id}`,
      user: salesman.user,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.complete).toBe(false);
    expect(response.body.data.steps).toHaveLength(6);
    // Nothing is ever reported as confirmed without evidence, and every step
    // explains itself rather than showing a bare cross.
    expect(response.body.data.steps.every((step) => step.state !== 'CONFIRMED')).toBe(true);
    expect(response.body.data.steps.every((step) => step.detail.length > 0)).toBe(true);
  });

  it('will not show a salesperson a vehicle belonging to somebody else’s customer', async () => {
    const salesman = await createVerifiedSalesman();
    const stranger = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const vehicle = await prisma.truck.create({
      data: {
        organizationId: stranger.id,
        registrationNumber: unique('DL02CD'),
        capacityTons: 10,
      },
    });

    const response = await request({
      method: 'GET',
      url: `${ADMIN_PATH}/onboarding/readiness?vehicleId=${vehicle.id}`,
      user: salesman.user,
    });

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Role boundaries
// ---------------------------------------------------------------------------

describe('sales RBAC', () => {
  it('keeps a fleet owner out of the sales surface', async () => {
    const organization = await createOrganization();
    const owner = await createUser({
      role: RoleName.FLEET_OWNER,
      organizationId: organization.id,
    });

    for (const url of [
      `${ADMIN_PATH}/leads`,
      `${ADMIN_PATH}/commission`,
      `${ADMIN_PATH}/referrals`,
      `${ADMIN_PATH}/trackers`,
    ]) {
      const response = await request({ method: 'GET', url, user: owner });
      expect(response.status).toBe(403);
    }
  });

  it('keeps a salesperson out of a customer’s fleet, drivers and telemetry', async () => {
    const salesman = await createVerifiedSalesman();

    for (const url of [
      '/api/v1/trucks',
      '/api/v1/drivers',
      '/api/v1/tracking/positions',
      '/api/v1/telemetry/alerts',
    ]) {
      const response = await request({ method: 'GET', url, user: salesman.user });
      // 403 for a missing permission, 404 if the route shape differs — either
      // way, no customer's operational data comes back.
      expect([403, 404]).toContain(response.status);
    }
  });

  it('keeps a salesperson out of salesman administration', async () => {
    const salesman = await createVerifiedSalesman();

    const response = await request({
      method: 'GET',
      url: `${ADMIN_PATH}/salesmen`,
      user: salesman.user,
    });

    expect(response.status).toBe(403);
  });

  it('refuses the whole sales surface to a user with no salesman profile', async () => {
    const admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });
    // A platform admin has no profile of their own, and `me` says so rather
    // than failing.
    const response = await request<{ profile: null }>({
      method: 'GET',
      url: `${ADMIN_PATH}/me`,
      user: admin,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.profile).toBeNull();
  });
});
