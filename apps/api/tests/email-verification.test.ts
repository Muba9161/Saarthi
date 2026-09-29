import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlanTier, RoleName, type RegistrationEmailCodeResult } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { TEST_PASSWORD, closeApp, getApp, request, resetDatabase, unique, uniquePhone } from './helpers';

/**
 * Registration email verification.
 *
 * Every account must prove it holds its mailbox with the code emailed at the
 * last registration step. These tests pass `emailCode` themselves, which is
 * what stops the shared `request` helper from minting one for them.
 */

const CODE_URL = '/api/v1/auth/register/email-code';
const REGISTER_URL = '/api/v1/auth/register';

function registration(email: string, emailCode?: string) {
  return {
    firstName: 'Meera',
    lastName: 'Iyer',
    email,
    phone: uniquePhone(),
    password: TEST_PASSWORD,
    role: RoleName.CUSTOMER,
    planTier: PlanTier.FREE,
    acceptedTerms: true,
    ...(emailCode !== undefined ? { emailCode } : {}),
  };
}

async function sendCode(email: string) {
  return request<RegistrationEmailCodeResult>({
    method: 'POST',
    url: CODE_URL,
    payload: { email, firstName: 'Meera' },
  });
}

/** A six-digit code guaranteed to differ from `code`. */
function wrongCode(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

describe('Registration email verification', () => {
  beforeAll(async () => {
    await resetDatabase();
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('sends a code, and hands it back only because no mailbox is configured', async () => {
    const email = `${unique('otp-send')}@test.local`;
    const { status, body } = await sendCode(email);

    expect(status).toBe(200);
    expect(body.data.sentTo).toBe(email.toLowerCase());
    expect(body.data.devCode).toMatch(/^\d{6}$/);
    expect(body.data.expiresIn).toBeGreaterThan(0);
    expect(body.data.resendIn).toBeGreaterThan(0);

    // Only a keyed hash is stored — never the code itself.
    const stored = await prisma.emailVerificationCode.findFirstOrThrow({
      where: { email: email.toLowerCase() },
    });
    expect(stored.codeHash).not.toContain(body.data.devCode);
  });

  it('refuses a second code inside the resend cooldown', async () => {
    const email = `${unique('otp-cooldown')}@test.local`;
    await sendCode(email);
    const second = await sendCode(email);

    expect(second.status).toBe(429);
    expect(second.body.error?.code).toBe('RATE_LIMITED');
  });

  it('refuses to send a code to an address that already has an account', async () => {
    const email = `${unique('otp-taken')}@test.local`;
    const created = await request({ method: 'POST', url: REGISTER_URL, payload: registration(email) });
    expect(created.status).toBe(201);

    const { status, body } = await sendCode(email);
    expect(status).toBe(409);
    expect(body.error?.code).toBe('DUPLICATE_RESOURCE');
  });

  it('will not register without a code', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: registration(`${unique('otp-none')}@test.local`),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('will not register an address no code was sent to', async () => {
    const { status, body } = await request({
      method: 'POST',
      url: REGISTER_URL,
      payload: registration(`${unique('otp-unsent')}@test.local`, '123456'),
    });

    expect(status).toBe(400);
    expect(body.error?.message).toMatch(/request a verification code/i);
  });

  it('rejects a wrong code, then accepts the right one and marks the email verified', async () => {
    const email = `${unique('otp-ok')}@test.local`;
    const code = (await sendCode(email)).body.data.devCode!;

    const wrong = await request({
      method: 'POST',
      url: REGISTER_URL,
      payload: registration(email, wrongCode(code)),
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error?.message).toMatch(/not right/i);

    const right = await request<{ session: { user: { id: string } } }>({
      method: 'POST',
      url: REGISTER_URL,
      payload: registration(email, code),
    });
    expect(right.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: right.body.data.session.user.id } });
    expect(user.emailVerifiedAt).not.toBeNull();

    const spent = await prisma.emailVerificationCode.findFirstOrThrow({
      where: { email: email.toLowerCase() },
      orderBy: { createdAt: 'desc' },
    });
    expect(spent.consumedAt).not.toBeNull();
  });

  it('stops accepting a code after five wrong guesses, even the right one', async () => {
    const email = `${unique('otp-guess')}@test.local`;
    const code = (await sendCode(email)).body.data.devCode!;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request({ method: 'POST', url: REGISTER_URL, payload: registration(email, wrongCode(code)) });
    }

    const { status, body } = await request({
      method: 'POST',
      url: REGISTER_URL,
      payload: registration(email, code),
    });
    expect(status).toBe(400);
    expect(body.error?.message).toMatch(/too many incorrect attempts/i);
  });

  it('keeps the code usable when registration fails for another reason', async () => {
    const email = `${unique('otp-retry')}@test.local`;
    const code = (await sendCode(email)).body.data.devCode!;

    // Somebody else already holds this mobile number.
    const taken = registration(`${unique('otp-phone')}@test.local`);
    expect((await request({ method: 'POST', url: REGISTER_URL, payload: taken })).status).toBe(201);

    const clash = await request({
      method: 'POST',
      url: REGISTER_URL,
      payload: { ...registration(email, code), phone: taken.phone },
    });
    expect(clash.status).toBe(409);

    // The transaction rolled back, so the same code still opens the account.
    const retry = await request({ method: 'POST', url: REGISTER_URL, payload: registration(email, code) });
    expect(retry.status).toBe(201);
  });

  it('refuses a code that has expired', async () => {
    const email = `${unique('otp-expired')}@test.local`;
    const code = (await sendCode(email)).body.data.devCode!;
    await prisma.emailVerificationCode.updateMany({
      where: { email: email.toLowerCase() },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const { status, body } = await request({
      method: 'POST',
      url: REGISTER_URL,
      payload: registration(email, code),
    });
    expect(status).toBe(400);
    expect(body.error?.message).toMatch(/expired/i);
  });
});
