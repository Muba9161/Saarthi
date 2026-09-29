import crypto from 'node:crypto';
import {
  EMAIL_VERIFICATION_CODE_LENGTH,
  type RegistrationEmailCodeRequest,
  type RegistrationEmailCodeResult,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../database/prisma';
import { config } from '../config/env';
import { errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { emailConfigured, sendEmail } from '../providers/email/smtp-email';
import { codeEmail } from '../providers/email/code-email';

/**
 * Registration email verification.
 *
 * Nobody gets an account for an address they cannot read. The last step of
 * registration emails a short numeric code; `register` refuses to open the
 * account until that code comes back. That keeps mistyped and throwaway
 * addresses — and the spam accounts behind them — out of the platform.
 *
 * Only an HMAC of each code is stored, keyed with a server secret and bound to
 * the address, so a leaked table is neither a list of live codes nor something
 * a million guesses can reverse offline. Guessing online is capped per code,
 * and sending is capped per address on top of the per-IP route limit.
 */

const CODE_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const SEND_WINDOW_MS = 60 * 60_000;
const MAX_CODES_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;

function hashCode(email: string, code: string): string {
  return crypto
    .createHmac('sha256', config.auth.accessSecret)
    .update(`${email}:${code}`)
    .digest('hex');
}

function generateCode(): string {
  return crypto
    .randomInt(0, 10 ** EMAIL_VERIFICATION_CODE_LENGTH)
    .toString()
    .padStart(EMAIL_VERIFICATION_CODE_LENGTH, '0');
}

function codeError(message: string) {
  return errors.validation(message, { fields: { emailCode: [message] } });
}

/**
 * Mint and store a fresh code for `email`, with none of the sending rules.
 * Exported for the test harness, which has no mailbox to read a code from.
 */
export async function storeRegistrationEmailCode(
  email: string,
): Promise<{ id: string; code: string }> {
  const code = generateCode();
  const record = await prisma.emailVerificationCode.create({
    data: {
      email,
      codeHash: hashCode(email, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
    select: { id: true },
  });
  return { id: record.id, code };
}

/**
 * Email a registration code, enforcing the resend cooldown and hourly cap.
 *
 * An address that already has an account is refused here, the same way
 * `register` would refuse it, so nobody waits for a code they cannot use.
 * When the mail cannot be sent the code is withdrawn, so the cooldown does not
 * lock the person out of trying again.
 */
export async function sendRegistrationEmailCode(
  input: RegistrationEmailCodeRequest,
): Promise<RegistrationEmailCodeResult> {
  const { email } = input;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw errors.duplicate('An account already exists for this email address.', {
      fields: { email: ['An account already exists for this email address.'] },
    });
  }

  const recent = await prisma.emailVerificationCode.findMany({
    where: { email, createdAt: { gte: new Date(Date.now() - SEND_WINDOW_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const latest = recent[0];
  if (latest) {
    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - latest.createdAt.getTime());
    if (waitMs > 0) {
      throw errors.rateLimited(
        `Please wait ${Math.ceil(waitMs / 1000)} seconds before asking for another code.`,
      );
    }
  }
  if (recent.length >= MAX_CODES_PER_WINDOW) {
    throw errors.rateLimited(
      'Too many codes have been sent to this address. Please try again in an hour.',
    );
  }

  const { id, code } = await storeRegistrationEmailCode(email);
  const minutes = CODE_TTL_MS / 60_000;

  // Production always sends: with no mailbox configured `sendEmail` refuses,
  // and registration is closed rather than silently unverified.
  if (emailConfigured() || config.isProduction) {
    try {
      await sendEmail(
        codeEmail({
          to: email,
          subject: `${code} is your VorldX Saarthi verification code`,
          greeting: input.firstName ? `Hello ${input.firstName},` : 'Hello,',
          intro:
            'Use this code to confirm your email address and finish creating your ' +
            'VorldX Saarthi account.',
          code,
          footnote:
            `This code expires in ${minutes} minutes and works once. If you did not try ` +
            'to create an account, you can ignore this email.',
        }),
      );
    } catch (error) {
      await prisma.emailVerificationCode.delete({ where: { id } }).catch(() => undefined);
      throw error;
    }
  } else {
    logger.info({ email, code }, 'Registration email code generated (email is not configured)');
  }

  return {
    sentTo: email,
    expiresIn: CODE_TTL_MS / 1000,
    resendIn: RESEND_COOLDOWN_MS / 1000,
    // Only a developer with no mailbox needs the code handed back.
    ...(config.isProduction || emailConfigured() ? {} : { devCode: code }),
  };
}

/**
 * Check `code` against the latest one sent to `email`. Returns the code's id
 * for `consumeRegistrationEmailCode`; throws a field error on `emailCode`
 * otherwise. A wrong guess is counted outside any transaction, so a failed
 * registration cannot roll the count back.
 */
export async function verifyRegistrationEmailCode(email: string, code: string): Promise<string> {
  const record = await prisma.emailVerificationCode.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) throw codeError('Request a verification code for this email address first.');
  if (record.consumedAt) throw codeError('This code has already been used. Request a new one.');
  if (record.expiresAt.getTime() < Date.now()) {
    throw codeError('This code has expired. Request a new one.');
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    throw codeError('Too many incorrect attempts. Request a new code.');
  }

  const expected = Buffer.from(record.codeHash, 'hex');
  const given = Buffer.from(hashCode(email, code), 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    const attempts = record.attempts + 1;
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw codeError(
      attempts >= MAX_ATTEMPTS
        ? 'Too many incorrect attempts. Request a new code.'
        : 'That code is not right. Check the email we sent and try again.',
    );
  }

  return record.id;
}

/**
 * Spend a verified code inside the registration transaction, so a code is used
 * up only by an account that was actually created — and only once, even when
 * two submissions race.
 */
export async function consumeRegistrationEmailCode(
  tx: Prisma.TransactionClient,
  codeId: string,
): Promise<void> {
  const { count } = await tx.emailVerificationCode.updateMany({
    where: { id: codeId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (count === 0) throw codeError('This code has already been used. Request a new one.');
}
