import { randomInt } from 'node:crypto';
import {
  DeviceType,
  TERMINAL_PAIRING_CODE_PREFIX,
  normalizeTerminalPairingCode,
  type CreateTerminalPairingTokenInput,
  type PairTerminalInput,
  type TerminalPairingPayload,
} from '@saarthi/shared';
import { isUniqueViolation, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { renderPayloadDataUri } from '../qr/qr-render.service';
import {
  createPairingToken,
  redeemPairingTokenByHash,
  type PairingResult,
} from '../devices/pairing.service';
import type { DeviceCaller } from '../devices/device-auth';
import type { AuthContext } from '../../auth/context';

/**
 * Connecting a terminal to a vehicle.
 *
 * Deliberately a *thin* layer over `devices/pairing.service.ts` rather than a
 * second pairing system. The credential, the single-use rule, the five-minute
 * life, the hash at rest, the tenant check at redemption and the Redis claim
 * that serialises two tablets scanning the same screen are all the existing
 * ones. Two things are added, and only two:
 *
 *  1. **A human-typeable form of the same credential.** A terminal is a tablet
 *     bolted into a cab, often with a scratched digitiser and always in bad
 *     light. It has to be pairable when the camera will not focus, and reading
 *     a 43-character base64url token down a phone line is not a plan.
 *
 *  2. **Its own QR `kind`.** `saarthi.terminal.pair` rather than
 *     `saarthi.device.pair`, so the Saarthi Device app refuses a terminal's
 *     code before making a network call, and vice versa. The authoritative
 *     check is still the device-type comparison at redemption; this only makes
 *     the failure immediate and legible instead of a round trip and a 422.
 */

const pairingLogger = logger.child({ module: 'terminal-pairing' });

/**
 * Crockford base32, minus I, L, O and U.
 *
 * I/1, O/0 and L/1 are the pairs people mistype off a screen. U is dropped so a
 * random code cannot spell something that gets a support ticket opened about it.
 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_BODY_LENGTH = 8;
const MAX_CODE_ATTEMPTS = 6;

function generatePairingCode(): string {
  let body = '';
  for (let index = 0; index < CODE_BODY_LENGTH; index += 1) {
    body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return `${TERMINAL_PAIRING_CODE_PREFIX}-${body.slice(0, 4)}-${body.slice(4)}`;
}

export interface IssuedTerminalPairing {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  /** Always VEHICLE_TERMINAL. Present so one dialog can render either kind. */
  deviceType: string;
  /** The raw token, returned once. Never stored, never listed, never logged. */
  token: string;
  /** The same credential, typeable. Also returned once. */
  pairingCode: string;
  qrPayload: TerminalPairingPayload;
  /** Rendered code, ready for an `<img src>`. */
  qrImage: string;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * Issue a pairing credential for one vehicle's terminal.
 *
 * Vehicle validation, the hardware-capability check, supersession of any
 * outstanding code for that vehicle and the pairing history entry all happen
 * inside `createPairingToken`. This adds the short code and re-renders the QR
 * with the terminal payload.
 */
export async function createTerminalPairing(
  auth: AuthContext,
  vehicleId: string,
  input: CreateTerminalPairingTokenInput,
  apiUrl: string,
): Promise<IssuedTerminalPairing> {
  const issued = await createPairingToken(
    auth,
    vehicleId,
    {
      deviceType: DeviceType.VEHICLE_TERMINAL,
      ...(input.ttlSeconds !== undefined ? { ttlSeconds: input.ttlSeconds } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
    apiUrl,
  );

  // Attach the typeable form. Retried on collision rather than serialised: the
  // space is large, collisions are vanishingly rare, and a retry is cheaper
  // than a lock on an operation somebody is standing in a yard waiting for.
  let pairingCode: string | null = null;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const candidate = generatePairingCode();
    try {
      await prisma.devicePairingToken.update({
        where: { id: issued.id },
        data: { pairingCode: candidate },
      });
      pairingCode = candidate;
      break;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  if (!pairingCode) {
    // The QR would still work, so nothing is lost operationally — but a
    // terminal whose camera is broken now has no way in, and saying so is
    // better than handing back a screen with an empty code box on it.
    throw errors.conflict(
      'Could not allocate a pairing code just now. Generate the code again.',
    );
  }

  const qrPayload: TerminalPairingPayload = {
    v: 1,
    kind: 'saarthi.terminal.pair',
    api: apiUrl,
    token: issued.token,
  };

  pairingLogger.info(
    { vehicleId, ttlSeconds: issued.ttlSeconds },
    'Terminal pairing credential issued',
  );

  return {
    id: issued.id,
    vehicleId: issued.vehicleId,
    registrationNumber: issued.registrationNumber,
    deviceType: issued.deviceType,
    token: issued.token,
    pairingCode,
    qrPayload,
    qrImage: await renderPayloadDataUri(JSON.stringify(qrPayload), { size: 360 }),
    expiresAt: issued.expiresAt,
    ttlSeconds: issued.ttlSeconds,
  };
}

/**
 * The token hash a presented credential resolves to.
 *
 * A scanned token is hashed. A typed code is looked up on its own unique
 * column, because the raw token genuinely cannot be recovered from it — it was
 * never stored in the clear.
 *
 * The liveness checks here exist for the message, not the security: the real
 * ones run again inside the redemption transaction. A person in a cab needs to
 * read "that code has expired, ask for a new one" rather than a bare "not
 * valid", and by the time the transaction refuses it the distinction is gone.
 */
async function resolveTokenHash(input: PairTerminalInput): Promise<string> {
  if (input.token) {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(input.token).digest('hex');
  }

  const code = normalizeTerminalPairingCode(input.pairingCode ?? '');
  if (!code) {
    throw errors.validation('Enter the pairing code exactly as shown, STH-XXXX-XXXX.');
  }

  const record = await prisma.devicePairingToken.findUnique({
    where: { pairingCode: code },
    select: {
      tokenHash: true,
      deviceType: true,
      consumedAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  // An unknown code and a code for another kind of device read identically, so
  // this surface cannot be used to learn which codes exist.
  if (!record || record.deviceType !== DeviceType.VEHICLE_TERMINAL) {
    throw errors.notFound('Pairing code', 'That pairing code is not valid.');
  }
  if (record.revokedAt) {
    throw errors.businessRule('That pairing code has been cancelled. Generate a new one.');
  }
  if (record.consumedAt) {
    throw errors.businessRule('That pairing code has already been used. Generate a new one.');
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw errors.businessRule('That pairing code has expired. Generate a new one.');
  }

  return record.tokenHash;
}

/**
 * Redeem a terminal pairing credential.
 *
 * Both presented forms end in the same shared redemption, so a terminal and a
 * test phone pair through one code path with one set of rules. The only thing
 * that differs is how the hash was arrived at.
 */
export async function redeemTerminalPairing(
  caller: DeviceCaller,
  input: PairTerminalInput,
): Promise<PairingResult> {
  const tokenHash = await resolveTokenHash(input);

  return redeemPairingTokenByHash(caller, tokenHash, {
    ...(input.deviceModel !== undefined ? { deviceModel: input.deviceModel } : {}),
    ...(input.osVersion !== undefined ? { osVersion: input.osVersion } : {}),
    ...(input.appVersion !== undefined ? { appVersion: input.appVersion } : {}),
  });
}

/**
 * Terminal pairing credentials issued for one vehicle, newest first.
 *
 * Raw tokens and live codes are never included — a list endpoint that returned
 * a redeemable credential would make every fleet manager's screen a way to pair
 * somebody else's tablet.
 */
export async function listTerminalPairings(
  organizationId: string,
  vehicleId: string,
): Promise<
  {
    id: string;
    createdAt: string;
    expiresAt: string;
    consumedAt: string | null;
    revokedAt: string | null;
    note: string | null;
    active: boolean;
  }[]
> {
  const records = await prisma.devicePairingToken.findMany({
    where: { vehicleId, organizationId, deviceType: DeviceType.VEHICLE_TERMINAL },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      consumedAt: true,
      revokedAt: true,
      note: true,
    },
  });

  const now = Date.now();
  return records.map((record) => ({
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    consumedAt: record.consumedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    note: record.note,
    active:
      record.consumedAt === null &&
      record.revokedAt === null &&
      record.expiresAt.getTime() > now,
  }));
}
