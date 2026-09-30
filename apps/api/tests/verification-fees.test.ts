import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A hosted checkout confirms later, by webhook, so the request is held
// encrypted until then. Set before any application module loads its config.
vi.hoisted(() => {
  process.env.IDENTITY_ENCRYPTION_KEY = 'test-identity-encryption-key-0123456789abcdef';
});

import {
  OrganizationType,
  PaymentPurpose,
  PaymentStatus,
  PlanTier,
  RoleName,
  VerificationChargeStatus,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { paymentProvider } from '../src/providers/payments';
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
 * Pay & Verify — the customer pays Saarthi's verification fee, through the
 * existing payment flow, before any billable provider call is made.
 *
 * Way2API is stubbed at `fetch`, so the suite never spends a paid call and can
 * count exactly how many were made. The mock gateway settles in-process; the
 * hosted-checkout path is exercised by standing the gateway's two answers in
 * for Cashfree's (`createIntent` pending, `fetchIntent` decided).
 */

const CHECKS_URL = '/api/v1/verification-center/checks';

// Constructed to satisfy their own check digits and belonging to nobody.
const VALID_AADHAAR = '234567890124';
const VALID_PAN = 'ABCPE1234F';
const OTHER_PAN = 'ABCPE9876K';
const COMPANY_PAN = 'ABCCE1234F';
const VALID_VOTER_ID = 'ABC1234567';
// Embeds COMPANY_PAN, as a real GSTIN embeds its holder's PAN.
const VALID_GSTIN = '27ABCCE1234F1Z2';

interface StartResult {
  mode: 'ALREADY_VERIFIED' | 'COMPLETED_FREE' | 'CHECKOUT' | 'COMPLETED';
  state: string;
  message: string | null;
  checkout: { reference: string } | null;
  charge: {
    id: string;
    status: string;
    amount: number;
    paymentReference: string;
    freeRetryAvailable: boolean;
  } | null;
}

// ---------------------------------------------------------------------------
// Way2API stub
// ---------------------------------------------------------------------------

type Way2ApiAnswer = { status?: number; body: unknown };

const found = (result: Record<string, unknown>): Way2ApiAnswer => ({
  body: { status: 'SUCCESS', success: true, message_code: 'SUCCESS', data: { order_id: 'W2A-OK', result } },
});
const notFound: Way2ApiAnswer = {
  body: {
    status: 'FAILED',
    success: false,
    message_code: 'NO_RECORD_FOUND',
    message: 'No record found for this number.',
    data: { order_id: 'W2A-NONE' },
  },
};
const outage: Way2ApiAnswer = { status: 503, body: { message_code: 'PROVIDER_UNAVAILABLE' } };

function stubWay2Api(answer: (path: string) => Way2ApiAnswer) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const { status = 200, body } = answer(new URL(String(input)).pathname);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const panVerified = () =>
  stubWay2Api((path) =>
    path.endsWith('/pan/verify') ? found({ pan: VALID_PAN, name: 'TEST USER', status: 'VALID' }) : notFound,
  );

// Answers exactly as Way2API's response pages document them — the envelope and
// the field names both. See app.way2api.com/documentation/<endpoint>/response.
const documented = (result: Record<string, unknown>): Way2ApiAnswer => ({
  body: {
    status: 'SUCCESS',
    status_code: 200,
    charged: true,
    success: true,
    message: '',
    message_code: 'OK',
    order_id: 'W2A-OK',
    data: { order_id: 'W2A-OK', result },
  },
});
const sourceDown: Way2ApiAnswer = {
  status: 422,
  body: {
    status: 'SUCCESS',
    status_code: 422,
    charged: true,
    success: false,
    message: 'Record source temporarily unavailable.',
    message_code: 'SOURCE_UNAVAILABLE',
    order_id: 'W2A-DOWN',
  },
};

/** The JSON body of the n-th call the stub received. */
const sentBody = (fetchMock: ReturnType<typeof stubWay2Api>, call = 0): unknown =>
  JSON.parse(String(((fetchMock.mock.calls[call] as unknown[])[1] as RequestInit).body));

// The Aadhaar–PAN link check takes the Aadhaar alone and names the PAN it is
// linked to, masked.
const VALID_PAN_MASKED = 'ABXXXXXX4F';
const aadhaarLinked = (maskedPan: string): Way2ApiAnswer =>
  documented({ masked_pan: maskedPan, linking_status: true, reason: 'linked', detailed_reason: null });
const aadhaarRejected: Way2ApiAnswer = {
  status: 422,
  body: {
    status: 'SUCCESS',
    status_code: 422,
    charged: true,
    success: false,
    message: 'Invalid Aadhaar Number',
    message_code: 'VERIFICATION_FAILED',
    order_id: 'W2A-LINK',
    data: { error_code: 'verification_failed', result: { linking_status: false, reason: 'invalid_aadhaar' } },
  },
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let fleet: TestOrganization;
let otherFleet: TestOrganization;
let owner: TestUser;
let otherOwner: TestUser;
let driverUser: TestUser;
let driverId: string;
let admin: TestUser;

const panForDriver = (number = VALID_PAN) => ({
  kind: 'PAN',
  subjectType: 'DRIVER',
  subjectId: driverId,
  number,
});

async function payAndVerify(user: TestUser, payload: Record<string, unknown>) {
  return request<StartResult>({ method: 'POST', url: CHECKS_URL, user, payload });
}

beforeAll(async () => {
  await getApp();
});

afterAll(async () => {
  await closeApp();
});

beforeEach(async () => {
  await resetDatabase();
  fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
  otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
  owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
  otherOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: otherFleet.id });
  driverUser = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
  driverId = driverUser.driverId!;
  admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

describe('verification pricing', () => {
  it('prices every billable check at ₹10 and never shows the provider cost', async () => {
    const response = await request<Record<string, unknown>[]>({
      method: 'GET',
      url: '/api/v1/verification-center/prices',
      user: owner,
    });

    expect(response.status).toBe(200);
    const types = response.body.data.map((row) => row.checkType).sort();
    expect(types).toEqual(['AADHAAR', 'DRIVING_LICENCE', 'GST', 'PAN', 'VEHICLE_RC', 'VOTER_ID']);
    for (const row of response.body.data) {
      expect(row.amount).toBe(10);
      expect(row.currency).toBe('INR');
      expect(row).not.toHaveProperty('providerCost');
      expect(row).not.toHaveProperty('provider');
    }
  });
});

// ---------------------------------------------------------------------------
// The payment rule
// ---------------------------------------------------------------------------

describe('pay first, then verify', () => {
  it('refuses a billable check on the direct endpoint without payment, calling nothing', async () => {
    const fetchMock = panVerified();

    const response = await request<unknown>({
      method: 'POST',
      url: '/api/v1/identity/verify',
      user: owner,
      payload: panForDriver(),
    });

    expect(response.status).toBe(402);
    expect(response.body.error?.code).toBe('PAYMENT_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(driver.panVerifiedAt).toBeNull();
  });

  it('charges ₹10 through the payment flow, then verifies and persists the result', async () => {
    const fetchMock = panVerified();

    const response = await payAndVerify(owner, panForDriver());

    expect(response.status).toBe(200);
    expect(response.body.data.mode).toBe('COMPLETED');
    expect(response.body.data.state).toBe('VERIFIED');
    expect(response.body.data.charge?.status).toBe(VerificationChargeStatus.VERIFIED);
    expect(response.body.data.charge?.amount).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // One VERIFICATION_FEE payment, taken from the driver's organization.
    const payments = await prisma.payment.findMany({ where: { purpose: PaymentPurpose.VERIFICATION_FEE } });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(Number(payments[0]?.amount)).toBe(10);
    expect(payments[0]?.organizationId).toBe(fleet.id);

    // Persisted before the reply: the driver row carries the verified PAN.
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(driver.panVerifiedAt).not.toBeNull();

    // The price and provider cost were snapshotted onto the charge.
    const charge = await prisma.verificationCharge.findFirstOrThrow({ where: { subjectId: driverId } });
    expect(charge.pricingVersion).toBe('V1');
    expect(Number(charge.providerCost)).toBeCloseTo(0.0341);
    expect(charge.providerBilled).toBe(true);
    expect(charge.encryptedRequest).toBeNull();
  });

  it('ignores a price sent by the client', async () => {
    panVerified();

    const response = await payAndVerify(owner, { ...panForDriver(), amount: 1, customerPrice: 1 });

    expect(response.status).toBe(200);
    expect(response.body.data.charge?.amount).toBe(10);
    const payment = await prisma.payment.findFirstOrThrow({ where: { purpose: PaymentPurpose.VERIFICATION_FEE } });
    expect(Number(payment.amount)).toBe(10);
  });

  it('does not charge again for a check already verified', async () => {
    const fetchMock = panVerified();
    await payAndVerify(owner, panForDriver());

    const second = await payAndVerify(owner, panForDriver());

    expect(second.body.data.mode).toBe('ALREADY_VERIFIED');
    expect(second.body.data.charge).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await prisma.payment.count({ where: { purpose: PaymentPurpose.VERIFICATION_FEE } })).toBe(1);
  });

  it('never calls the provider when the payment is declined', async () => {
    const fetchMock = panVerified();
    vi.spyOn(paymentProvider, 'createIntent').mockResolvedValue({
      providerReference: 'DECLINED-1',
      status: 'FAILED',
      checkout: null,
      redirectUrl: null,
      failureCode: 'DECLINED',
      failureMessage: 'The bank declined this payment.',
      processedAt: null,
    });

    const response = await payAndVerify(owner, panForDriver());

    expect(response.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    const charge = await prisma.verificationCharge.findFirstOrThrow({ where: { subjectId: driverId } });
    expect(charge.status).toBe(VerificationChargeStatus.PAYMENT_FAILED);
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(driver.panVerifiedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hosted checkout
// ---------------------------------------------------------------------------

describe('hosted checkout (Cashfree)', () => {
  function standInForCashfree(outcome: 'SUCCEEDED' | 'FAILED') {
    vi.spyOn(paymentProvider, 'createIntent').mockImplementation(async (input) => ({
      providerReference: `CF-${input.reference}`,
      status: 'PENDING',
      checkout: {
        provider: 'cashfree',
        mode: 'sandbox',
        kind: 'payment',
        sessionId: 'session-test',
        reference: input.reference,
      },
      redirectUrl: null,
      failureCode: null,
      failureMessage: null,
      processedAt: null,
    }));
    vi.spyOn(paymentProvider, 'fetchIntent').mockResolvedValue({
      status: outcome,
      failureMessage: outcome === 'FAILED' ? 'Payment failed at the bank.' : null,
      processedAt: outcome === 'SUCCEEDED' ? new Date() : null,
    });
  }

  const webhook = async (reference: string, idempotencyKey: string) => {
    const instance = await getApp();
    const rawBody = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: reference } } });
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', 'test-webhook-secret').update(timestamp + rawBody).digest('base64');
    return instance.inject({
      method: 'POST',
      url: '/api/v1/webhooks/cashfree',
      payload: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-webhook-timestamp': timestamp,
        'x-webhook-signature': signature,
        'x-idempotency-key': idempotencyKey,
      },
    });
  };

  it('waits for the payment, and verifies exactly once however often it is confirmed', async () => {
    const fetchMock = panVerified();
    standInForCashfree('SUCCEEDED');

    const started = await payAndVerify(owner, panForDriver());
    expect(started.body.data.mode).toBe('CHECKOUT');
    expect(started.body.data.state).toBe('PAYMENT_PROCESSING');
    // Nothing billable happens before the money is confirmed.
    expect(fetchMock).not.toHaveBeenCalled();

    const reference = started.body.data.checkout!.reference;

    // Two webhook deliveries and the payer returning, in any order.
    expect((await webhook(reference, 'delivery-1')).statusCode).toBe(200);
    expect((await webhook(reference, 'delivery-2')).statusCode).toBe(200);
    const confirmed = await request({ method: 'POST', url: `/api/v1/payments/${reference}/confirm`, user: owner });
    expect(confirmed.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const charges = await prisma.verificationCharge.findMany({ where: { subjectId: driverId } });
    expect(charges).toHaveLength(1);
    expect(charges[0]?.status).toBe(VerificationChargeStatus.VERIFIED);
    expect(await prisma.payment.count({ where: { purpose: PaymentPurpose.VERIFICATION_FEE } })).toBe(1);
    expect(await prisma.identityVerification.count({ where: { subjectId: driverId } })).toBe(1);

    const charge = await request<{ status: string }>({
      method: 'GET',
      url: `/api/v1/verification-center/charges/${charges[0]!.id}`,
      user: owner,
    });
    expect(charge.body.data.status).toBe('VERIFIED');
  });

  it('leaves the check unpaid and unverified when the checkout fails', async () => {
    const fetchMock = panVerified();
    standInForCashfree('FAILED');

    const started = await payAndVerify(owner, panForDriver());
    const reference = started.body.data.checkout!.reference;
    await request({ method: 'POST', url: `/api/v1/payments/${reference}/confirm`, user: owner });

    expect(fetchMock).not.toHaveBeenCalled();
    const charge = await prisma.verificationCharge.findFirstOrThrow({ where: { subjectId: driverId } });
    expect(charge.status).toBe(VerificationChargeStatus.PAYMENT_FAILED);
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(driver.panVerifiedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Provider failure policy
// ---------------------------------------------------------------------------

describe('when the provider fails after payment', () => {
  it('keeps the fee as a free retry when no answer came back', async () => {
    stubWay2Api(() => outage);

    const first = await payAndVerify(owner, panForDriver());
    expect(first.body.data.state).toBe('RETRY_REQUIRED');
    expect(first.body.data.charge?.freeRetryAvailable).toBe(true);

    // The provider is back: the retry is run without a second payment.
    const fetchMock = panVerified();
    const retry = await payAndVerify(owner, panForDriver());

    expect(retry.body.data.state).toBe('VERIFIED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await prisma.payment.count({ where: { purpose: PaymentPurpose.VERIFICATION_FEE } })).toBe(1);
    const charge = await prisma.verificationCharge.findFirstOrThrow({ where: { subjectId: driverId } });
    expect(charge.status).toBe(VerificationChargeStatus.VERIFIED);
    expect(charge.consumedAt).not.toBeNull();
  });

  it('consumes the attempt when the provider gave a definite answer', async () => {
    stubWay2Api(() => notFound);

    const first = await payAndVerify(owner, panForDriver(OTHER_PAN));
    expect(first.body.data.state).toBe('FAILED');
    expect(first.body.data.charge?.freeRetryAvailable).toBe(false);

    // A new attempt is a new payment.
    panVerified();
    await payAndVerify(owner, panForDriver());
    expect(await prisma.payment.count({ where: { purpose: PaymentPurpose.VERIFICATION_FEE } })).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

describe('verification subjects stay separate', () => {
  it('records a person’s own PAN against them, never against a driver', async () => {
    panVerified();
    const personalOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    await prisma.organization.update({ where: { id: personalOrg.id }, data: { isPersonalSeat: true } });
    const person = await createUser({ role: RoleName.FLEET_OWNER, organizationId: personalOrg.id });

    const response = await payAndVerify(person, {
      kind: 'PAN',
      subjectType: 'USER',
      subjectId: person.id,
      number: VALID_PAN,
    });

    expect(response.body.data.state).toBe('VERIFIED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(user.panVerifiedAt).not.toBeNull();
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(driver.panVerifiedAt).toBeNull();
  });

  it('keeps a person’s Aadhaar and a driver’s Aadhaar as separate facts', async () => {
    stubWay2Api((path) =>
      path.endsWith('/aadhaar_pan_link_check') ? aadhaarLinked(VALID_PAN_MASKED) : notFound,
    );

    const response = await payAndVerify(driverUser, {
      kind: 'AADHAAR',
      subjectType: 'DRIVER',
      subjectId: driverId,
      number: VALID_AADHAAR,
      linkedPan: VALID_PAN,
    });

    expect(response.body.data.state).toBe('VERIFIED');
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(driver.aadhaarVerifiedAt).not.toBeNull();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: driverUser.id } });
    expect(user.aadhaarVerifiedAt).toBeNull();
  });

  it('records a company PAN on the organization', async () => {
    stubWay2Api((path) =>
      path.endsWith('/pan/verify') ? found({ pan: COMPANY_PAN, name: 'TEST ORG', status: 'VALID' }) : notFound,
    );

    const response = await payAndVerify(owner, {
      kind: 'PAN',
      subjectType: 'ORGANIZATION',
      subjectId: fleet.id,
      number: COMPANY_PAN,
    });

    expect(response.body.data.state).toBe('VERIFIED');
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: fleet.id } });
    expect(organization.panNumber).toBe(COMPANY_PAN);
    expect(organization.panVerifiedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The Aadhaar–PAN link check
// ---------------------------------------------------------------------------

describe('the Aadhaar–PAN link check', () => {
  const aadhaarForDriver = (linkedPan = VALID_PAN) => ({
    kind: 'AADHAAR',
    subjectType: 'DRIVER',
    subjectId: driverId,
    number: VALID_AADHAAR,
    linkedPan,
  });

  const stubLinkCheck = (answer: Way2ApiAnswer) =>
    stubWay2Api((path) => (path.endsWith('/aadhaar_pan_link_check') ? answer : notFound));

  it('verifies a linked Aadhaar from the documented answer, sending the Aadhaar alone', async () => {
    const fetchMock = stubLinkCheck(aadhaarLinked(VALID_PAN_MASKED));

    const response = await payAndVerify(owner, aadhaarForDriver());

    expect(response.body.data.state).toBe('VERIFIED');
    expect(response.body.data.charge?.status).toBe(VerificationChargeStatus.VERIFIED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(fetchMock)).toEqual({ aadhaar_number: VALID_AADHAAR });
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(driver.aadhaarVerifiedAt).not.toBeNull();
  });

  it('refuses an Aadhaar that is linked to a different PAN', async () => {
    stubLinkCheck(aadhaarLinked('EKXXXXXX6F'));

    const response = await payAndVerify(owner, aadhaarForDriver());

    expect(response.body.data.state).toBe('FAILED');
    expect(response.body.data.message).toContain('different PAN');
    const stored = await prisma.identityVerification.findFirstOrThrow({
      where: { subjectId: driverId, kind: 'AADHAAR' },
    });
    expect(stored.outcome).toBe('MISMATCH');
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(driver.aadhaarVerifiedAt).toBeNull();
  });

  it('reports the source’s own reason when the Aadhaar does not verify', async () => {
    stubLinkCheck(aadhaarRejected);

    const response = await payAndVerify(owner, aadhaarForDriver());

    expect(response.body.data.state).toBe('FAILED');
    expect(response.body.data.message).toBe('Invalid Aadhaar Number');
  });

  it('keeps the fee as a free retry when the Income Tax source is down', async () => {
    stubLinkCheck(sourceDown);

    const first = await payAndVerify(owner, aadhaarForDriver());
    expect(first.body.data.state).toBe('RETRY_REQUIRED');
    expect(first.body.data.charge?.freeRetryAvailable).toBe(true);
    const unverified = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(unverified.aadhaarVerifiedAt).toBeNull();

    stubLinkCheck(aadhaarLinked(VALID_PAN_MASKED));
    const retry = await payAndVerify(owner, aadhaarForDriver());

    expect(retry.body.data.state).toBe('VERIFIED');
    expect(await prisma.payment.count({ where: { purpose: PaymentPurpose.VERIFICATION_FEE } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// What is sent to Way2API, and how its answers are read
// ---------------------------------------------------------------------------

describe('Way2API identity checks, as documented', () => {
  it('sends a PAN alone, and compares the holder’s name itself', async () => {
    const fetchMock = stubWay2Api((path) =>
      path.endsWith('/pan/verify')
        ? documented({
            pan_number: VALID_PAN,
            full_name: 'TEST USER',
            pan_status: 'E',
            pan_status_desc: 'EXISTING AND VALID',
            aadhaar_seeding_status: 'Y',
            category: 'individual',
          })
        : notFound,
    );

    const response = await payAndVerify(owner, { ...panForDriver(), holderName: 'Test User' });

    expect(response.body.data.state).toBe('VERIFIED');
    expect(sentBody(fetchMock)).toEqual({ pan_number: VALID_PAN });
  });

  it('sends a Voter ID under `voter_id`', async () => {
    const fetchMock = stubWay2Api((path) =>
      path.endsWith('/voter-id/verify')
        ? documented({ epic_no: VALID_VOTER_ID, name: 'TEST USER', relation_name: 'TEST PARENT', gender: 'M', age: '30' })
        : notFound,
    );

    const response = await payAndVerify(owner, {
      kind: 'VOTER_ID',
      subjectType: 'DRIVER',
      subjectId: driverId,
      number: VALID_VOTER_ID,
    });

    expect(response.body.data.state).toBe('VERIFIED');
    expect(sentBody(fetchMock)).toEqual({ voter_id: VALID_VOTER_ID });
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(driver.voterIdVerifiedAt).not.toBeNull();
  });

  it('sends a GSTIN under `gst_number`', async () => {
    const fetchMock = stubWay2Api((path) =>
      path.endsWith('/gst/verify')
        ? documented({
            gstin: VALID_GSTIN,
            lgnm: 'TEST ORG',
            sts: 'Active',
            dty: 'Regular',
            rgdt: '16/05/2019',
            pradr: { addr: { bnm: 'PLOT 12', loc: 'ANDHERI', stcd: 'Maharashtra', pncd: '400053' } },
          })
        : notFound,
    );

    const response = await payAndVerify(owner, {
      kind: 'GST',
      subjectType: 'ORGANIZATION',
      subjectId: fleet.id,
      number: VALID_GSTIN,
    });

    expect(response.body.data.state).toBe('VERIFIED');
    expect(sentBody(fetchMock)).toEqual({ gst_number: VALID_GSTIN });
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: fleet.id } });
    expect(organization.gstVerifiedAt).not.toBeNull();
  });

  it('keeps the fee when the government source behind the provider is down', async () => {
    stubWay2Api(() => sourceDown);

    const response = await payAndVerify(owner, panForDriver());

    expect(response.body.data.state).toBe('RETRY_REQUIRED');
    expect(response.body.data.charge?.freeRetryAvailable).toBe(true);
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(driver.panVerifiedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Free retries for checks Saarthi misread
// ---------------------------------------------------------------------------

describe('free retries for misread checks', () => {
  const MIGRATION = path.resolve(
    __dirname,
    '../prisma/migrations/20260930140000_verification_misread_free_retry/migration.sql',
  );
  const UNCONFIRMED_LINK = 'The records service would not confirm the Aadhaar–PAN link. Left for a reviewer.';
  let sequence = 0;

  const seedCharge = (data: {
    checkType: 'AADHAAR' | 'PAN' | 'VOTER_ID' | 'GST' | 'VEHICLE_RC';
    status?: 'FAILED' | 'VERIFIED' | 'RETRY_REQUIRED' | 'PAYMENT_FAILED';
    reason: string | null;
    subjectType?: 'DRIVER' | 'ORGANIZATION' | 'TRUCK';
    subjectId?: string;
    createdAt?: Date;
  }) =>
    prisma.verificationCharge.create({
      data: {
        checkType: data.checkType,
        subjectType: data.subjectType ?? 'DRIVER',
        subjectId: data.subjectId ?? driverId,
        organizationId: fleet.id,
        requestedById: owner.id,
        status: data.status ?? 'FAILED',
        paymentReference: `TEST-MISREAD-${(sequence += 1)}`,
        customerPrice: 10,
        provider: 'WAY2API',
        pricingVersion: 'V1',
        reason: data.reason,
        providerBilled: true,
        paidAt: new Date(),
        completedAt: new Date(),
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
      },
    });

  const statusOf = async (id: string) =>
    (await prisma.verificationCharge.findUniqueOrThrow({ where: { id } })).status;

  const aadhaarStep = async () => {
    const response = await request<{ steps: { checkType: string | null; state: string }[] }>({
      method: 'GET',
      url: `/api/v1/verification-center?driverId=${driverId}`,
      user: owner,
    });
    return response.body.data.steps.find((step) => step.checkType === 'AADHAAR');
  };

  it('re-credits only the attempts that were misread, and tells the payer', async () => {
    const aadhaarMisread = await seedCharge({ checkType: 'AADHAAR', reason: UNCONFIRMED_LINK });
    const voterMalformed = await seedCharge({ checkType: 'VOTER_ID', reason: 'No matching record found.' });
    const panSourceDown = await seedCharge({ checkType: 'PAN', reason: 'Record source temporarily unavailable.' });
    const panGenuine = await seedCharge({
      checkType: 'PAN',
      reason: 'The Income Tax Department has no record of this PAN. Check it against the card.',
    });
    const aadhaarGenuine = await seedCharge({
      checkType: 'AADHAAR',
      subjectType: 'ORGANIZATION',
      subjectId: fleet.id,
      reason: 'Invalid Aadhaar Number',
    });
    // Registry checks are outside this fix, whatever their reason says.
    const rc = await seedCharge({
      checkType: 'VEHICLE_RC',
      subjectType: 'TRUCK',
      subjectId: randomUUID(),
      reason: 'Record source temporarily unavailable.',
    });
    // A GSTIN verified on a later attempt has nothing left to retry.
    const gstSinceVerified = await seedCharge({
      checkType: 'GST',
      subjectType: 'ORGANIZATION',
      subjectId: fleet.id,
      reason: 'The GST portal has no record of this GSTIN.',
    });
    await seedCharge({ checkType: 'GST', subjectType: 'ORGANIZATION', subjectId: fleet.id, status: 'VERIFIED', reason: null });

    await prisma.$executeRawUnsafe(await readFile(MIGRATION, 'utf8'));

    expect(await statusOf(aadhaarMisread.id)).toBe('RETRY_REQUIRED');
    expect(await statusOf(voterMalformed.id)).toBe('RETRY_REQUIRED');
    expect(await statusOf(panSourceDown.id)).toBe('RETRY_REQUIRED');
    expect(await statusOf(panGenuine.id)).toBe('FAILED');
    expect(await statusOf(aadhaarGenuine.id)).toBe('FAILED');
    expect(await statusOf(rc.id)).toBe('FAILED');
    expect(await statusOf(gstSinceVerified.id)).toBe('FAILED');

    const notifications = await prisma.notification.findMany({ where: { userId: owner.id } });
    expect(notifications.map((row) => row.title).sort()).toEqual([
      'Aadhaar check can be retried free',
      'PAN check can be retried free',
      'Voter ID check can be retried free',
    ]);
    expect(notifications.every((row) => row.actionUrl === '/verification')).toBe(true);

    // The step offers the retry, and the retry runs without a new payment.
    expect((await aadhaarStep())?.state).toBe('RETRY_REQUIRED');
    stubWay2Api((path) =>
      path.endsWith('/aadhaar_pan_link_check') ? aadhaarLinked(VALID_PAN_MASKED) : notFound,
    );
    const retry = await payAndVerify(owner, {
      kind: 'AADHAAR',
      subjectType: 'DRIVER',
      subjectId: driverId,
      number: VALID_AADHAAR,
      linkedPan: VALID_PAN,
    });
    expect(retry.body.data.state).toBe('VERIFIED');
    expect(await prisma.payment.count({ where: { purpose: PaymentPurpose.VERIFICATION_FEE } })).toBe(0);
  });

  it('offers a kept fee even when a later attempt sits on top of it', async () => {
    await seedCharge({
      checkType: 'AADHAAR',
      status: 'RETRY_REQUIRED',
      reason: 'The verification service did not respond.',
      createdAt: new Date(Date.now() - 60_000),
    });
    await seedCharge({ checkType: 'AADHAAR', status: 'PAYMENT_FAILED', reason: 'The payment was not completed.' });

    expect((await aadhaarStep())?.state).toBe('RETRY_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// The wizard's steps
// ---------------------------------------------------------------------------

describe('the verification centre', () => {
  const stepsFor = async (user: TestUser, query = '') => {
    const response = await request<{ overall: string; steps: { id: string; state: string; price: { amount: number } | null }[] }>({
      method: 'GET',
      url: `/api/v1/verification-center${query}`,
      user,
    });
    expect(response.status).toBe(200);
    return response.body.data;
  };

  it('asks each account type for its own steps only', async () => {
    const personalOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    await prisma.organization.update({ where: { id: personalOrg.id }, data: { isPersonalSeat: true } });
    const person = await createUser({ role: RoleName.FLEET_OWNER, organizationId: personalOrg.id });
    const supplierOrg = await createOrganization(OrganizationType.SUPPLIER, PlanTier.SUPPLIER);
    const supplier = await createUser({ role: RoleName.SUPPLIER, organizationId: supplierOrg.id });
    const customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.FREE);
    const customer = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });

    const ids = async (user: TestUser) => (await stepsFor(user)).steps.map((step) => step.id);

    expect(await ids(driverUser)).toEqual(['driver-licence', 'driver-aadhaar', 'driver-voter-id', 'driver-pan']);
    expect(await ids(person)).toEqual(['personal-aadhaar']);
    expect(await ids(owner)).toEqual(['owner-aadhaar', 'company-pan', 'company-gst']);
    expect(await ids(supplier)).toEqual([
      'owner-aadhaar',
      'company-pan',
      'company-gst',
      'supplier-material-licence',
    ]);

    const customerView = await stepsFor(customer);
    expect(customerView.steps).toHaveLength(0);
    expect(customerView.overall).toBe('NOT_REQUIRED');
  });

  it('shows a step as verified only from persisted state, with its price', async () => {
    panVerified();
    const before = await stepsFor(owner, `?driverId=${driverId}`);
    const panBefore = before.steps.find((step) => step.id === 'driver-pan');
    expect(panBefore?.state).toBe('NOT_STARTED');
    expect(panBefore?.price?.amount).toBe(10);

    await payAndVerify(owner, panForDriver());

    const after = await stepsFor(owner, `?driverId=${driverId}`);
    expect(after.steps.find((step) => step.id === 'driver-pan')?.state).toBe('VERIFIED');
    expect(after.overall).toBe('IN_PROGRESS');
  });

  it('refuses another fleet’s driver', async () => {
    const response = await request({
      method: 'GET',
      url: `/api/v1/verification-center?driverId=${driverId}`,
      user: otherOwner,
    });
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Bypass attempts and records
// ---------------------------------------------------------------------------

describe('bypass attempts', () => {
  it('refuses to verify another organization’s driver, and charges nothing', async () => {
    const fetchMock = panVerified();

    const response = await payAndVerify(otherOwner, panForDriver());

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.payment.count()).toBe(0);
  });

  it('offers no way to mark a charge verified from the client', async () => {
    const fetchMock = stubWay2Api(() => notFound);
    const started = await payAndVerify(owner, panForDriver(OTHER_PAN));
    const chargeId = started.body.data.charge!.id;

    for (const method of ['PATCH', 'PUT'] as const) {
      const response = await request({
        method,
        url: `/api/v1/verification-center/charges/${chargeId}`,
        user: owner,
        payload: { status: 'VERIFIED' },
      });
      expect(response.status).toBe(404);
    }
    const charge = await prisma.verificationCharge.findUniqueOrThrow({ where: { id: chargeId } });
    expect(charge.status).toBe(VerificationChargeStatus.FAILED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps one organization’s charges from another', async () => {
    panVerified();
    const started = await payAndVerify(owner, panForDriver());

    const response = await request({
      method: 'GET',
      url: `/api/v1/verification-center/charges/${started.body.data.charge!.id}`,
      user: otherOwner,
    });
    expect(response.status).toBe(404);
  });
});

describe('records', () => {
  it('shows the customer what they paid, and only an admin what it cost', async () => {
    panVerified();
    await payAndVerify(owner, panForDriver());

    const history = await request<Record<string, unknown>[]>({
      method: 'GET',
      url: '/api/v1/verification-center/history',
      user: owner,
    });
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({ checkType: 'PAN', status: 'VERIFIED', amount: 10 });
    expect(history.body.data[0]).not.toHaveProperty('providerCost');

    const forbidden = await request({ method: 'GET', url: '/api/v1/verification-center/admin/economics', user: owner });
    expect(forbidden.status).toBe(403);

    const economics = await request<{ providerCost: number; customerPrice: number; provider: string }[]>({
      method: 'GET',
      url: '/api/v1/verification-center/admin/economics',
      user: admin,
    });
    expect(economics.status).toBe(200);
    expect(economics.body.data[0]).toMatchObject({ provider: 'WAY2API', providerCost: 0.0341, customerPrice: 10 });
  });
});
