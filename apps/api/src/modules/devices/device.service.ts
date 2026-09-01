import { randomBytes } from 'node:crypto';
import {
  ASSIGNABLE_DEVICE_STATUSES,
  DEVICE_OFFLINE_AFTER_MS,
  DeviceAssignmentStatus,
  DeviceEventType,
  DeviceProvider,
  DeviceRole,
  DeviceStatus,
  NotificationPriority,
  NotificationType,
  VehicleCapability,
  VehicleType,
  buildPaginationMeta,
  resolveDeviceRole,
  roleIsExclusivePerVehicle,
  vehicleSupports,
  type AssignDeviceInput,
  type DeviceListQuery,
  type Paginated,
  type RegisterDeviceInput,
  type TelemetryMetric,
  type UpdateDeviceInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { skipTake } from '../../lib/http';
import { passwordHasher, verifyWithTimingGuard } from '../../auth/password';
import { adapterFor } from '../../providers/devices';
import { notifyOrganization } from '../notifications/notification.service';
import { broadcastDeviceStatus } from '../../realtime/realtime.service';
import { assertTenantAccess } from '../../server/guards';
import type { AuthContext } from '../../auth/context';

/**
 * Hardware device management.
 *
 * The central idea, and section 20 of the spec: **the device is not the
 * vehicle.** A unit is owned by an organization, authenticates as itself, and
 * moves between vehicles over its life. Replacing a failed tracker closes one
 * assignment and opens another, so telemetry recorded last January still
 * resolves to the device that produced it rather than to whatever is fitted
 * today.
 *
 * Device credentials are treated like user passwords: the secret is shown once
 * at registration, stored only as a bcrypt hash, and rotatable. A device that
 * is suspended stops being able to submit telemetry immediately.
 */

const deviceLogger = logger.child({ module: 'devices' });

export interface DeviceSummary {
  id: string;
  organizationId: string;
  deviceIdentifier: string;
  provider: DeviceProvider;
  deviceType: string;
  /** Whether this unit is the vehicle's position source, a camera, or neither. */
  role: DeviceRole;
  serialNumber: string;
  /** Masked — an IMEI is enough to attempt a SIM swap. */
  imeiMasked: string | null;
  manufacturer: string | null;
  model: string | null;
  firmwareVersion: string | null;
  simMasked: string | null;
  simOperator: string | null;
  status: DeviceStatus;
  /** Metrics the unit is expected to report on its target vehicle. */
  supportedMetrics: TelemetryMetric[];
  /** Metrics Saarthi has actually seen from it — the honest capability list. */
  observedMetrics: TelemetryMetric[];
  assignedVehicle: {
    id: string;
    registrationNumber: string;
    vehicleType: VehicleType;
    assignedAt: string;
  } | null;
  lastSeenAt: string | null;
  lastTelemetryAt: string | null
  /** Seconds since the last reading, so the UI can show "quiet for 4 min". */
  silentForSeconds: number | null;
  readingCount: number;
  rejectedCount: number;
  openAlerts: number;
  notes: string | null;
  installedAt: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;

  /**
   * What an app-based device reports about itself.
   *
   * Every field is null for fitted hardware, which reports none of it. The UI
   * treats absence as "not applicable to this kind of unit" rather than as a
   * fault, because a Freematics has no battery percentage to be missing.
   */
  client: {
    selfEnrolled: boolean;
    platform: string | null;
    deviceModel: string | null;
    osVersion: string | null;
    appVersion: string | null;
    lastHeartbeatAt: string | null;
    batteryPercent: number | null;
    batteryCharging: boolean | null;
    networkType: string | null;
    gpsStatus: string | null;
    cameraStatus: string | null;
    bufferedEvents: number | null;
    reportingIntervalSeconds: number | null;
  };
}

/** Keep the last four digits — enough to match a unit in the field. */
function maskTail(value: string | null, keep = 4): string | null {
  if (!value) return null;
  if (value.length <= keep) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.min(8, value.length - keep))}${value.slice(-keep)}`;
}

const deviceInclude = {
  assignments: {
    where: { status: DeviceAssignmentStatus.ACTIVE },
    include: {
      vehicle: { select: { id: true, registrationNumber: true, vehicleType: true } },
    },
    take: 1,
  },
} satisfies Prisma.HardwareDeviceInclude;

type DeviceRecord = Prisma.HardwareDeviceGetPayload<{ include: typeof deviceInclude }>;

function toSummary(device: DeviceRecord, openAlerts = 0): DeviceSummary {
  const assignment = device.assignments[0];
  const lastSeen = device.lastTelemetryAt ?? device.lastSeenAt;

  return {
    id: device.id,
    organizationId: device.organizationId,
    deviceIdentifier: device.deviceIdentifier,
    provider: device.provider as DeviceProvider,
    deviceType: device.deviceType,
    role: device.role as DeviceRole,
    serialNumber: device.serialNumber,
    imeiMasked: maskTail(device.imei),
    manufacturer: device.manufacturer,
    model: device.model,
    firmwareVersion: device.firmwareVersion,
    simMasked: maskTail(device.simMsisdn) ?? maskTail(device.simIccid),
    simOperator: device.simOperator,
    status: device.status as DeviceStatus,
    supportedMetrics: device.supportedMetrics as TelemetryMetric[],
    observedMetrics: device.observedMetrics as TelemetryMetric[],
    assignedVehicle: assignment
      ? {
          id: assignment.vehicle.id,
          registrationNumber: assignment.vehicle.registrationNumber,
          vehicleType: assignment.vehicle.vehicleType as VehicleType,
          assignedAt: assignment.assignedAt.toISOString(),
        }
      : null,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    lastTelemetryAt: device.lastTelemetryAt?.toISOString() ?? null,
    silentForSeconds: lastSeen ? Math.floor((Date.now() - lastSeen.getTime()) / 1000) : null,
    readingCount: device.readingCount,
    rejectedCount: device.rejectedCount,
    openAlerts,
    notes: device.notes,
    installedAt: device.installedAt?.toISOString() ?? null,
    activatedAt: device.activatedAt?.toISOString() ?? null,
    deactivatedAt: device.deactivatedAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
    client: {
      selfEnrolled: device.selfEnrolled,
      platform: device.platform,
      deviceModel: device.deviceModel,
      osVersion: device.osVersion,
      appVersion: device.appVersion,
      lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() ?? null,
      batteryPercent: device.batteryPercent,
      batteryCharging: device.batteryCharging,
      networkType: device.networkType,
      gpsStatus: device.gpsStatus,
      cameraStatus: device.cameraStatus,
      bufferedEvents: device.bufferedEvents,
      reportingIntervalSeconds: device.reportingIntervalSeconds,
    },
  };
}

async function recordDeviceEvent(
  deviceId: string,
  organizationId: string,
  eventType: DeviceEventType,
  description: string,
  actorUserId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.deviceEvent.create({
    data: {
      deviceId,
      organizationId,
      eventType,
      description,
      actorUserId,
      ...(metadata ? { metadata: metadata as never } : {}),
    },
  });
}

/** Cryptographically strong device secret, shown to the operator exactly once. */
function generateSecret(): string {
  return randomBytes(24).toString('base64url');
}

async function assertDeviceLimit(auth: AuthContext, organizationId: string): Promise<void> {
  const max = auth.subscription?.limits.maxDevices;
  if (max === null || max === undefined) return;

  if (max === 0) {
    throw errors.planLimitReached(
      'maxDevices',
      `Connected hardware is not included in the ${auth.subscription?.planName ?? 'current'} plan. Upgrade to Saarthi Pro to add telematics devices.`,
    );
  }

  const existing = await prisma.hardwareDevice.count({
    where: { organizationId, archivedAt: null },
  });
  if (existing >= max) {
    throw errors.planLimitReached(
      'maxDevices',
      `Your ${auth.subscription?.planName ?? 'current'} plan allows ${max} devices. Upgrade to add more.`,
    );
  }
}

export interface RegisteredDevice {
  device: DeviceSummary;
  /**
   * The plaintext device secret. Returned once, at registration, and never
   * recoverable — the operator must copy it into the unit now.
   */
  secret: string;
}

export async function registerDevice(
  auth: AuthContext,
  organizationId: string,
  input: RegisterDeviceInput,
): Promise<RegisteredDevice> {
  await assertDeviceLimit(auth, organizationId);

  if (!adapterFor(input.provider)) {
    throw errors.validation(
      `Saarthi has no ingestion adapter for ${input.provider}. Supported providers are listed on the device form.`,
    );
  }

  const existing = await prisma.hardwareDevice.findUnique({
    where: { deviceIdentifier: input.deviceIdentifier },
  });
  if (existing) {
    throw errors.duplicate(`Device ${input.deviceIdentifier} is already registered on Saarthi.`, {
      fields: { deviceIdentifier: ['This device identifier is already registered.'] },
    });
  }

  if (input.imei) {
    const duplicateImei = await prisma.hardwareDevice.findUnique({ where: { imei: input.imei } });
    if (duplicateImei) {
      throw errors.duplicate('A device with that IMEI is already registered.', {
        fields: { imei: ['This IMEI is already registered.'] },
      });
    }
  }

  const secret = generateSecret();
  const device = await prisma.hardwareDevice.create({
    data: {
      organizationId,
      deviceIdentifier: input.deviceIdentifier,
      provider: input.provider,
      deviceType: input.deviceType,
      serialNumber: input.serialNumber,
      imei: input.imei ?? null,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      firmwareVersion: input.firmwareVersion ?? null,
      simIccid: input.simIccid ?? null,
      simMsisdn: input.simMsisdn ?? null,
      simOperator: input.simOperator ?? null,
      secretHash: await passwordHasher.hash(secret),
      status: DeviceStatus.REGISTERED,
      // Derived from the hardware family rather than asked for on the form:
      // whether a YC06 is a camera is a property of the product, not a decision
      // the person registering it should have to get right.
      role: resolveDeviceRole(input.provider),
      supportedMetrics: input.supportedMetrics,
      observedMetrics: [],
      notes: input.notes ?? null,
      installedAt: input.installedAt ?? null,
      createdById: auth.user.id,
    },
    include: deviceInclude,
  });

  await recordDeviceEvent(
    device.id,
    organizationId,
    DeviceEventType.REGISTERED,
    `${input.provider} device ${input.deviceIdentifier} registered.`,
    auth.user.id,
  );

  return { device: toSummary(device), secret };
}

export async function updateDevice(
  auth: AuthContext,
  deviceId: string,
  input: UpdateDeviceInput,
): Promise<DeviceSummary> {
  const existing = await prisma.hardwareDevice.findUnique({ where: { id: deviceId } });
  if (!existing) throw errors.notFound('Device');
  assertTenantAccess(auth, existing.organizationId, 'Device');

  const device = await prisma.hardwareDevice.update({
    where: { id: deviceId },
    data: {
      ...(input.deviceType ? { deviceType: input.deviceType } : {}),
      ...(input.serialNumber ? { serialNumber: input.serialNumber } : {}),
      ...(input.imei !== undefined ? { imei: input.imei ?? null } : {}),
      ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer ?? null } : {}),
      ...(input.model !== undefined ? { model: input.model ?? null } : {}),
      ...(input.firmwareVersion !== undefined
        ? { firmwareVersion: input.firmwareVersion ?? null }
        : {}),
      ...(input.simIccid !== undefined ? { simIccid: input.simIccid ?? null } : {}),
      ...(input.simMsisdn !== undefined ? { simMsisdn: input.simMsisdn ?? null } : {}),
      ...(input.simOperator !== undefined ? { simOperator: input.simOperator ?? null } : {}),
      ...(input.supportedMetrics ? { supportedMetrics: input.supportedMetrics } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      ...(input.installedAt !== undefined ? { installedAt: input.installedAt ?? null } : {}),
      ...(input.status
        ? {
            status: input.status,
            ...(input.status === DeviceStatus.RETIRED ? { deactivatedAt: new Date() } : {}),
            // Suspending or retiring a unit has to stop it now. Without this a
            // stolen phone keeps reporting until its current token expires,
            // which makes revocation advisory rather than real.
            ...(input.status === DeviceStatus.SUSPENDED || input.status === DeviceStatus.RETIRED
              ? { credentialVersion: { increment: 1 } }
              : {}),
          }
        : {}),
    },
    include: deviceInclude,
  });

  if (input.status && input.status !== existing.status) {
    await recordDeviceEvent(
      deviceId,
      device.organizationId,
      input.status === DeviceStatus.SUSPENDED
        ? DeviceEventType.SUSPENDED
        : input.status === DeviceStatus.RETIRED
          ? DeviceEventType.RETIRED
          : DeviceEventType.UPDATED,
      `Status changed from ${existing.status} to ${input.status}.`,
      auth.user.id,
    );
  } else {
    await recordDeviceEvent(
      deviceId,
      device.organizationId,
      DeviceEventType.UPDATED,
      'Device details updated.',
      auth.user.id,
    );
  }

  return toSummary(device);
}

/**
 * Rotate the device secret.
 *
 * The old secret stops working the moment this returns, so the caller has to be
 * ready to reflash the unit. That is deliberate: a rotation that left the old
 * credential valid would be theatre.
 */
export async function rotateDeviceSecret(
  auth: AuthContext,
  deviceId: string,
): Promise<{ device: DeviceSummary; secret: string }> {
  const existing = await prisma.hardwareDevice.findUnique({ where: { id: deviceId } });
  if (!existing) throw errors.notFound('Device');
  assertTenantAccess(auth, existing.organizationId, 'Device');

  const secret = generateSecret();
  const device = await prisma.hardwareDevice.update({
    where: { id: deviceId },
    data: {
      secretHash: await passwordHasher.hash(secret),
      secretRotatedAt: new Date(),
      // Access tokens minted from the old secret die on their next request
      // rather than at their next expiry. A rotation that left them working for
      // another quarter of an hour would be theatre.
      credentialVersion: { increment: 1 },
    },
    include: deviceInclude,
  });

  await recordDeviceEvent(
    deviceId,
    device.organizationId,
    DeviceEventType.SECRET_ROTATED,
    'Device credentials rotated. The previous secret no longer works.',
    auth.user.id,
  );

  return { device: toSummary(device), secret };
}

export async function listDevices(
  auth: AuthContext,
  query: DeviceListQuery,
): Promise<Paginated<DeviceSummary>> {
  const where: Prisma.HardwareDeviceWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId
      ? {}
      : { organizationId: auth.organizationId ?? '__none__' }),
    archivedAt: null,
    ...(query.provider ? { provider: { in: query.provider as DeviceProvider[] } } : {}),
    ...(query.status ? { status: { in: query.status as DeviceStatus[] } } : {}),
    ...(query.vehicleId
      ? {
          assignments: {
            some: { vehicleId: query.vehicleId, status: DeviceAssignmentStatus.ACTIVE },
          },
        }
      : {}),
    ...(query.assigned === undefined
      ? {}
      : query.assigned
        ? { assignments: { some: { status: DeviceAssignmentStatus.ACTIVE } } }
        : { assignments: { none: { status: DeviceAssignmentStatus.ACTIVE } } }),
    ...(query.search
      ? {
          OR: [
            { deviceIdentifier: { contains: query.search.toUpperCase() } },
            { serialNumber: { contains: query.search, mode: 'insensitive' } },
            { model: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.HardwareDeviceOrderByWithRelationInput =
    query.sortBy === 'serialNumber'
      ? { serialNumber: query.sortOrder }
      : query.sortBy === 'status'
        ? { status: query.sortOrder }
        : query.sortBy === 'lastSeenAt'
          ? { lastSeenAt: query.sortOrder }
          : { createdAt: query.sortOrder };

  const [total, devices] = await Promise.all([
    prisma.hardwareDevice.count({ where }),
    prisma.hardwareDevice.findMany({
      where,
      include: deviceInclude,
      orderBy,
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const alertCounts = new Map<string, number>();
  if (devices.length > 0) {
    const grouped = await prisma.telemetryAlert.groupBy({
      by: ['deviceId'],
      where: { deviceId: { in: devices.map((device) => device.id) }, status: 'OPEN' },
      _count: { _all: true },
    });
    for (const row of grouped) {
      if (row.deviceId) alertCounts.set(row.deviceId, row._count._all);
    }
  }

  return {
    items: devices.map((device) => toSummary(device, alertCounts.get(device.id) ?? 0)),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getDevice(auth: AuthContext, deviceId: string): Promise<DeviceSummary> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: deviceId },
    include: deviceInclude,
  });
  if (!device) throw errors.notFound('Device');
  assertTenantAccess(auth, device.organizationId, 'Device');

  const openAlerts = await prisma.telemetryAlert.count({
    where: { deviceId, status: 'OPEN' },
  });
  return toSummary(device, openAlerts);
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * Refuse a fitment that would give a vehicle two of something it may only have
 * one of.
 *
 * A vehicle is expected to carry several devices at once — a Freematics for
 * telemetry, a YC06 for its cameras, a phone standing in for either while the
 * hardware is on order. What it must not carry is two *position sources*: a
 * truck whose Freematics and whose phone disagree by forty metres produces a
 * map that flickers between two points, an ETA that oscillates, and a support
 * call nobody can settle. So the exclusivity is on the role rather than on the
 * device, and CAMERA and AUXILIARY units are unrestricted.
 */
export async function assertVehicleAcceptsRole(
  vehicleId: string,
  registrationNumber: string,
  role: DeviceRole,
  db: typeof prisma | Prisma.TransactionClient = prisma,
): Promise<void> {
  if (!roleIsExclusivePerVehicle(role)) return;

  const occupant = await db.deviceAssignment.findFirst({
    where: {
      vehicleId,
      status: DeviceAssignmentStatus.ACTIVE,
      device: { role },
    },
    select: { device: { select: { deviceIdentifier: true, provider: true } } },
  });

  if (occupant) {
    throw errors.conflict(
      `${registrationNumber} already reports its position from ${occupant.device.deviceIdentifier}. ` +
        'A vehicle can have only one telemetry source at a time — remove that device first, ' +
        'or fit this one as a camera or auxiliary unit.',
      { conflictingDevice: occupant.device.deviceIdentifier, role },
    );
  }
}

/**
 * Fit a device to a vehicle.
 *
 * Both sides are validated first, because a half-applied assignment is worse
 * than a refused one: a device pointing at a vehicle in another tenant would
 * write that tenant's telemetry.
 */
export async function assignDevice(
  auth: AuthContext,
  deviceId: string,
  input: AssignDeviceInput,
): Promise<DeviceSummary> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: deviceId },
    include: deviceInclude,
  });
  if (!device) throw errors.notFound('Device');
  assertTenantAccess(auth, device.organizationId, 'Device');

  if (!ASSIGNABLE_DEVICE_STATUSES.includes(device.status as DeviceStatus)) {
    throw errors.businessRule(
      `A ${device.status.toLowerCase()} device cannot be fitted to a vehicle.`,
    );
  }

  const vehicle = await prisma.truck.findUnique({
    where: { id: input.vehicleId },
    select: {
      id: true,
      organizationId: true,
      registrationNumber: true,
      vehicleType: true,
      archivedAt: true,
    },
  });
  if (!vehicle || vehicle.archivedAt) throw errors.notFound('Vehicle');
  // Cross-tenant assignment is reported as "not found" so device ids cannot be
  // used to discover another organization's fleet.
  if (vehicle.organizationId !== device.organizationId) throw errors.notFound('Vehicle');

  if (!vehicleSupports(vehicle.vehicleType as VehicleType, VehicleCapability.HARDWARE)) {
    throw errors.businessRule(
      `A ${vehicle.vehicleType.toLowerCase().replace(/_/g, ' ')} does not support connected hardware.`,
    );
  }

  await assertVehicleAcceptsRole(
    input.vehicleId,
    vehicle.registrationNumber,
    resolveDeviceRole(device.provider as DeviceProvider, device.role as DeviceRole),
  );

  const current = device.assignments[0];
  if (current) {
    throw errors.conflict(
      `This device is fitted to ${current.vehicle.registrationNumber}. Remove it from that vehicle first.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.deviceAssignment.create({
      data: {
        deviceId,
        vehicleId: input.vehicleId,
        organizationId: device.organizationId,
        status: DeviceAssignmentStatus.ACTIVE,
        assignedById: auth.user.id,
        installedAt: input.installedAt ?? null,
        note: input.note ?? null,
      },
    });

    // Registering a device is provisioning; fitting it is what makes it live.
    await tx.hardwareDevice.update({
      where: { id: deviceId },
      data: {
        status: DeviceStatus.ACTIVE,
        activatedAt: device.activatedAt ?? new Date(),
      },
    });
  });

  await recordDeviceEvent(
    deviceId,
    device.organizationId,
    DeviceEventType.ASSIGNED,
    `Fitted to ${vehicle.registrationNumber}.`,
    auth.user.id,
    { vehicleId: input.vehicleId },
  );

  void notifyOrganization(device.organizationId, {
    type: NotificationType.DEVICE_ASSIGNED,
    title: 'Telematics device fitted',
    body: `${device.deviceIdentifier} is now reporting for ${vehicle.registrationNumber}.`,
    priority: NotificationPriority.NORMAL,
    actionUrl: `/devices/${deviceId}`,
    roles: ['FLEET_OWNER', 'FLEET_MANAGER'],
  });

  return getDevice(auth, deviceId);
}

/**
 * Remove a device from its vehicle.
 *
 * The assignment row is closed, never deleted — it is what lets historical
 * telemetry still be attributed to the right unit years later.
 */
export async function unassignDevice(
  auth: AuthContext,
  deviceId: string,
  reason?: string,
): Promise<DeviceSummary> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: deviceId },
    include: deviceInclude,
  });
  if (!device) throw errors.notFound('Device');
  assertTenantAccess(auth, device.organizationId, 'Device');

  const assignment = device.assignments[0];
  if (!assignment) {
    throw errors.businessRule('This device is not currently fitted to a vehicle.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.deviceAssignment.update({
      where: { id: assignment.id },
      data: {
        status: DeviceAssignmentStatus.ENDED,
        unassignedAt: new Date(),
        unassignedById: auth.user.id,
        removalReason: reason ?? null,
      },
    });
    // An unfitted device is inventory, not a live tracker, so it should not sit
    // in the fleet's offline-device count.
    await tx.hardwareDevice.update({
      where: { id: deviceId },
      data: {
        status: DeviceStatus.INACTIVE,
        // Unpairing must silence the unit immediately. An app-based device is
        // often removed *because* it should stop reporting — a driver leaving,
        // a phone being sold — and letting its current token keep working for
        // another quarter of an hour defeats the point.
        credentialVersion: { increment: 1 },
        // Health figures describe a unit that is no longer fitted, so keeping
        // them would show a stale battery reading against an empty slot.
        batteryPercent: null,
        batteryCharging: null,
        networkType: null,
        gpsStatus: null,
        cameraStatus: null,
        bufferedEvents: null,
      },
    });
  });

  await recordDeviceEvent(
    deviceId,
    device.organizationId,
    DeviceEventType.UNASSIGNED,
    `Removed from ${assignment.vehicle.registrationNumber}${reason ? `: ${reason}` : '.'}`,
    auth.user.id,
    { vehicleId: assignment.vehicleId },
  );

  return getDevice(auth, deviceId);
}

/** Full fitment history for a device, newest first. */
export async function deviceAssignmentHistory(auth: AuthContext, deviceId: string) {
  const device = await prisma.hardwareDevice.findUnique({ where: { id: deviceId } });
  if (!device) throw errors.notFound('Device');
  assertTenantAccess(auth, device.organizationId, 'Device');

  const assignments = await prisma.deviceAssignment.findMany({
    where: { deviceId },
    include: { vehicle: { select: { id: true, registrationNumber: true, vehicleType: true } } },
    orderBy: { assignedAt: 'desc' },
  });

  return assignments.map((assignment) => ({
    id: assignment.id,
    vehicleId: assignment.vehicleId,
    registrationNumber: assignment.vehicle.registrationNumber,
    vehicleType: assignment.vehicle.vehicleType,
    status: assignment.status,
    assignedAt: assignment.assignedAt.toISOString(),
    installedAt: assignment.installedAt?.toISOString() ?? null,
    unassignedAt: assignment.unassignedAt?.toISOString() ?? null,
    note: assignment.note,
    removalReason: assignment.removalReason,
  }));
}

/** Devices ever fitted to a vehicle — the vehicle's side of the same history. */
export async function vehicleDeviceHistory(auth: AuthContext, vehicleId: string) {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: { organizationId: true },
  });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const assignments = await prisma.deviceAssignment.findMany({
    where: { vehicleId },
    include: {
      device: {
        select: {
          id: true,
          deviceIdentifier: true,
          provider: true,
          model: true,
          status: true,
          lastTelemetryAt: true,
        },
      },
    },
    orderBy: { assignedAt: 'desc' },
  });

  return assignments.map((assignment) => ({
    id: assignment.id,
    deviceId: assignment.deviceId,
    deviceIdentifier: assignment.device.deviceIdentifier,
    provider: assignment.device.provider,
    model: assignment.device.model,
    deviceStatus: assignment.device.status,
    status: assignment.status,
    assignedAt: assignment.assignedAt.toISOString(),
    unassignedAt: assignment.unassignedAt?.toISOString() ?? null,
    lastTelemetryAt: assignment.device.lastTelemetryAt?.toISOString() ?? null,
  }));
}

export async function deviceEvents(auth: AuthContext, deviceId: string) {
  const device = await prisma.hardwareDevice.findUnique({ where: { id: deviceId } });
  if (!device) throw errors.notFound('Device');
  assertTenantAccess(auth, device.organizationId, 'Device');

  const events = await prisma.deviceEvent.findMany({
    where: { deviceId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    description: event.description,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Gateway support
// ---------------------------------------------------------------------------

export interface AuthenticatedDevice {
  id: string;
  organizationId: string;
  deviceIdentifier: string;
  provider: DeviceProvider;
  status: DeviceStatus;
  vehicleId: string | null;
  lastSequence: number | null;
  observedMetrics: string[];
}

/**
 * Authenticate a device from its identifier and secret.
 *
 * Returns `null` for every failure — unknown device, wrong secret, suspended —
 * without distinguishing them, so the gateway cannot be used to enumerate which
 * device identifiers exist.
 */
export async function authenticateDevice(
  deviceIdentifier: string,
  secret: string,
): Promise<AuthenticatedDevice | null> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { deviceIdentifier },
    include: {
      assignments: {
        where: { status: DeviceAssignmentStatus.ACTIVE },
        select: { vehicleId: true },
        take: 1,
      },
    },
  });
  if (!device || device.archivedAt) return null;

  const valid = await verifyWithTimingGuard(secret, device.secretHash);
  if (!valid) {
    deviceLogger.warn({ deviceIdentifier }, 'Device authentication failed');
    return null;
  }

  return {
    id: device.id,
    organizationId: device.organizationId,
    deviceIdentifier: device.deviceIdentifier,
    provider: device.provider as DeviceProvider,
    status: device.status as DeviceStatus,
    vehicleId: device.assignments[0]?.vehicleId ?? null,
    lastSequence: device.lastSequence,
    observedMetrics: device.observedMetrics,
  };
}

/**
 * Mark devices that have gone quiet as offline.
 *
 * "Offline" is Saarthi's own verdict formed from silence, so something has to
 * notice the silence. Without this sweep a dead SIM is indistinguishable from a
 * parked truck, and the fleet learns nothing until someone goes looking.
 */
export async function runDeviceOfflineSweep(): Promise<number> {
  const cutoff = new Date(Date.now() - DEVICE_OFFLINE_AFTER_MS);

  const stale = await prisma.hardwareDevice.findMany({
    where: {
      status: DeviceStatus.ACTIVE,
      archivedAt: null,
      // A device that has never reported is not "offline" — it has not started.
      lastTelemetryAt: { not: null, lt: cutoff },
    },
    include: deviceInclude,
    take: 200,
  });

  for (const device of stale) {
    await prisma.hardwareDevice.update({
      where: { id: device.id },
      data: { status: DeviceStatus.OFFLINE },
    });

    const vehicleId = device.assignments[0]?.vehicleId ?? null;
    const silentForSeconds = device.lastTelemetryAt
      ? Math.floor((Date.now() - device.lastTelemetryAt.getTime()) / 1000)
      : null;

    await recordDeviceEvent(
      device.id,
      device.organizationId,
      DeviceEventType.OFFLINE,
      `No telemetry for ${Math.floor((silentForSeconds ?? 0) / 60)} minutes.`,
      null,
    );

    await broadcastDeviceStatus(
      {
        deviceId: device.id,
        serialNumber: device.serialNumber,
        organizationId: device.organizationId,
        vehicleId,
        status: DeviceStatus.OFFLINE,
        lastSeenAt: device.lastTelemetryAt?.toISOString() ?? null,
        silentForSeconds,
        updatedAt: new Date().toISOString(),
      },
      false,
    );

    void notifyOrganization(device.organizationId, {
      type: NotificationType.DEVICE_OFFLINE,
      title: 'Telematics device offline',
      body: `${device.deviceIdentifier}${
        device.assignments[0] ? ` on ${device.assignments[0].vehicle.registrationNumber}` : ''
      } has stopped reporting.`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/devices/${device.id}`,
      roles: ['FLEET_OWNER', 'FLEET_MANAGER', 'DISPATCHER'],
    });
  }

  if (stale.length > 0) {
    deviceLogger.warn({ count: stale.length }, 'Devices marked offline');
  }
  return stale.length;
}

/** Fleet-wide device health, for the hardware dashboard. */
export async function deviceOverview(auth: AuthContext): Promise<{
  total: number;
  active: number;
  offline: number;
  unassigned: number;
  suspended: number;
  readingsToday: number;
  openAlerts: number;
}> {
  const organizationId = auth.organizationId;
  const scope = auth.isPlatformAdmin && !organizationId ? {} : { organizationId: organizationId ?? '__none__' };
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [total, active, offline, unassigned, suspended, readingsToday, openAlerts] =
    await Promise.all([
      prisma.hardwareDevice.count({ where: { ...scope, archivedAt: null } }),
      prisma.hardwareDevice.count({
        where: { ...scope, archivedAt: null, status: DeviceStatus.ACTIVE },
      }),
      prisma.hardwareDevice.count({
        where: { ...scope, archivedAt: null, status: DeviceStatus.OFFLINE },
      }),
      prisma.hardwareDevice.count({
        where: {
          ...scope,
          archivedAt: null,
          assignments: { none: { status: DeviceAssignmentStatus.ACTIVE } },
        },
      }),
      prisma.hardwareDevice.count({
        where: { ...scope, archivedAt: null, status: DeviceStatus.SUSPENDED },
      }),
      prisma.telemetryReading.count({ where: { ...scope, recordedAt: { gte: startOfDay } } }),
      prisma.telemetryAlert.count({ where: { ...scope, status: 'OPEN' } }),
    ]);

  return { total, active, offline, unassigned, suspended, readingsToday, openAlerts };
}
