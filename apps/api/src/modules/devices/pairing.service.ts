import { createHash, randomBytes } from 'node:crypto';
import {
  ACTIVE_TERMINAL_SESSION_STATUSES,
  AssignmentStatus,
  DEFAULT_DEVICE_ROLE,
  DEVICE_BUFFER,
  DEVICE_HEARTBEAT_INTERVAL_SECONDS,
  DeviceAssignmentStatus,
  DeviceEventType,
  DeviceProvider,
  DeviceRole,
  DeviceStatus,
  DeviceType,
  MOBILE_CAMERA_CHANNELS,
  MOBILE_DEVICE_METRICS,
  NotificationPriority,
  NotificationType,
  TerminalSessionStatus,
  VehicleCapability,
  VehicleType,
  resolveDeviceRole,
  vehicleSupports,
  type CreatePairingTokenInput,
  type DeviceConfigView,
  type DeviceIdentityView,
  type DevicePairingPayload,
  type PairDeviceInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { assertTenantAccess } from '../../server/guards';
import { notifyOrganization } from '../notifications/notification.service';
import { videoProvider } from '../../providers/video';
import { renderPayloadDataUri } from '../qr/qr-render.service';
import type { AuthContext } from '../../auth/context';
import { assertVehicleAcceptsRole } from './device.service';
import {
  signDeviceToken,
  type DeviceCaller,
  type IssuedDeviceToken,
} from './device-auth';
import { broadcastDeviceAssignment } from '../../realtime/realtime.service';

/**
 * QR vehicle-device pairing.
 *
 * The problem this solves is that a phone in a truck cab has no idea which
 * vehicle it is in, and must never be allowed to decide. So the decision is
 * made in the dashboard, by somebody who holds `devices.assign` on that fleet,
 * and travels to the phone as a short-lived bearer capability:
 *
 *     web (authorised person) → issues token for one vehicle
 *          → rendered as a QR
 *          → phone scans it, presents it with its own credentials
 *          → backend validates both, opens the assignment
 *
 * What makes it safe is what the token is *not*. It carries no vehicle id, no
 * registration, no driver, no fleet name and nothing commercial — a QR on a
 * screen is photographed by whoever walks past. Everything the pairing
 * discloses is decided here, at redemption, from the intersection of what the
 * token was issued for and what the device presenting it actually is.
 *
 * It is single-use, five minutes long by default, revocable, and stored only as
 * a hash.
 */

const pairingLogger = logger.child({ module: 'device-pairing' });

/** 32 bytes, base64url. Not derived from the vehicle id, deliberately. */
function generatePairingToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashPairingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Issuing — dashboard side
// ---------------------------------------------------------------------------

export interface PairingTokenView {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  deviceType: DeviceType;
  expiresAt: string;
  createdAt: string;
  consumedAt: string | null;
  consumedByDeviceIdentifier: string | null;
  revokedAt: string | null;
  note: string | null;
  /** Whether it can still be redeemed right now. */
  active: boolean;
}

export interface IssuedPairingToken extends PairingTokenView {
  /**
   * The raw token, returned exactly once so the dashboard can render the QR.
   *
   * Never stored, never returned by a list endpoint, never logged. Re-opening
   * the screen issues a fresh one rather than showing this again.
   */
  token: string;
  /** Exactly what the QR should encode. */
  qrPayload: DevicePairingPayload;
  /**
   * The rendered code, as a data URI ready for an `<img src>`.
   *
   * Rendered here rather than in the browser so the dashboard needs no QR
   * library, and — because it is an image rather than markup — so no component
   * has to inject HTML to display a credential.
   */
  qrImage: string;
  ttlSeconds: number;
}

/**
 * Issue a pairing token for one vehicle.
 *
 * The vehicle is validated before anything is created: a token pointing at an
 * archived vehicle, or at one that cannot take hardware at all, would be a QR
 * that fails in somebody's hand at the roadside for no discoverable reason.
 */
export async function createPairingToken(
  auth: AuthContext,
  vehicleId: string,
  input: CreatePairingTokenInput,
  /**
   * Where the scanning phone should send everything afterwards.
   *
   * Passed in rather than read from config because `API_URL` is
   * `http://localhost:4000` in every checkout, and localhost is the one address
   * a phone can never reach — on a phone, localhost is the phone. The route
   * derives this from the request, so a QR generated from a browser on the LAN
   * encodes the LAN address.
   */
  apiUrl: string,
): Promise<IssuedPairingToken> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: {
      id: true,
      organizationId: true,
      registrationNumber: true,
      vehicleType: true,
      archivedAt: true,
    },
  });
  if (!vehicle || vehicle.archivedAt) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  if (!vehicleSupports(vehicle.vehicleType as VehicleType, VehicleCapability.HARDWARE)) {
    throw errors.businessRule(
      `A ${vehicle.vehicleType.toLowerCase().replace(/_/g, ' ')} does not support connected hardware.`,
    );
  }

  // Refuse early if the slot this token would fill is already taken. Finding
  // out at redemption means a driver standing at a truck with a QR that will
  // never work, and no way to tell why.
  const role = DEFAULT_DEVICE_ROLE[deviceTypeToProvider(input.deviceType)] ?? DeviceRole.TELEMETRY;
  await assertVehicleAcceptsRole(vehicle.id, vehicle.registrationNumber, role);

  const ttlSeconds = input.ttlSeconds ?? config.device.pairingTokenTtlSeconds;
  const token = generatePairingToken();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  // Supersede anything still outstanding for this vehicle. Two live QRs for one
  // truck is how the wrong phone ends up fitted to it.
  await prisma.devicePairingToken.updateMany({
    where: {
      vehicleId: vehicle.id,
      consumedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { revokedAt: new Date(), revokedById: auth.user.id },
  });

  const record = await prisma.devicePairingToken.create({
    data: {
      organizationId: vehicle.organizationId,
      vehicleId: vehicle.id,
      tokenHash: hashPairingToken(token),
      deviceType: input.deviceType,
      createdById: auth.user.id,
      note: input.note ?? null,
      expiresAt,
    },
  });

  pairingLogger.info(
    { vehicleId: vehicle.id, deviceType: input.deviceType, ttlSeconds },
    'Device pairing token issued',
  );

  const qrPayload: DevicePairingPayload = {
    v: 1,
    kind: 'saarthi.device.pair',
    api: apiUrl,
    token,
  };

  return {
    ...toTokenView(record, vehicle.registrationNumber, null),
    token,
    ttlSeconds,
    qrPayload,
    qrImage: await renderPayloadDataUri(JSON.stringify(qrPayload), { size: 320 }),
  };
}

/**
 * The provider a self-enrolling client of this type will become.
 *
 * A phone is MOBILE; anything else self-enrolling is a generic tracker until a
 * platform administrator says otherwise. Kept as a function rather than a map
 * literal so an unhandled type is a compile error rather than a silent default.
 */
function deviceTypeToProvider(deviceType: DeviceType): DeviceProvider {
  switch (deviceType) {
    /*
     * A phone and a terminal are both MOBILE.
     *
     * A Saarthi Terminal is an Android device with the same sensor set as a
     * phone: real GPS, real camera, real motion, and an engine block that is
     * simulated until an OBD adapter is connected. MOBILE is the honest
     * provider, and it is what makes a terminal's readings carry the same
     * simulated-metric labelling everything downstream already understands.
     */
    case DeviceType.MOBILE_TEST_DEVICE:
    case DeviceType.VEHICLE_TERMINAL:
      return DeviceProvider.MOBILE;
    case DeviceType.DASHCAM:
    case DeviceType.MULTI_CAMERA:
      return DeviceProvider.YC06;
    case DeviceType.GPS_TRACKER:
      return DeviceProvider.GENERIC_GPS;
    case DeviceType.OBD_TELEMATICS:
      return DeviceProvider.GENERIC_OBD;
    case DeviceType.CAN_LOGGER:
    case DeviceType.J1939_LOGGER:
      return DeviceProvider.GENERIC_CAN;
    case DeviceType.OTHER:
    default:
      return DeviceProvider.GENERIC_GPS;
  }
}

function toTokenView(
  record: {
    id: string;
    vehicleId: string;
    deviceType: string;
    expiresAt: Date;
    createdAt: Date;
    consumedAt: Date | null;
    revokedAt: Date | null;
    note: string | null;
  },
  registrationNumber: string,
  consumedByDeviceIdentifier: string | null,
): PairingTokenView {
  return {
    id: record.id,
    vehicleId: record.vehicleId,
    registrationNumber,
    deviceType: record.deviceType as DeviceType,
    expiresAt: record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    consumedAt: record.consumedAt?.toISOString() ?? null,
    consumedByDeviceIdentifier,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    note: record.note,
    active:
      record.consumedAt === null &&
      record.revokedAt === null &&
      record.expiresAt.getTime() > Date.now(),
  };
}

/** Pairing history for one vehicle, newest first. Raw tokens are never here. */
export async function listPairingTokens(
  auth: AuthContext,
  vehicleId: string,
): Promise<PairingTokenView[]> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: { organizationId: true, registrationNumber: true },
  });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const records = await prisma.devicePairingToken.findMany({
    where: { vehicleId },
    include: { consumedByDevice: { select: { deviceIdentifier: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return records.map((record) =>
    toTokenView(record, vehicle.registrationNumber, record.consumedByDevice?.deviceIdentifier ?? null),
  );
}

export async function revokePairingToken(
  auth: AuthContext,
  tokenId: string,
): Promise<PairingTokenView> {
  const record = await prisma.devicePairingToken.findUnique({
    where: { id: tokenId },
    include: {
      vehicle: { select: { registrationNumber: true } },
      consumedByDevice: { select: { deviceIdentifier: true } },
    },
  });
  if (!record) throw errors.notFound('Pairing token');
  assertTenantAccess(auth, record.organizationId, 'Pairing token');

  if (record.consumedAt) {
    throw errors.businessRule(
      'This pairing code has already been used. Unpair the device from the vehicle instead.',
    );
  }

  const updated = await prisma.devicePairingToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date(), revokedById: auth.user.id },
    include: {
      vehicle: { select: { registrationNumber: true } },
      consumedByDevice: { select: { deviceIdentifier: true } },
    },
  });

  return toTokenView(
    updated,
    updated.vehicle.registrationNumber,
    updated.consumedByDevice?.deviceIdentifier ?? null,
  );
}

// ---------------------------------------------------------------------------
// Redemption — device side
// ---------------------------------------------------------------------------

export interface PairingResult {
  identity: DeviceIdentityView;
  config: DeviceConfigView;
  /**
   * A fresh access token for the device it has just become.
   *
   * Needed rather than merely convenient. A phone arrives here holding a
   * *pending enrolment* token, and the moment the enrolment is claimed that
   * token stops resolving — correctly, since the caller is now a device with a
   * different subject. Returning the replacement in the same response is what
   * keeps pairing a single round trip instead of a success followed by an
   * unexplained 401.
   */
  token: IssuedDeviceToken;
  /**
   * Fresh credentials, issued only when a pending enrolment was promoted *and*
   * its secret could not be carried across.
   *
   * Normally null: the enrolment's secret transfers to the device row
   * unchanged, so whatever the phone already has in secure storage keeps
   * working. Re-issuing on every pairing would mean a reassignment silently
   * invalidated a credential an operator may have recorded.
   */
  credentials: { deviceIdentifier: string; secret: string } | null;
}

/**
 * Redeem a pairing token.
 *
 * Serialised twice over, because two phones scanning the same QR within the
 * same second is a realistic thing to happen in a yard. A Redis claim decides
 * which one proceeds; the database transaction then re-checks every condition,
 * so correctness does not depend on the cache being available.
 */
export async function redeemPairingToken(
  caller: DeviceCaller,
  input: PairDeviceInput,
): Promise<PairingResult> {
  return redeemPairingTokenByHash(caller, hashPairingToken(input.token), input);
}

/**
 * The same redemption, for a caller that already holds the token hash.
 *
 * Exists for the Saarthi Terminal's typed pairing code. That code is a second
 * presentation of this same credential, looked up on its own column — and the
 * raw token genuinely cannot be recovered from it, because the raw token was
 * never stored. Rather than let the terminal path grow a parallel copy of the
 * transaction below (which is where single use, tenant isolation and the role
 * check actually live), it hands the hash in here and everything downstream is
 * byte-for-byte identical.
 *
 * `input.token` is ignored by this overload. Nothing outside this module and
 * `terminal-pairing.service.ts` should call it.
 */
export async function redeemPairingTokenByHash(
  caller: DeviceCaller,
  tokenHash: string,
  input: Omit<PairDeviceInput, 'token'>,
): Promise<PairingResult> {
  // Fast, best-effort mutual exclusion, held only for the length of the
  // transaction below. The transaction is what actually guarantees single use;
  // this exists so two phones scanning the same QR in the same second do not
  // both do the work.
  //
  // Released either way, success or failure. Holding it after a successful
  // pairing would make the next attempt read "another device is using this
  // code" when the truth is "this code has already been used" — same refusal,
  // but a materially worse thing to show somebody standing at a truck.
  const claimKey = cacheKeys.devicePairingClaim(tokenHash);
  const alreadyClaimed = await cache.get<string>(claimKey);
  if (alreadyClaimed && alreadyClaimed !== caller.deviceIdentifier) {
    throw errors.conflict('This pairing code is being used by another device right now.');
  }
  await cache.set(claimKey, caller.deviceIdentifier, cacheTtl.devicePairingClaim);

  try {
    return await pairWithinTransaction(caller, { ...input, token: '' }, tokenHash);
  } finally {
    await cache.delete(claimKey).catch(() => undefined);
  }
}

async function pairWithinTransaction(
  caller: DeviceCaller,
  input: PairDeviceInput,
  tokenHash: string,
): Promise<PairingResult> {
  const now = new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    const pairing = await tx.devicePairingToken.findUnique({
      where: { tokenHash },
      include: {
        vehicle: {
          select: {
            id: true,
            organizationId: true,
            registrationNumber: true,
            vehicleType: true,
            archivedAt: true,
          },
        },
      },
    });

    // Every failure below reads the same from outside. A device that could tell
    // "expired" from "never existed" could walk the token space and learn which
    // codes were real.
    if (!pairing) throw errors.notFound('Pairing code', 'This pairing code is not valid.');
    if (pairing.revokedAt) {
      throw errors.businessRule('This pairing code has been cancelled. Generate a new one.');
    }
    if (pairing.consumedAt) {
      throw errors.businessRule('This pairing code has already been used. Generate a new one.');
    }
    if (pairing.expiresAt.getTime() <= now.getTime()) {
      throw errors.businessRule('This pairing code has expired. Generate a new one.');
    }
    if (!pairing.vehicle || pairing.vehicle.archivedAt) throw errors.notFound('Vehicle');

    const vehicle = pairing.vehicle;

    // --- Resolve the device --------------------------------------------------
    let deviceId: string;

    if (caller.kind === 'PENDING_ENROLMENT') {
      if (caller.deviceType !== pairing.deviceType) {
        throw errors.businessRule(
          `This pairing code expects a ${pairing.deviceType.toLowerCase().replace(/_/g, ' ')}. ` +
            'Generate a code for this kind of device instead.',
        );
      }

      const provider = deviceTypeToProvider(caller.deviceType);
      const role = resolveDeviceRole(provider);
      await assertVehicleAcceptsRole(vehicle.id, vehicle.registrationNumber, role, tx);

      const enrolment = await tx.deviceEnrolment.findUnique({ where: { id: caller.id } });
      if (!enrolment || enrolment.status !== 'PENDING') {
        throw errors.unauthenticated('Device credentials were not recognised.');
      }

      // The enrolment's secret carries over unchanged, so whatever the phone
      // already holds in secure storage keeps working across the promotion.
      // Minting a new one here would mean pairing silently invalidated a
      // credential the device is mid-flight with.
      const device = await tx.hardwareDevice.create({
        data: {
          organizationId: vehicle.organizationId,
          deviceIdentifier: enrolment.deviceIdentifier,
          provider,
          deviceType: caller.deviceType,
          role,
          // A phone has no serial plate; its identifier is the honest stand-in.
          serialNumber: enrolment.deviceIdentifier,
          manufacturer: null,
          model: input.deviceModel ?? enrolment.deviceModel,
          secretHash: enrolment.secretHash,
          status: DeviceStatus.ACTIVE,
          selfEnrolled: true,
          platform: enrolment.platform,
          deviceModel: input.deviceModel ?? enrolment.deviceModel,
          osVersion: input.osVersion ?? enrolment.osVersion,
          appVersion: input.appVersion ?? enrolment.appVersion,
          reportingIntervalSeconds: config.device.defaultReportingIntervalSeconds,
          supportedMetrics:
            provider === DeviceProvider.MOBILE ? MOBILE_DEVICE_METRICS : [],
          observedMetrics: [],
          activatedAt: now,
        },
      });

      await tx.deviceEnrolment.update({
        where: { id: enrolment.id },
        data: { status: 'CLAIMED', claimedAt: now, deviceId: device.id },
      });

      await tx.deviceEvent.create({
        data: {
          deviceId: device.id,
          organizationId: vehicle.organizationId,
          eventType: DeviceEventType.ENROLLED,
          description: `Self-enrolled ${enrolment.platform} device promoted on pairing.`,
          metadata: { platform: enrolment.platform, model: enrolment.deviceModel },
        },
      });

      deviceId = device.id;
    } else {
      const device = await tx.hardwareDevice.findUnique({
        where: { id: caller.id },
        include: {
          assignments: {
            where: { status: DeviceAssignmentStatus.ACTIVE },
            include: { vehicle: { select: { registrationNumber: true } } },
            take: 1,
          },
        },
      });
      if (!device || device.archivedAt) throw errors.notFound('Device');

      if (device.organizationId !== vehicle.organizationId) {
        // Reported as an invalid code rather than a tenant mismatch: a device
        // must not be able to discover that a code belongs to another fleet.
        pairingLogger.warn(
          { deviceIdentifier: device.deviceIdentifier, vehicleId: vehicle.id },
          'Device attempted to redeem a pairing code from another organization',
        );
        throw errors.notFound('Pairing code', 'This pairing code is not valid.');
      }

      if (device.status === DeviceStatus.SUSPENDED || device.status === DeviceStatus.RETIRED) {
        throw errors.businessRule(
          `This device is ${device.status.toLowerCase()} and cannot be fitted to a vehicle.`,
        );
      }

      const current = device.assignments[0];
      if (current) {
        if (current.vehicleId === vehicle.id) {
          throw errors.businessRule(
            `This device is already paired to ${current.vehicle.registrationNumber}.`,
          );
        }
        throw errors.conflict(
          `This device is paired to ${current.vehicle.registrationNumber}. Unpair it there first.`,
        );
      }

      await assertVehicleAcceptsRole(
        vehicle.id,
        vehicle.registrationNumber,
        resolveDeviceRole(device.provider as DeviceProvider, device.role as DeviceRole),
        tx,
      );

      await tx.hardwareDevice.update({
        where: { id: device.id },
        data: {
          status: DeviceStatus.ACTIVE,
          activatedAt: device.activatedAt ?? now,
          ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
          ...(input.osVersion ? { osVersion: input.osVersion } : {}),
          ...(input.appVersion ? { appVersion: input.appVersion } : {}),
          reportingIntervalSeconds:
            device.reportingIntervalSeconds ?? config.device.defaultReportingIntervalSeconds,
        },
      });

      deviceId = device.id;
    }

    // --- Open the assignment -------------------------------------------------
    await tx.deviceAssignment.create({
      data: {
        deviceId,
        vehicleId: vehicle.id,
        organizationId: vehicle.organizationId,
        status: DeviceAssignmentStatus.ACTIVE,
        assignedById: pairing.createdById,
        installedAt: now,
        note: pairing.note ?? 'Paired by QR from the Saarthi Device app.',
      },
    });

    // Consumed inside the same transaction as the assignment it created, so the
    // token cannot be spent twice even under a lost cache.
    await tx.devicePairingToken.update({
      where: { id: pairing.id, consumedAt: null },
      data: { consumedAt: now, consumedByDeviceId: deviceId },
    });

    await tx.deviceEvent.create({
      data: {
        deviceId,
        organizationId: vehicle.organizationId,
        eventType: DeviceEventType.PAIRED,
        description: `Paired to ${vehicle.registrationNumber} by QR.`,
        actorUserId: pairing.createdById,
        metadata: { vehicleId: vehicle.id, pairingTokenId: pairing.id },
      },
    });

    return { deviceId, vehicle };
  });

  await registerClientCameras(outcome.deviceId, outcome.vehicle.organizationId);

  const identity = await deviceIdentity(outcome.deviceId);

  void notifyOrganization(outcome.vehicle.organizationId, {
    type: NotificationType.DEVICE_ASSIGNED,
    title: 'Device paired',
    body: `${identity.deviceIdentifier} is now reporting for ${outcome.vehicle.registrationNumber}.`,
    priority: NotificationPriority.NORMAL,
    actionUrl: `/devices/${outcome.deviceId}`,
    roles: ['FLEET_OWNER', 'FLEET_MANAGER'],
  });

  await broadcastDeviceAssignment(
    {
      deviceId: outcome.deviceId,
      deviceIdentifier: identity.deviceIdentifier,
      organizationId: outcome.vehicle.organizationId,
      vehicleId: outcome.vehicle.id,
      registrationNumber: outcome.vehicle.registrationNumber,
      deviceType: identity.deviceType,
      provider: identity.provider,
      assignedAt: identity.vehicle?.assignedAt ?? new Date().toISOString(),
      unassignedAt: null,
      reason: null,
    },
    true,
  );

  pairingLogger.info(
    { deviceIdentifier: identity.deviceIdentifier, vehicleId: outcome.vehicle.id },
    'Device paired to vehicle',
  );

  const device = await prisma.hardwareDevice.findUniqueOrThrow({
    where: { id: outcome.deviceId },
    select: { credentialVersion: true },
  });

  return {
    identity,
    config: await deviceConfig(outcome.deviceId),
    token: signDeviceToken({
      subject: outcome.deviceId,
      kind: 'DEVICE',
      deviceIdentifier: identity.deviceIdentifier,
      credentialVersion: device.credentialVersion,
    }),
    // Null in every path today: the enrolment's secret transfers to the device
    // row unchanged. The field exists because a future flow that *does* rotate
    // at pair time needs somewhere to return the replacement, and adding it
    // later would be a breaking change to a shipped device app.
    credentials: null,
  };
}

/**
 * Give an app-based device its camera channels.
 *
 * A phone has two lenses, and the dashboard should offer them the way it offers
 * a YC06's four: as cameras belonging to the vehicle, not as a special case. So
 * they are registered as ordinary `DeviceCamera` rows and everything already
 * built for multi-camera devices — the live-view ticket, the access log, the
 * vehicle passport panel — works unchanged.
 *
 * Best-effort: a camera registration failure must not undo a successful
 * pairing, because GPS is the more important half and it is already working.
 */
async function registerClientCameras(deviceId: string, organizationId: string): Promise<void> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: deviceId },
    select: { provider: true },
  });
  if (device?.provider !== DeviceProvider.MOBILE) return;

  for (const channel of MOBILE_CAMERA_CHANNELS) {
    if (channel.channel > config.video.maxCamerasPerDevice) continue;
    try {
      await prisma.deviceCamera.upsert({
        where: { deviceId_channel: { deviceId, channel: channel.channel } },
        create: {
          deviceId,
          organizationId,
          channel: channel.channel,
          position: channel.position,
          label: channel.label,
          // A phone records only while the app asks it to, so continuous
          // recording would be a claim the hardware cannot honour.
          continuousRecording: false,
          enabled: true,
        },
        update: {},
      });
    } catch (error) {
      pairingLogger.warn(
        { err: error, deviceId, channel: channel.channel },
        'Could not register a phone camera channel',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Unpairing — device side
// ---------------------------------------------------------------------------

/**
 * Release a device's own assignment.
 *
 * The mirror of the dashboard's unpair, available to the device so a driver
 * handing a phone back does not need somebody at a desk. The assignment row is
 * closed rather than deleted — it is what keeps last month's telemetry attached
 * to the vehicle that produced it.
 */
/**
 * Types a `devices.pair` holder may connect, and therefore disconnect.
 *
 * The same list `createPairingToken` accepts. Symmetry is the point: a fleet
 * that can connect a phone to its own truck without a support ticket must be
 * able to disconnect it the same way, or the first pairing is permanent and the
 * vehicle's one telemetry slot is occupied for ever.
 *
 * Fitted hardware stays out. A Freematics or a YC06 is a physical asset Saarthi
 * ships and tracks, and moving one between vehicles remains `devices.assign`.
 */
const SELF_PAIRABLE_TYPES: DeviceType[] = [
  DeviceType.MOBILE_TEST_DEVICE,
  // A Saarthi Terminal self-enrols like a phone, so it has to be removable like
  // one. Leaving it out made the vehicle's single telemetry slot a one-way
  // door: connect a terminal once and the vehicle could never take another,
  // which is precisely the failure the note above this list warns about.
  DeviceType.VEHICLE_TERMINAL,
  DeviceType.DASHCAM,
  DeviceType.GPS_TRACKER,
];

/**
 * Disconnect an app-based device from the dashboard.
 *
 * Distinct from `deviceService.unassignDevice`, which is the platform-admin
 * path for fitted hardware and refuses a fleet operator. This one is the mirror
 * of pairing: same permission, same device types, same tenant check.
 *
 * The assignment is closed rather than deleted, so telemetry recorded while the
 * device was on this vehicle still resolves to this vehicle years later.
 */
export async function unpairDeviceFromDashboard(
  auth: AuthContext,
  deviceId: string,
  reason: string | null,
): Promise<DeviceIdentityView> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: deviceId },
    select: { id: true, organizationId: true, deviceType: true, deviceIdentifier: true },
  });
  if (!device) throw errors.notFound('Device');
  assertTenantAccess(auth, device.organizationId, 'Device');

  if (!SELF_PAIRABLE_TYPES.includes(device.deviceType as DeviceType)) {
    throw errors.forbidden(
      `${device.deviceIdentifier} is fitted hardware, not an app-based device. ` +
        'Removing it from a vehicle is done by Saarthi support so the unit stays tracked.',
    );
  }

  return unpairSelf(deviceId, reason ?? `Unpaired from the Saarthi dashboard.`);
}

export async function unpairSelf(
  deviceId: string,
  reason: string | null,
): Promise<DeviceIdentityView> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: deviceId },
    include: {
      assignments: {
        where: { status: DeviceAssignmentStatus.ACTIVE },
        include: { vehicle: { select: { id: true, registrationNumber: true } } },
        take: 1,
      },
    },
  });
  if (!device) throw errors.notFound('Device');

  const assignment = device.assignments[0];
  if (!assignment) {
    throw errors.businessRule('This device is not currently paired to a vehicle.');
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.deviceAssignment.update({
      where: { id: assignment.id },
      data: {
        status: DeviceAssignmentStatus.ENDED,
        unassignedAt: now,
        removalReason: reason ?? 'Unpaired from the device.',
      },
    });
    await tx.hardwareDevice.update({
      where: { id: deviceId },
      data: {
        status: DeviceStatus.INACTIVE,
        // The unit must stop being able to report the moment it leaves the
        // vehicle, not when its current token happens to expire.
        credentialVersion: { increment: 1 },
        batteryPercent: null,
        batteryCharging: null,
        networkType: null,
        gpsStatus: null,
        cameraStatus: null,
        bufferedEvents: null,
      },
    });
    await tx.deviceEvent.create({
      data: {
        deviceId,
        organizationId: device.organizationId,
        eventType: DeviceEventType.UNPAIRED,
        description: `Unpaired from ${assignment.vehicle.registrationNumber} by the device${reason ? `: ${reason}` : '.'}`,
        metadata: { vehicleId: assignment.vehicleId },
      },
    });

    /*
     * Sign off any driver the terminal was carrying.
     *
     * Hardware leaving a vehicle has to take its driver authorisation with it.
     * Without this the session outlives the terminal: the approval queue keeps
     * listing a live driver, the vehicle keeps naming them, and neither screen
     * offers a way to end it — the terminal that would have signed them off is
     * no longer on the truck.
     *
     * Written inline rather than by calling `endSession`, because the terminal
     * session service imports this module; closing that cycle for four columns
     * would cost more than repeating them. It follows the same shape as the
     * sign-off path, and deliberately keeps its two narrowing guards:
     * the assignment ended is the one the *session* opened, and the driver
     * cleared is the one actually named — so a dispatcher's own assignment on
     * the same vehicle survives having a terminal unplugged.
     */
    const openSessions = await tx.terminalSession.findMany({
      where: {
        terminalDeviceId: deviceId,
        status: { in: ACTIVE_TERMINAL_SESSION_STATUSES },
      },
      select: { id: true, vehicleId: true, driverId: true, truckAssignmentId: true },
    });

    for (const session of openSessions) {
      if (session.truckAssignmentId) {
        await tx.truckAssignment.updateMany({
          where: { id: session.truckAssignmentId, status: AssignmentStatus.ACTIVE },
          data: { status: AssignmentStatus.ENDED, unassignedAt: now },
        });
        await tx.truck.updateMany({
          where: { id: session.vehicleId, currentDriverId: session.driverId },
          data: { currentDriverId: null },
        });
        await tx.driver.updateMany({
          where: { id: session.driverId, currentTruckId: session.vehicleId },
          data: { currentTruckId: null },
        });
      }

      // The session row itself is kept. It is the record of who was
      // authorised, by whom and when, and that outlives the hardware.
      await tx.terminalSession.update({
        where: { id: session.id },
        data: {
          status: TerminalSessionStatus.COMPLETED,
          endedAt: now,
          endReason: 'The terminal was disconnected from the vehicle.',
        },
      });
    }
  });

  await cache.delete(cacheKeys.deviceStatus(deviceId)).catch(() => undefined);

  void notifyOrganization(device.organizationId, {
    type: NotificationType.DEVICE_ASSIGNED,
    title: 'Device unpaired',
    body: `${device.deviceIdentifier} stopped reporting for ${assignment.vehicle.registrationNumber}.`,
    priority: NotificationPriority.NORMAL,
    actionUrl: `/devices/${deviceId}`,
    roles: ['FLEET_OWNER', 'FLEET_MANAGER'],
  });

  await broadcastDeviceAssignment(
    {
      deviceId,
      deviceIdentifier: device.deviceIdentifier,
      organizationId: device.organizationId,
      vehicleId: assignment.vehicleId,
      registrationNumber: assignment.vehicle.registrationNumber,
      deviceType: device.deviceType,
      provider: device.provider,
      assignedAt: assignment.assignedAt.toISOString(),
      unassignedAt: now.toISOString(),
      reason,
    },
    false,
  );

  return deviceIdentity(deviceId);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Everything the app needs for its home screen. */
export async function deviceIdentity(deviceId: string): Promise<DeviceIdentityView> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: deviceId },
    include: {
      assignments: {
        where: { status: DeviceAssignmentStatus.ACTIVE },
        include: {
          vehicle: { select: { id: true, registrationNumber: true, vehicleType: true } },
        },
        take: 1,
      },
      cameras: {
        where: { enabled: true },
        select: { id: true, channel: true, position: true, label: true },
        orderBy: { channel: 'asc' },
      },
    },
  });
  if (!device) throw errors.notFound('Device');

  const assignment = device.assignments[0];

  return {
    deviceId: device.id,
    deviceIdentifier: device.deviceIdentifier,
    provider: device.provider as DeviceProvider,
    deviceType: device.deviceType as DeviceType,
    role: device.role as DeviceRole,
    status: device.status,
    paired: assignment !== undefined,
    organizationId: device.organizationId,
    vehicle: assignment
      ? {
          id: assignment.vehicle.id,
          registrationNumber: assignment.vehicle.registrationNumber,
          vehicleType: assignment.vehicle.vehicleType,
          assignedAt: assignment.assignedAt.toISOString(),
        }
      : null,
    cameras: device.cameras.map((camera) => ({
      id: camera.id,
      channel: camera.channel,
      position: camera.position,
      label: camera.label,
    })),
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    lastTelemetryAt: device.lastTelemetryAt?.toISOString() ?? null,
  };
}

/**
 * The settings a device must obey.
 *
 * Server-owned on purpose. A phone that decided its own reporting interval
 * would be a phone a fleet cannot slow down when its data bill arrives, and a
 * device the operator cannot reconfigure without physically holding it.
 */
export async function deviceConfig(deviceId: string): Promise<DeviceConfigView> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: deviceId },
    select: { reportingIntervalSeconds: true },
  });

  return {
    reportingIntervalSeconds:
      device?.reportingIntervalSeconds ?? config.device.defaultReportingIntervalSeconds,
    heartbeatIntervalSeconds: DEVICE_HEARTBEAT_INTERVAL_SECONDS,
    // `supportsPublishing`, not `supportsLive`. They are different capabilities
    // and this is the device's question: an environment can display a recorder
    // the gateway dials out to while having nowhere for a phone to publish. A
    // device told otherwise opens its camera, burns battery and a driver's
    // mobile data, and sends frames into nothing.
    videoEnabled: videoProvider.supportsPublishing,
    simulationAllowed: config.device.simulationAllowed && !config.isProduction,
    maxBatchSize: DEVICE_BUFFER.maxBatchSize,
    maxBufferedEvents: DEVICE_BUFFER.maxEvents,
    environment: config.env,
    serverTime: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

/**
 * Retire pairing codes nobody redeemed.
 *
 * A pairing code is a bearer capability. Leaving spent and abandoned ones in an
 * indefinitely growing table is both a storage problem and a review problem —
 * an auditor asking "which codes are live right now" should get a short answer.
 */
export async function runPairingTokenSweep(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const removed = await prisma.devicePairingToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  if (removed.count > 0) {
    pairingLogger.info({ removed: removed.count }, 'Expired pairing codes purged');
  }
  return removed.count;
}
