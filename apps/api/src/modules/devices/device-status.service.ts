import {
  DEVICE_HEARTBEAT_INTERVAL_SECONDS,
  DEVICE_HEARTBEAT_TIMEOUT_SECONDS,
  DeviceEventType,
  DeviceNetworkType,
  DeviceStatus,
  DeviceSubsystemStatus,
  type DeviceHealthSnapshot,
  type DeviceHeartbeatInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { logger } from '../../lib/logger';
import { broadcastDeviceHeartbeat, broadcastDeviceStatus } from '../../realtime/realtime.service';
import type { AuthenticatedDeviceContext } from './device-auth';

/**
 * Device heartbeat and live status.
 *
 * A heartbeat answers a different question from telemetry, and conflating the
 * two is the mistake this file exists to avoid. Telemetry silence means the
 * vehicle is not moving — which for a parked truck at 2 a.m. is exactly right.
 * Heartbeat silence means Saarthi has lost the unit: a flat battery, a dead
 * SIM, an app the driver swiped away. The first is normal; the second needs
 * somebody to know.
 *
 * The current snapshot lives in the cache with a TTL rather than in PostgreSQL,
 * for the same reason live vehicle state does: it is superseded every thirty
 * seconds, always re-derivable, and a fleet screen showing forty units asks for
 * it constantly. The TTL doubles as the timeout — a key that has expired *is*
 * the "not heard from" signal, so absence is the evidence rather than a flag
 * something has to remember to clear.
 *
 * PostgreSQL keeps the durable summary on `hardware_devices` so a support
 * question the next morning still has an answer.
 */

const statusLogger = logger.child({ module: 'device-status' });

export interface DeviceStatusSnapshot extends DeviceHealthSnapshot {
  deviceId: string;
  deviceIdentifier: string;
  organizationId: string;
  vehicleId: string | null;
  reportedAt: string;
  /** Difference between the device clock and Saarthi's, in seconds. */
  clockSkewSeconds: number | null;
}

export interface HeartbeatResult {
  acknowledgedAt: string;
  /** Seconds until the device should report again. */
  nextHeartbeatInSeconds: number;
  /**
   * The cadence Saarthi currently wants, echoed on every heartbeat.
   *
   * Cheaper than a separate config poll and impossible to miss: a device that
   * is heartbeating at all learns about a reporting-interval change within one
   * beat, even if it never asks.
   */
  reportingIntervalSeconds: number;
  /** Commands waiting for a device that is not holding a socket. */
  pendingCommands: number;
}

/**
 * Record a heartbeat.
 *
 * Deliberately cheap. This runs every thirty seconds for every connected unit,
 * so it does one indexed update and one cache write, and does the realtime
 * publish without waiting for it.
 */
export async function recordHeartbeat(
  device: AuthenticatedDeviceContext,
  input: DeviceHeartbeatInput,
): Promise<HeartbeatResult> {
  const now = new Date();

  const clockSkewSeconds = input.deviceTime
    ? Math.round((input.deviceTime.getTime() - now.getTime()) / 1000)
    : null;

  const snapshot: DeviceStatusSnapshot = {
    deviceId: device.id,
    deviceIdentifier: device.deviceIdentifier,
    organizationId: device.organizationId,
    vehicleId: device.vehicleId,
    batteryPercent: input.batteryPercent ?? null,
    batteryCharging: input.batteryCharging ?? null,
    networkType: input.networkType,
    gpsStatus: input.gpsStatus,
    cameraStatus: input.cameraStatus,
    bufferedEvents: input.bufferedEvents,
    appVersion: input.appVersion ?? null,
    reportedAt: now.toISOString(),
    clockSkewSeconds,
  };

  const wasOffline = device.status === DeviceStatus.OFFLINE;

  const [updated, pendingCommands] = await Promise.all([
    prisma.hardwareDevice.update({
      where: { id: device.id },
      data: {
        lastSeenAt: now,
        lastHeartbeatAt: now,
        batteryPercent: input.batteryPercent ?? null,
        batteryCharging: input.batteryCharging ?? null,
        networkType: input.networkType,
        gpsStatus: input.gpsStatus,
        cameraStatus: input.cameraStatus,
        bufferedEvents: input.bufferedEvents,
        ...(input.appVersion ? { appVersion: input.appVersion } : {}),
        // A unit that is talking again is not offline, whatever the sweep last
        // decided. Telemetry does the same thing; a heartbeat is the weaker but
        // earlier signal, and for a parked vehicle it is the only one.
        ...(wasOffline ? { status: DeviceStatus.ACTIVE } : {}),
      },
      select: { reportingIntervalSeconds: true, organizationId: true },
    }),
    prisma.deviceCommand.count({
      where: { deviceId: device.id, status: 'PENDING', expiresAt: { gt: now } },
    }),
  ]);

  // Best-effort: losing the snapshot costs a "not heard from" on one screen for
  // thirty seconds, and must never fail a heartbeat that was otherwise fine.
  await cache
    .set(cacheKeys.deviceStatus(device.id), snapshot, cacheTtl.deviceStatus)
    .catch((error: unknown) =>
      statusLogger.warn({ err: error, deviceId: device.id }, 'Device status cache write failed'),
    );

  void broadcastDeviceHeartbeat(snapshot).catch((error: unknown) =>
    statusLogger.warn({ err: error, deviceId: device.id }, 'Heartbeat broadcast failed'),
  );

  if (wasOffline) {
    await prisma.deviceEvent.create({
      data: {
        deviceId: device.id,
        organizationId: device.organizationId,
        eventType: DeviceEventType.ONLINE,
        description: 'Device resumed reporting (heartbeat).',
      },
    });
    void broadcastDeviceStatus(
      {
        deviceId: device.id,
        serialNumber: device.deviceIdentifier,
        organizationId: device.organizationId,
        vehicleId: device.vehicleId,
        status: DeviceStatus.ACTIVE,
        lastSeenAt: now.toISOString(),
        silentForSeconds: null,
        updatedAt: now.toISOString(),
      },
      true,
    ).catch(() => undefined);
  }

  if (clockSkewSeconds !== null && Math.abs(clockSkewSeconds) > 300) {
    // Worth a log rather than a rejection: the gateway already refuses readings
    // dated too far in the future, and this explains *why* they are being
    // refused when somebody goes looking.
    statusLogger.warn(
      { deviceIdentifier: device.deviceIdentifier, clockSkewSeconds },
      'Device clock is significantly out of step with the server',
    );
  }

  return {
    acknowledgedAt: now.toISOString(),
    nextHeartbeatInSeconds: DEVICE_HEARTBEAT_INTERVAL_SECONDS,
    reportingIntervalSeconds:
      updated.reportingIntervalSeconds ?? DEVICE_HEARTBEAT_INTERVAL_SECONDS,
    pendingCommands,
  };
}

/** The device's last self-report, or `null` when nothing recent is held. */
export async function readDeviceStatus(deviceId: string): Promise<DeviceStatusSnapshot | null> {
  return cache.get<DeviceStatusSnapshot>(cacheKeys.deviceStatus(deviceId));
}

/**
 * Live status for several devices at once.
 *
 * Missing entries are absent rather than null, so a caller merging this over
 * stored rows keeps the stored value instead of overwriting a good record with
 * nothing.
 */
export async function readDeviceStatuses(
  deviceIds: string[],
): Promise<Map<string, DeviceStatusSnapshot>> {
  const found = new Map<string, DeviceStatusSnapshot>();
  if (deviceIds.length === 0) return found;

  const results = await Promise.all(
    deviceIds.map(async (id) => [id, await readDeviceStatus(id)] as const),
  );
  for (const [id, snapshot] of results) {
    if (snapshot) found.set(id, snapshot);
  }
  return found;
}

export async function clearDeviceStatus(deviceId: string): Promise<void> {
  await cache.delete(cacheKeys.deviceStatus(deviceId)).catch(() => undefined);
}

/**
 * How fresh a heartbeat is, in the terms a dashboard uses.
 *
 * Separate from the cache TTL because the two answer different questions: the
 * TTL decides when Saarthi stops holding the value, this decides when it stops
 * presenting it as current.
 */
export function heartbeatFreshness(
  reportedAt: string,
  now: Date = new Date(),
): 'LIVE' | 'STALE' | 'LOST' {
  const ageSeconds = (now.getTime() - new Date(reportedAt).getTime()) / 1000;
  if (ageSeconds <= DEVICE_HEARTBEAT_INTERVAL_SECONDS * 2) return 'LIVE';
  if (ageSeconds <= DEVICE_HEARTBEAT_TIMEOUT_SECONDS) return 'STALE';
  return 'LOST';
}

/**
 * Notice units that have stopped heartbeating.
 *
 * Runs alongside the existing telemetry offline sweep rather than replacing it,
 * because they detect genuinely different failures. A phone parked overnight
 * sends no telemetry and is perfectly healthy; the same phone with a flat
 * battery sends no heartbeat either, and that is the one worth an event.
 *
 * Only devices that have *ever* heartbeated are considered, so a Freematics —
 * which has no such concept — is never reported as having stopped.
 */
export async function runHeartbeatSweep(): Promise<number> {
  const cutoff = new Date(Date.now() - DEVICE_HEARTBEAT_TIMEOUT_SECONDS * 1000);

  const silent = await prisma.hardwareDevice.findMany({
    where: {
      status: DeviceStatus.ACTIVE,
      archivedAt: null,
      lastHeartbeatAt: { not: null, lt: cutoff },
      assignments: { some: { status: 'ACTIVE' } },
    },
    select: {
      id: true,
      deviceIdentifier: true,
      organizationId: true,
      lastHeartbeatAt: true,
      batteryPercent: true,
      assignments: {
        where: { status: 'ACTIVE' },
        select: { vehicleId: true },
        take: 1,
      },
    },
    take: 200,
  });

  let recorded = 0;
  for (const device of silent) {
    // Only once per silence, not once per sweep. A device that has been dark
    // for a week should not produce an event every two minutes.
    const alreadyRecorded = await prisma.deviceEvent.findFirst({
      where: {
        deviceId: device.id,
        eventType: DeviceEventType.HEARTBEAT_MISSED,
        createdAt: { gt: device.lastHeartbeatAt ?? cutoff },
      },
      select: { id: true },
    });
    if (alreadyRecorded) continue;

    const silentMinutes = device.lastHeartbeatAt
      ? Math.floor((Date.now() - device.lastHeartbeatAt.getTime()) / 60_000)
      : null;

    await prisma.deviceEvent.create({
      data: {
        deviceId: device.id,
        organizationId: device.organizationId,
        eventType: DeviceEventType.HEARTBEAT_MISSED,
        description:
          `No heartbeat for ${silentMinutes ?? '?'} minutes` +
          // The last known battery level is usually the whole explanation, and
          // saying so saves somebody driving out to look at the vehicle.
          (device.batteryPercent !== null && device.batteryPercent <= 15
            ? `. The device was on ${device.batteryPercent}% battery when it was last heard from.`
            : '.'),
        metadata: {
          lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() ?? null,
          lastBatteryPercent: device.batteryPercent,
        },
      },
    });

    await clearDeviceStatus(device.id);
    recorded += 1;
  }

  if (recorded > 0) {
    statusLogger.info({ devices: recorded }, 'Devices stopped heartbeating');
  }
  return recorded;
}

/** Defaults for a device that reports nothing about itself. */
export const UNKNOWN_DEVICE_HEALTH: DeviceHealthSnapshot = {
  batteryPercent: null,
  batteryCharging: null,
  networkType: DeviceNetworkType.UNKNOWN,
  gpsStatus: DeviceSubsystemStatus.UNKNOWN,
  cameraStatus: DeviceSubsystemStatus.UNKNOWN,
  bufferedEvents: 0,
  appVersion: null,
};
