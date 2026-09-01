import {
  DEVICE_PENDING_ENROLMENT_TTL_HOURS,
  DeviceType,
  type EnrolDeviceInput,
} from '@saarthi/shared';
import { isUniqueViolation, prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  generateDeviceSecret,
  hashDeviceSecret,
  signDeviceToken,
  type IssuedDeviceToken,
} from './device-auth';

/**
 * Device self-enrolment.
 *
 * The specification wants a phone to become a Saarthi device on its own, in the
 * field, without a platform administrator standing next to it. The obvious way
 * to do that — let the phone create a row inside somebody's fleet — is also the
 * wrong way: it is an unauthenticated write into tenant data, and nothing
 * afterwards can tell a real installation from a script.
 *
 * So enrolment produces an identity and nothing else. A `DeviceEnrolment` has a
 * real identifier and a real secret, and can do exactly two things with them:
 * read itself, and redeem a pairing token. It has no organization, no vehicle,
 * no telemetry and no reachable data. Only when an authorised person generates
 * a pairing QR from the dashboard, and this identity redeems it, does a
 * `HardwareDevice` come into existence — inside that person's fleet, with their
 * approval, and attributable to them.
 *
 * Everything that never gets claimed is swept away, so an open endpoint cannot
 * grow the database without bound.
 */

const enrolLogger = logger.child({ module: 'device-enrolment' });

const IDENTIFIER_PREFIX = 'SAARTHI-DEV';
const MAX_IDENTIFIER_ATTEMPTS = 8;

export interface EnrolmentResult {
  /** The identity the app displays on its first screen. */
  deviceIdentifier: string;
  enrolmentId: string;
  /**
   * The device secret, returned exactly once.
   *
   * Held in the phone's secure storage from here on, used only to buy access
   * tokens. It is never recoverable and never logged.
   */
  secret: string;
  token: IssuedDeviceToken;
  status: 'PENDING';
  expiresAt: string;
  /** What the app should tell the user to do next. */
  nextStep: string;
}

/**
 * Human-readable identifier, as the specification shows it.
 *
 * Numbered rather than random because a field engineer reads it off a screen
 * and types it into a support ticket. The count is recomputed on each attempt
 * so two phones enrolling at the same instant resolve by retry rather than by a
 * lock, and a handful of collisions is cheaper than serialising enrolment.
 */
async function nextDeviceIdentifier(attempt: number): Promise<string> {
  const [enrolled, registered] = await Promise.all([
    prisma.deviceEnrolment.count(),
    prisma.hardwareDevice.count({ where: { deviceIdentifier: { startsWith: IDENTIFIER_PREFIX } } }),
  ]);
  const ordinal = enrolled + registered + 1 + attempt;
  return `${IDENTIFIER_PREFIX}-${String(ordinal).padStart(3, '0')}`;
}

/**
 * Enrol a device, or return the identity this installation already holds.
 *
 * Re-enrolment is idempotent by installation id and deliberately so: an app
 * that is reinstalled, or that lost its token but kept its installation id,
 * must not accumulate a new pending identity every time it launches. A *new*
 * secret is issued, because the caller proved nothing — but the identity, and
 * therefore any pairing already made against it, is preserved.
 */
export async function enrolDevice(
  input: EnrolDeviceInput,
  context: { ipAddress: string | null },
): Promise<EnrolmentResult> {
  if (!config.device.selfEnrolmentEnabled) {
    throw errors.forbidden(
      'Device self-enrolment is switched off on this environment. Ask a Saarthi administrator to register this unit.',
    );
  }

  const expiresAt = new Date(
    Date.now() + config.device.enrolmentTtlHours * 60 * 60 * 1000,
  );
  const secret = generateDeviceSecret();
  const secretHash = await hashDeviceSecret(secret);

  const existing = await prisma.deviceEnrolment.findUnique({
    where: { installationId: input.installationId },
    select: { id: true, deviceIdentifier: true, status: true, deviceId: true },
  });

  if (existing) {
    // A claimed enrolment belongs to a real device now. Re-issuing a credential
    // for it here would let anyone holding the installation id take over a
    // paired unit, so it is refused and the app is told to use its own secret.
    if (existing.status === 'CLAIMED') {
      throw errors.conflict(
        'This installation is already paired to a vehicle. Sign in with the device credentials it was issued, or unpair it from the Saarthi dashboard first.',
      );
    }

    const refreshed = await prisma.deviceEnrolment.update({
      where: { id: existing.id },
      data: {
        secretHash,
        status: 'PENDING',
        expiresAt,
        platform: input.platform,
        deviceModel: input.deviceModel ?? null,
        osVersion: input.osVersion ?? null,
        appVersion: input.appVersion ?? null,
        deviceType: input.deviceType,
        ipAddress: context.ipAddress,
      },
      select: { id: true, deviceIdentifier: true, expiresAt: true },
    });

    enrolLogger.info(
      { deviceIdentifier: refreshed.deviceIdentifier, platform: input.platform },
      'Device enrolment credentials re-issued',
    );

    return buildResult(refreshed.id, refreshed.deviceIdentifier, secret, refreshed.expiresAt);
  }

  for (let attempt = 0; attempt < MAX_IDENTIFIER_ATTEMPTS; attempt += 1) {
    const deviceIdentifier = await nextDeviceIdentifier(attempt);
    try {
      const created = await prisma.deviceEnrolment.create({
        data: {
          installationId: input.installationId,
          deviceIdentifier,
          secretHash,
          deviceType: input.deviceType,
          platform: input.platform,
          deviceModel: input.deviceModel ?? null,
          osVersion: input.osVersion ?? null,
          appVersion: input.appVersion ?? null,
          ipAddress: context.ipAddress,
          expiresAt,
        },
        select: { id: true, deviceIdentifier: true, expiresAt: true },
      });

      enrolLogger.info(
        { deviceIdentifier: created.deviceIdentifier, platform: input.platform },
        'Device enrolled',
      );

      return buildResult(created.id, created.deviceIdentifier, secret, created.expiresAt);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Another enrolment took this number in the meantime. Try the next one.
    }
  }

  throw errors.conflict(
    'Could not allocate a device identifier just now. Please try again in a moment.',
  );
}

function buildResult(
  enrolmentId: string,
  deviceIdentifier: string,
  secret: string,
  expiresAt: Date,
): EnrolmentResult {
  return {
    deviceIdentifier,
    enrolmentId,
    secret,
    token: signDeviceToken({
      subject: enrolmentId,
      kind: 'PENDING_ENROLMENT',
      deviceIdentifier,
      // A pending enrolment has no rotation history, so its version is fixed.
      credentialVersion: 1,
    }),
    status: 'PENDING',
    expiresAt: expiresAt.toISOString(),
    nextStep:
      'Scan the pairing QR from Vehicle → Hardware in the Saarthi dashboard to connect this device to a vehicle.',
  };
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/**
 * Exchange a device secret for a short-lived access token.
 *
 * The secret stays in secure storage and travels twice a shift; the token
 * travels on every request and expires on its own. That split is what makes it
 * safe to put a credential on a phone that a driver carries into a workshop.
 */
export async function issueDeviceToken(
  caller:
    | { kind: 'DEVICE'; id: string; deviceIdentifier: string; credentialVersion: number }
    | { kind: 'PENDING_ENROLMENT'; id: string; deviceIdentifier: string },
): Promise<IssuedDeviceToken> {
  if (caller.kind === 'DEVICE') {
    const device = await prisma.hardwareDevice.update({
      where: { id: caller.id },
      data: { lastSeenAt: new Date() },
      select: { organizationId: true },
    });

    // An audit-trail write must never cost a working device its token, so this
    // is fired and forgotten rather than awaited.
    void prisma.deviceEvent
      .create({
        data: {
          deviceId: caller.id,
          organizationId: device.organizationId,
          eventType: 'TOKEN_ISSUED',
          description: 'A device access token was issued from the device secret.',
        },
      })
      .catch((error: unknown) =>
        enrolLogger.warn({ err: error, deviceId: caller.id }, 'Could not record token issue'),
      );

    return signDeviceToken({
      subject: caller.id,
      kind: 'DEVICE',
      deviceIdentifier: caller.deviceIdentifier,
      credentialVersion: caller.credentialVersion,
    });
  }

  return signDeviceToken({
    subject: caller.id,
    kind: 'PENDING_ENROLMENT',
    deviceIdentifier: caller.deviceIdentifier,
    credentialVersion: 1,
  });
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/**
 * Invalidate every access token a device currently holds.
 *
 * Called on secret rotation, suspension, retirement and unpairing. Raising the
 * version is what makes those decisions take effect now rather than at the next
 * token expiry — a stolen phone that has been unpaired must stop reporting on
 * its very next request, not fifteen minutes later.
 */
export async function revokeDeviceTokens(deviceId: string, reason: string): Promise<void> {
  const device = await prisma.hardwareDevice.update({
    where: { id: deviceId },
    data: { credentialVersion: { increment: 1 } },
    select: { deviceIdentifier: true, credentialVersion: true },
  });
  enrolLogger.info(
    { deviceIdentifier: device.deviceIdentifier, version: device.credentialVersion, reason },
    'Device access tokens revoked',
  );
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

/**
 * Remove enrolments nobody ever claimed.
 *
 * Self-enrolment is open, so this is not tidiness — it is the thing that stops
 * an anonymous endpoint from being a storage-exhaustion vector. Claimed
 * enrolments are kept: they are the provenance record for how a device that is
 * now carrying a fleet's telemetry came to exist.
 */
export async function runEnrolmentExpirySweep(): Promise<number> {
  const now = new Date();

  const expired = await prisma.deviceEnrolment.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });

  // Kept for a further window after expiry so a support question about a phone
  // that "would not pair yesterday" still has something to look at.
  const purgeBefore = new Date(
    now.getTime() - DEVICE_PENDING_ENROLMENT_TTL_HOURS * 60 * 60 * 1000,
  );
  const purged = await prisma.deviceEnrolment.deleteMany({
    where: { status: { in: ['EXPIRED', 'REVOKED'] }, expiresAt: { lt: purgeBefore } },
  });

  if (expired.count > 0 || purged.count > 0) {
    enrolLogger.info(
      { expired: expired.count, purged: purged.count },
      'Device enrolment sweep complete',
    );
  }
  return expired.count + purged.count;
}

/** Metrics for the platform-admin device screen. */
export async function enrolmentOverview(): Promise<{
  pending: number;
  claimed: number;
  expired: number;
  selfEnrolmentEnabled: boolean;
}> {
  const grouped = await prisma.deviceEnrolment.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const counts = new Map(grouped.map((row) => [row.status, row._count._all]));
  return {
    pending: counts.get('PENDING') ?? 0,
    claimed: counts.get('CLAIMED') ?? 0,
    expired: counts.get('EXPIRED') ?? 0,
    selfEnrolmentEnabled: config.device.selfEnrolmentEnabled,
  };
}

/** The device types a self-enrolling client may claim to be. */
export const SELF_ENROLLABLE_DEVICE_TYPES: DeviceType[] = [
  DeviceType.MOBILE_TEST_DEVICE,
  DeviceType.DASHCAM,
  DeviceType.GPS_TRACKER,
];
