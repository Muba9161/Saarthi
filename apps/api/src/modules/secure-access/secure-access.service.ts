import {
  SECURE_UNLOCK_SECONDS,
  type SecureAccessStatus,
  type SetSecurePinInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';
import { passwordHasher } from '../../auth/password';
import { errors } from '../../lib/errors';
import type { AuthContext } from '../../auth/context';
import { sendSecurityNotice } from './security-notice';

/**
 * Secure access — the 4-digit PIN (or a device passkey) that opens sensitive
 * details for a few minutes on the session that entered it.
 *
 * It answers "is the account holder at the keyboard?", which a signed-in
 * session alone does not: a phone left unlocked on a dashboard, a shared
 * office laptop, a stolen token. It deliberately does not answer "does this
 * account own the vehicle" — that is `vehicle-ownership.service.ts` — and
 * neither gate stands in for the other.
 *
 *  * The PIN is hashed like a password and never stored or logged in plain.
 *  * Setting or changing it takes the account password.
 *  * Five wrong PINs lock it for fifteen minutes, and the owner is emailed.
 *  * An unlock lives server-side, keyed by session, for `SECURE_UNLOCK_SECONDS`.
 *    The browser holds nothing it could forge, and signing out ends it.
 */

const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MS = 15 * 60_000;

interface UnlockGrant {
  userId: string;
  until: string;
}

// ---------------------------------------------------------------------------
// Unlock grants
// ---------------------------------------------------------------------------

async function unlockedUntil(auth: AuthContext): Promise<Date | null> {
  const grant = await cache.get<UnlockGrant>(cacheKeys.secureUnlock(auth.sessionId));
  if (!grant || grant.userId !== auth.user.id) return null;
  const until = new Date(grant.until);
  return until.getTime() > Date.now() ? until : null;
}

/** Open sensitive details on this session. Called by every successful PIN or passkey entry. */
export async function grantUnlock(auth: AuthContext): Promise<Date> {
  const until = new Date(Date.now() + SECURE_UNLOCK_SECONDS * 1000);
  await cache.set<UnlockGrant>(
    cacheKeys.secureUnlock(auth.sessionId),
    { userId: auth.user.id, until: until.toISOString() },
    SECURE_UNLOCK_SECONDS,
  );
  return until;
}

export async function isUnlocked(auth: AuthContext): Promise<boolean> {
  return (await unlockedUntil(auth)) !== null;
}

/**
 * Refuse a sensitive action until this session has entered the PIN or a
 * passkey. The error carries whether a PIN exists, so the client knows to
 * offer "Set up a PIN" rather than "Enter your PIN".
 */
export async function assertUnlocked(auth: AuthContext, action: string): Promise<void> {
  if (await isUnlocked(auth)) return;
  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { securePinHash: true },
  });
  const pinSet = Boolean(user?.securePinHash);
  throw errors.secureAccessRequired(
    pinSet
      ? `Enter your secure PIN to ${action}.`
      : `Set up a secure PIN first — it is what lets you ${action}.`,
    { pinSet },
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function secureAccessStatus(auth: AuthContext): Promise<SecureAccessStatus> {
  const [user, passkeys, until] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: { securePinHash: true, securePinLockedUntil: true },
    }),
    prisma.userPasskey.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    }),
    unlockedUntil(auth),
  ]);

  const lockedUntil =
    user.securePinLockedUntil && user.securePinLockedUntil.getTime() > Date.now()
      ? user.securePinLockedUntil.toISOString()
      : null;

  return {
    pinSet: Boolean(user.securePinHash),
    pinLockedUntil: lockedUntil,
    unlockedUntil: until?.toISOString() ?? null,
    passkeys: passkeys.map((passkey) => ({
      id: passkey.id,
      label: passkey.label,
      createdAt: passkey.createdAt.toISOString(),
      lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// PIN
// ---------------------------------------------------------------------------

/**
 * Set or change the PIN. The account password is the proof, both the first
 * time and after a forgotten PIN — a session on its own could belong to
 * whoever picked the phone up.
 */
export async function setSecurePin(auth: AuthContext, input: SetSecurePinInput): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: { passwordHash: true, securePinHash: true },
  });
  if (!(await passwordHasher.verify(input.password, user.passwordHash))) {
    throw errors.validation('That is not your account password.', {
      fields: { password: ['That is not your account password.'] },
    });
  }

  await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      securePinHash: await passwordHasher.hash(input.pin),
      securePinSetAt: new Date(),
      securePinFailures: 0,
      securePinLockedUntil: null,
    },
  });

  sendSecurityNotice(auth.user, {
    subject: user.securePinHash ? 'Your secure PIN was changed' : 'Your secure PIN is set up',
    intro: user.securePinHash
      ? 'The secure PIN on your VorldX Saarthi account was just changed. It unlocks full RC details and sensitive settings.'
      : 'You just set up a secure PIN on your VorldX Saarthi account. It unlocks full RC details and sensitive settings.',
  });
}

/** Check the PIN and, if it is right, open sensitive details on this session. */
export async function unlockWithPin(auth: AuthContext, pin: string): Promise<Date> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: { securePinHash: true, securePinFailures: true, securePinLockedUntil: true },
  });

  if (!user.securePinHash) {
    throw errors.businessRule('Set up a secure PIN first.');
  }
  if (user.securePinLockedUntil && user.securePinLockedUntil.getTime() > Date.now()) {
    throw errors.forbidden(
      'Too many wrong PINs. Your PIN is locked for a few minutes — try again later, or reset it with your account password.',
    );
  }

  if (await passwordHasher.verify(pin, user.securePinHash)) {
    if (user.securePinFailures > 0 || user.securePinLockedUntil) {
      await prisma.user.update({
        where: { id: auth.user.id },
        data: { securePinFailures: 0, securePinLockedUntil: null },
      });
    }
    return grantUnlock(auth);
  }

  const failures = user.securePinFailures + 1;
  const locked = failures >= MAX_PIN_FAILURES;
  await prisma.user.update({
    where: { id: auth.user.id },
    data: locked
      ? { securePinFailures: 0, securePinLockedUntil: new Date(Date.now() + PIN_LOCK_MS) }
      : { securePinFailures: failures },
  });

  if (locked) {
    sendSecurityNotice(auth.user, {
      subject: 'Your secure PIN was locked',
      intro: `Someone entered the wrong secure PIN ${MAX_PIN_FAILURES} times on your VorldX Saarthi account, so it has been locked for 15 minutes.`,
    });
    throw errors.forbidden(
      'Too many wrong PINs. Your PIN is locked for 15 minutes, and we have emailed you about it.',
    );
  }

  const left = MAX_PIN_FAILURES - failures;
  throw errors.validation(`That PIN is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, {
    fields: { pin: ['That PIN is not right.'] },
  });
}

/** Close sensitive details on this session now, rather than when the window runs out. */
export async function lock(auth: AuthContext): Promise<void> {
  await cache.delete(cacheKeys.secureUnlock(auth.sessionId));
}
