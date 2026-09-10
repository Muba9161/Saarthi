import { randomInt } from 'node:crypto';
import {
  ACTIVE_TERMINAL_SESSION_STATUSES,
  AUTHORIZED_TERMINAL_SESSION_STATUSES,
  DeviceAssignmentStatus,
  DeviceRole,
  DeviceType,
  TERMINAL_PAIRING_CODE_PREFIX,
  TerminalSessionStatus,
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
import { assertTenantAccess } from '../../server/guards';
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
  /**
   * Whether the pairing this creates ends with the driver's shift.
   *
   * False for the fitted-tablet path, which is every caller but one: a tablet
   * is bolted to the truck and stays with it between drivers. True only for a
   * driver's own phone — see `vehiclePairingForApprovedDriver`.
   */
  releaseOnSignOff = false,
): Promise<IssuedTerminalPairing> {
  const issued = await createPairingToken(
    auth,
    vehicleId,
    {
      deviceType: DeviceType.VEHICLE_TERMINAL,
      releaseOnSignOff,
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

/**
 * A driver's own phone claiming the vehicle it was just approved onto.
 *
 * The fitted-tablet story starts with a fitter: somebody with `TERMINAL_MANAGE`
 * generates a code on the vehicle's Hardware screen and carries it to the cab.
 * That is right for a tablet bolted into a truck and wrong for a driver holding
 * their own phone, who would have to telephone the office before every shift —
 * which is the whole thing the driver app exists to remove.
 *
 * So the approval *is* the authorisation. A fleet that has looked at this
 * driver's selfie and approved them onto this truck has already made the
 * decision a pairing code would be asking them to make again, and nothing here
 * can be reached without that approval having happened first.
 *
 * The token is short-lived and single-use like any other. It is minted, handed
 * to the phone that asked, and redeemed seconds later through the ordinary
 * device pairing endpoint — so a driver's phone becomes the vehicle's terminal
 * by exactly the same path a tablet does, with the same slot rules and the same
 * audit trail.
 */
export async function vehiclePairingForApprovedDriver(
  auth: AuthContext,
  sessionId: string,
  apiUrl: string,
): Promise<IssuedTerminalPairing> {
  const session = await prisma.terminalSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      vehicleId: true,
      driverUserId: true,
      organizationId: true,
      vehicle: { select: { registrationNumber: true } },
    },
  });
  if (!session) throw errors.notFound('Sign-on request');

  /*
   * The driver's own request, and nobody else's.
   *
   * Not a permission check — every driver holds `TERMINAL_DRIVE` — but an
   * ownership one. Without it, any driver who learned a session id could pair
   * their phone to somebody else's truck, and the fleet would see an approval
   * they recognised attached to a device they did not.
   */
  if (session.driverUserId !== auth.user.id) {
    throw errors.forbidden('That sign-on request belongs to another driver.');
  }
  assertTenantAccess(auth, session.organizationId, 'Sign-on request');

  if (!AUTHORIZED_TERMINAL_SESSION_STATUSES.includes(session.status as TerminalSessionStatus)) {
    throw errors.businessRule(
      `Your request for ${session.vehicle.registrationNumber} has not been approved yet. ` +
        'Wait for the fleet to approve it before connecting.',
    );
  }

  await releaseAbandonedDriverPhone(session.vehicleId, session.driverUserId);

  return createTerminalPairing(
    auth,
    session.vehicleId,
    {
      // Minutes, not hours. The phone redeems this in the same breath as asking
      // for it; a token that outlives the screen it was made for is a token
      // that can be used somewhere else.
      ttlSeconds: DRIVER_PAIRING_TTL_SECONDS,
      note: 'Driver app, on approval',
    },
    apiUrl,
    // The one caller that sets this. A phone holds the vehicle only for the
    // shift it was approved for.
    true,
  );
}

/**
 * Free the vehicle from a driver's phone that is never coming back.
 *
 * A vehicle may have only one telemetry source, and a driver's phone takes that
 * slot when it pairs. The slot is handed back at sign-off — but a driver who
 * reinstalls the app, clears its data, loses the handset or replaces it never
 * signs off, so the assignment stays ACTIVE against a device that no longer
 * exists. The next approval then cannot pair at all: the request is refused with
 * "already reports its position from …", the phone never becomes the terminal,
 * and the driver is left on a dashboard with no cockpit and no way to start a
 * shift. Re-scanning does not help, because the obstacle is not the scan.
 *
 * So the stale pairing is released here, and the rules are narrow:
 *
 *  * **Only a phone.** `releaseOnSignOff` marks an assignment created by the
 *    driver app for one shift. A fitted tablet is bolted into a cab and shared
 *    between drivers; releasing one would strand the vehicle for everybody who
 *    comes after, which is the same rule sign-off already protects.
 *  * **Only when nobody is on it.** If another driver holds a live session on
 *    that device they are mid-shift, and taking the vehicle from underneath them
 *    is worse than refusing this pairing. The caller's existing conflict stands
 *    in that case.
 *  * **Only this vehicle.**
 *
 * Best-effort by nature: if it releases nothing, `createTerminalPairing` refuses
 * exactly as it did before.
 */
async function releaseAbandonedDriverPhone(
  vehicleId: string,
  driverUserId: string,
): Promise<void> {
  const holders = await prisma.deviceAssignment.findMany({
    where: {
      vehicleId,
      status: DeviceAssignmentStatus.ACTIVE,
      // Never a fitted tablet.
      releaseOnSignOff: true,
      device: { role: DeviceRole.TELEMETRY },
    },
    select: { id: true, deviceId: true },
  });
  if (holders.length === 0) return;

  const deviceIds = holders.map((holder) => holder.deviceId);

  /*
   * Somebody else's live shift on one of these devices. Read across all the
   * candidates at once rather than per device, so this stays one query however
   * many an odd history has left behind.
   */
  const inUse = await prisma.terminalSession.findMany({
    where: {
      terminalDeviceId: { in: deviceIds },
      status: { in: ACTIVE_TERMINAL_SESSION_STATUSES },
      driverUserId: { not: driverUserId },
    },
    select: { terminalDeviceId: true },
  });
  const busy = new Set(inUse.map((session) => session.terminalDeviceId));

  const abandoned = holders.filter((holder) => !busy.has(holder.deviceId));
  if (abandoned.length === 0) return;

  const released = await prisma.deviceAssignment.updateMany({
    where: { id: { in: abandoned.map((holder) => holder.id) } },
    data: {
      status: DeviceAssignmentStatus.ENDED,
      unassignedAt: new Date(),
      unassignedById: driverUserId,
      removalReason: 'Replaced by the same driver signing on from another phone.',
    },
  });

  pairingLogger.info(
    { vehicleId, released: released.count, deviceIds: abandoned.map((h) => h.deviceId) },
    'Released an abandoned driver phone so the vehicle could be paired again',
  );
}

/** How long a driver's self-issued pairing token lives. */
const DRIVER_PAIRING_TTL_SECONDS = 600;
