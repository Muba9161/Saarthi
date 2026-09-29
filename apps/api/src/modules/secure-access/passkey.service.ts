import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type {
  PasskeySignInInput,
  RegisterPasskeyInput,
  UnlockWithPasskeyInput,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { publicAppUrl } from '../../lib/public-url';
import type { AuthContext } from '../../auth/context';
import { assertUnlocked, grantUnlock } from './secure-access.service';
import { sendSecurityNotice } from './security-notice';

/**
 * Device passkeys — the fingerprint, face or Windows Hello alternative to
 * typing the secure PIN, and to typing a password at sign-in.
 *
 * Standard WebAuthn: the device keeps the private key and signs a one-time
 * challenge; Saarthi holds only the public key and a signature counter. Every
 * challenge lives server-side for the length of one ceremony and is spent the
 * moment it is answered, so a response cannot be replayed.
 *
 * Adding a passkey takes the PIN first. Otherwise a stolen session could
 * register the thief's own fingerprint and never need the PIN — or the
 * password — again.
 */

const passkeyLogger = logger.child({ module: 'passkeys' });

const CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_PASSKEYS = 10;

/** Who the passkey belongs to on the web: the app's domain, and the origins it is served from. */
export interface RelyingParty {
  rpId: string;
  origins: string[];
}

/**
 * The relying party for this request.
 *
 * A passkey is bound to a domain, so it has to be the one in the browser's
 * address bar. `publicAppUrl` already answers that safely — the configured
 * `FRONTEND_URL` in production, the tunnel or LAN address in development — so
 * a passkey works the same through a dev tunnel as on the real domain, and a
 * forged `Origin` can never choose the domain in production.
 */
export function relyingParty(request: FastifyRequest): RelyingParty {
  const appOrigin = new URL(publicAppUrl(request)).origin;
  return {
    rpId: config.webAuthn.rpIdOverride ?? new URL(appOrigin).hostname,
    origins: [...new Set([appOrigin, ...config.webAuthn.origins])],
  };
}

async function takeChallenge(key: string): Promise<string> {
  const challenge = await cache.get<string>(key);
  // One use: a challenge that has been answered, rightly or wrongly, is spent.
  await cache.delete(key);
  if (!challenge) {
    throw errors.validation('That fingerprint or face request has expired. Please try again.');
  }
  return challenge;
}

/** Check a signed challenge against a stored passkey and advance its counter. */
async function verifyAssertion(
  party: RelyingParty,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  passkey: { id: string; credentialId: string; publicKey: Uint8Array; counter: number; transports: string[] },
): Promise<boolean> {
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: party.origins,
      expectedRPID: party.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
    });
    if (!verification.verified) return false;

    await prisma.userPasskey.update({
      where: { id: passkey.id },
      data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
    });
    return true;
  } catch (error) {
    passkeyLogger.info({ err: error }, 'Passkey assertion rejected');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function passkeyRegistrationOptions(
  auth: AuthContext,
  party: RelyingParty,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  await assertUnlocked(auth, 'add a fingerprint or face unlock');

  const existing = await prisma.userPasskey.findMany({
    where: { userId: auth.user.id },
    select: { credentialId: true, transports: true },
  });
  if (existing.length >= MAX_PASSKEYS) {
    throw errors.businessRule(`You can add up to ${MAX_PASSKEYS} devices. Remove one first.`);
  }

  const options = await generateRegistrationOptions({
    rpName: config.webAuthn.rpName,
    rpID: party.rpId,
    userName: auth.user.email,
    userDisplayName: `${auth.user.firstName} ${auth.user.lastName}`.trim(),
    userID: new TextEncoder().encode(auth.user.id),
    attestationType: 'none',
    // Never register the same authenticator twice.
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as AuthenticatorTransportFuture[],
    })),
    // The built-in sensor, verified by the person — a fingerprint or face, not
    // merely a tap. A resident key is what lets the same passkey sign in
    // without an email typed first.
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
  });

  await cache.set(
    cacheKeys.passkeyChallenge(auth.sessionId, 'register'),
    options.challenge,
    CHALLENGE_TTL_SECONDS,
  );
  return options;
}

export async function registerPasskey(
  auth: AuthContext,
  party: RelyingParty,
  input: RegisterPasskeyInput,
): Promise<void> {
  await assertUnlocked(auth, 'add a fingerprint or face unlock');
  const expectedChallenge = await takeChallenge(
    cacheKeys.passkeyChallenge(auth.sessionId, 'register'),
  );

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response as unknown as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: party.origins,
      expectedRPID: party.rpId,
      requireUserVerification: true,
    });
  } catch (error) {
    passkeyLogger.info({ err: error }, 'Passkey registration rejected');
    throw errors.validation('This device could not be added. Please try again.');
  }
  if (!verification.verified) {
    throw errors.validation('This device could not be added. Please try again.');
  }

  const { credential } = verification.registrationInfo;
  await prisma.userPasskey.create({
    data: {
      userId: auth.user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      label: input.label ?? null,
    },
  });

  sendSecurityNotice(auth.user, {
    subject: 'A device was added to your account',
    intro: `${input.label ? `"${input.label}"` : 'A new device'} can now sign in to your VorldX Saarthi account, and unlock full RC details and sensitive settings, with its fingerprint or face.`,
  });
}

export async function removePasskey(auth: AuthContext, passkeyId: string): Promise<void> {
  const { count } = await prisma.userPasskey.deleteMany({
    where: { id: passkeyId, userId: auth.user.id },
  });
  if (count === 0) throw errors.notFound('Device');
}

// ---------------------------------------------------------------------------
// Unlock — sensitive details on a session already signed in
// ---------------------------------------------------------------------------

export async function passkeyUnlockOptions(
  auth: AuthContext,
  party: RelyingParty,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const passkeys = await prisma.userPasskey.findMany({
    where: { userId: auth.user.id },
    select: { credentialId: true, transports: true },
  });
  if (passkeys.length === 0) {
    throw errors.businessRule('No fingerprint or face unlock is set up on this account yet.');
  }

  const options = await generateAuthenticationOptions({
    rpID: party.rpId,
    allowCredentials: passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as AuthenticatorTransportFuture[],
    })),
    userVerification: 'required',
  });

  await cache.set(
    cacheKeys.passkeyChallenge(auth.sessionId, 'unlock'),
    options.challenge,
    CHALLENGE_TTL_SECONDS,
  );
  return options;
}

export async function unlockWithPasskey(
  auth: AuthContext,
  party: RelyingParty,
  input: UnlockWithPasskeyInput,
): Promise<Date> {
  const expectedChallenge = await takeChallenge(
    cacheKeys.passkeyChallenge(auth.sessionId, 'unlock'),
  );
  const response = input.response as unknown as AuthenticationResponseJSON;

  // Scoped to this user: somebody else's passkey must not open this account.
  const passkey = await prisma.userPasskey.findFirst({
    where: { credentialId: response.id, userId: auth.user.id },
  });
  if (!passkey) throw errors.validation('This device is not set up to unlock your account.');

  if (!(await verifyAssertion(party, response, expectedChallenge, passkey))) {
    throw errors.validation(
      'That fingerprint or face check did not go through. Try again or use your PIN.',
    );
  }
  return grantUnlock(auth);
}

// ---------------------------------------------------------------------------
// Sign-in — no session yet
// ---------------------------------------------------------------------------

/**
 * Start a fingerprint or face sign-in.
 *
 * No email is asked for: the device offers the passkeys it holds for this
 * domain and the person picks theirs, so there is nothing here that tells a
 * stranger whether an address has an account. The challenge is keyed by a
 * random id handed back to the browser, since there is no session to key it by.
 */
export async function passkeySignInOptions(
  party: RelyingParty,
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const options = await generateAuthenticationOptions({
    rpID: party.rpId,
    userVerification: 'required',
  });
  const challengeId = randomUUID();
  await cache.set(
    cacheKeys.passkeySignInChallenge(challengeId),
    options.challenge,
    CHALLENGE_TTL_SECONDS,
  );
  return { challengeId, options };
}

/**
 * Finish a fingerprint or face sign-in: whose passkey signed the challenge.
 * Starting the session is the auth service's job, exactly as after a password.
 */
export async function verifyPasskeySignIn(
  party: RelyingParty,
  input: PasskeySignInInput,
): Promise<string> {
  const expectedChallenge = await takeChallenge(
    cacheKeys.passkeySignInChallenge(input.challengeId),
  );
  const response = input.response as unknown as AuthenticationResponseJSON;

  const passkey = await prisma.userPasskey.findUnique({ where: { credentialId: response.id } });
  if (!passkey || !(await verifyAssertion(party, response, expectedChallenge, passkey))) {
    throw errors.invalidCredentials(
      'That fingerprint or face is not set up to sign in here. Sign in with your password, then add this device under Secure PIN & fingerprint.',
    );
  }
  return passkey.userId;
}
