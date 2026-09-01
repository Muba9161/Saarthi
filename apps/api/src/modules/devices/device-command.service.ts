import {
  DeviceCommandStatus,
  DeviceCommandType,
  DeviceEventType,
  MAX_REPORTING_INTERVAL_SECONDS,
  MIN_REPORTING_INTERVAL_SECONDS,
  cameraCommandPayloadSchema,
  changeReportingIntervalPayloadSchema,
  type AcknowledgeDeviceCommandInput,
  type DeviceCommandView,
  type IssueDeviceCommandInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { assertTenantAccess } from '../../server/guards';
import { broadcastDeviceCommand, broadcastDeviceConfig } from '../../realtime/realtime.service';
import type { AuthContext } from '../../auth/context';
import type { AuthenticatedDeviceContext } from './device-auth';

/**
 * Server → device commands.
 *
 * A command is an instruction that leaves Saarthi and may never come back, so
 * the shape of this module is decided by what happens when it does not. Three
 * rules follow from that:
 *
 *  * **Every command is recorded before it is sent.** A camera that was told to
 *    start and never confirmed is a different situation from one that was never
 *    told, and only a stored row can tell them apart the next morning.
 *  * **Every command expires.** A device that has been in a tunnel for two
 *    hours should not come back to a queue of stale instructions and start its
 *    camera because somebody asked at breakfast.
 *  * **Acknowledgement is the device's, not the transport's.** Delivery means
 *    the message left; acknowledgement means the unit did the thing. The two
 *    are recorded separately because they fail separately.
 *
 * Delivery is over the device's own realtime channel when it holds a socket,
 * and by poll otherwise. Neither is authoritative — the database is — so a
 * device that misses the push still finds its work.
 */

const commandLogger = logger.child({ module: 'device-commands' });

/** How long an uncollected command stays worth delivering. */
const DEFAULT_COMMAND_TTL_SECONDS = 300;

/**
 * Commands that change stored configuration rather than asking for an action.
 *
 * These are applied to the device record when issued, not when acknowledged: a
 * reporting interval is what Saarthi wants, and it should survive the unit being
 * offline when the change was made.
 */
const CONFIGURATION_COMMANDS: DeviceCommandType[] = [
  DeviceCommandType.CHANGE_REPORTING_INTERVAL,
];

export interface DeviceCommandRecord extends DeviceCommandView {
  status: DeviceCommandStatus;
  deliveredAt: string | null;
  ackedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

/**
 * Validate a command's arguments for its type.
 *
 * Done here rather than in the route schema because the valid shape depends on
 * the command, and a single permissive `payload: Record<string, unknown>` would
 * let a nonsensical instruction reach a phone that then has to decide what to
 * do with it. Refusing at the point of issue means the operator finds out
 * immediately, in the dashboard, rather than through a device that silently
 * ignored them.
 */
function validatePayload(
  type: DeviceCommandType,
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  switch (type) {
    case DeviceCommandType.CHANGE_REPORTING_INTERVAL: {
      const parsed = changeReportingIntervalPayloadSchema.safeParse(payload ?? {});
      if (!parsed.success) {
        throw errors.validation(
          `A reporting interval between ${MIN_REPORTING_INTERVAL_SECONDS} and ${MAX_REPORTING_INTERVAL_SECONDS} seconds is required.`,
        );
      }
      return parsed.data;
    }
    case DeviceCommandType.START_CAMERA:
    case DeviceCommandType.STOP_CAMERA: {
      const parsed = cameraCommandPayloadSchema.safeParse(payload ?? {});
      if (!parsed.success) {
        throw errors.validation('Specify which camera to control, by id or channel.');
      }
      return parsed.data;
    }
    case DeviceCommandType.REQUEST_LOCATION:
    case DeviceCommandType.PING:
      // No arguments. Anything sent is discarded rather than forwarded, so a
      // caller cannot smuggle a field past validation by attaching it here.
      return null;
    case DeviceCommandType.UPDATE_CONFIGURATION:
      // Deliberately opaque: it tells the device to re-read `/config`, which is
      // where the actual settings live and where they are authorised.
      return null;
    default:
      return payload ?? null;
  }
}

function toView(record: {
  id: string;
  deviceId: string;
  organizationId: string;
  type: string;
  payload: unknown;
  status: string;
  issuedAt: Date;
  expiresAt: Date;
  deliveredAt: Date | null;
  ackedAt: Date | null;
  result: unknown;
  error: string | null;
}): DeviceCommandRecord {
  return {
    id: record.id,
    type: record.type as DeviceCommandType,
    payload: (record.payload as Record<string, unknown> | null) ?? null,
    issuedAt: record.issuedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    status: record.status as DeviceCommandStatus,
    deliveredAt: record.deliveredAt?.toISOString() ?? null,
    ackedAt: record.ackedAt?.toISOString() ?? null,
    result: (record.result as Record<string, unknown> | null) ?? null,
    error: record.error,
  };
}

// ---------------------------------------------------------------------------
// Issuing
// ---------------------------------------------------------------------------

export async function issueCommand(
  auth: AuthContext,
  deviceId: string,
  input: IssueDeviceCommandInput,
): Promise<DeviceCommandRecord> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      organizationId: true,
      deviceIdentifier: true,
      status: true,
      archivedAt: true,
      assignments: { where: { status: 'ACTIVE' }, select: { vehicleId: true }, take: 1 },
    },
  });
  if (!device || device.archivedAt) throw errors.notFound('Device');
  assertTenantAccess(auth, device.organizationId, 'Device');

  if (device.status === 'SUSPENDED' || device.status === 'RETIRED') {
    throw errors.businessRule(
      `This device is ${device.status.toLowerCase()} and is not accepting commands.`,
    );
  }

  const payload = validatePayload(input.type, input.payload);
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_COMMAND_TTL_SECONDS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const command = await prisma.deviceCommand.create({
    data: {
      deviceId: device.id,
      organizationId: device.organizationId,
      type: input.type,
      payload: payload === null ? undefined : (payload as never),
      status: DeviceCommandStatus.PENDING,
      issuedById: auth.user.id,
      issuedAt: now,
      expiresAt,
    },
  });

  // Configuration changes take effect on the device record immediately, so they
  // survive the unit being offline when the change was made — a phone that
  // reconnects tomorrow picks up the new interval from `/config` whether or not
  // it ever saw the command.
  if (CONFIGURATION_COMMANDS.includes(input.type) && payload) {
    const interval = payload.reportingIntervalSeconds;
    if (typeof interval === 'number') {
      await prisma.hardwareDevice.update({
        where: { id: device.id },
        data: { reportingIntervalSeconds: interval },
      });
      await broadcastDeviceConfig({
        deviceId: device.id,
        reportingIntervalSeconds: interval,
        heartbeatIntervalSeconds: 30,
        videoEnabled: false,
        simulationAllowed: false,
        updatedAt: now.toISOString(),
      });
    }
  }

  await prisma.deviceEvent.create({
    data: {
      deviceId: device.id,
      organizationId: device.organizationId,
      eventType: DeviceEventType.COMMAND_ISSUED,
      description: `${input.type} requested.`,
      actorUserId: auth.user.id,
      metadata: { commandId: command.id, ...(payload ? { payload } : {}) } as never,
    },
  });

  // Push it now for a device holding a socket. A device that is not listening
  // finds it on its next poll — the row is the authority, this is only speed.
  await broadcastDeviceCommand({
    commandId: command.id,
    deviceId: device.id,
    organizationId: device.organizationId,
    type: input.type,
    payload,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  commandLogger.info(
    { deviceIdentifier: device.deviceIdentifier, type: input.type, commandId: command.id },
    'Device command issued',
  );

  return toView(command);
}

/** Command history for a device, newest first. */
export async function listCommands(
  auth: AuthContext,
  deviceId: string,
): Promise<DeviceCommandRecord[]> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: deviceId },
    select: { organizationId: true },
  });
  if (!device) throw errors.notFound('Device');
  assertTenantAccess(auth, device.organizationId, 'Device');

  const commands = await prisma.deviceCommand.findMany({
    where: { deviceId },
    orderBy: { issuedAt: 'desc' },
    take: 100,
  });
  return commands.map(toView);
}

// ---------------------------------------------------------------------------
// Collection — device side
// ---------------------------------------------------------------------------

/**
 * Hand a device its outstanding work.
 *
 * Marks what it collects as DELIVERED in the same call, because from Saarthi's
 * side that is exactly what delivery means: the instruction left the building.
 * Whether the unit acted on it is a separate fact, recorded separately, and one
 * only the device can report.
 */
export async function collectCommands(
  device: AuthenticatedDeviceContext,
): Promise<DeviceCommandView[]> {
  const now = new Date();

  const pending = await prisma.deviceCommand.findMany({
    where: {
      deviceId: device.id,
      status: DeviceCommandStatus.PENDING,
      expiresAt: { gt: now },
    },
    orderBy: { issuedAt: 'asc' },
    take: 20,
  });

  if (pending.length === 0) return [];

  await prisma.deviceCommand.updateMany({
    where: { id: { in: pending.map((command) => command.id) } },
    data: { status: DeviceCommandStatus.DELIVERED, deliveredAt: now },
  });

  return pending.map((command) => ({
    id: command.id,
    type: command.type as DeviceCommandType,
    payload: (command.payload as Record<string, unknown> | null) ?? null,
    issuedAt: command.issuedAt.toISOString(),
    expiresAt: command.expiresAt.toISOString(),
  }));
}

/**
 * Record what the device did with a command.
 *
 * Idempotent: a device that acknowledges twice — because its first attempt
 * timed out on the way back — must not produce two audit entries or a
 * contradictory status.
 */
export async function acknowledgeCommand(
  device: AuthenticatedDeviceContext,
  commandId: string,
  input: AcknowledgeDeviceCommandInput,
): Promise<DeviceCommandRecord> {
  const command = await prisma.deviceCommand.findUnique({ where: { id: commandId } });
  if (!command) throw errors.notFound('Command');

  // A device may only acknowledge its own work. Reported as not-found so one
  // unit cannot probe for another's command ids.
  if (command.deviceId !== device.id) {
    commandLogger.warn(
      { deviceIdentifier: device.deviceIdentifier, commandId },
      'Device attempted to acknowledge a command addressed to another device',
    );
    throw errors.notFound('Command');
  }

  if (command.ackedAt) return toView(command);

  const now = new Date();
  const updated = await prisma.deviceCommand.update({
    where: { id: commandId },
    data: {
      status: input.success ? DeviceCommandStatus.ACKNOWLEDGED : DeviceCommandStatus.FAILED,
      ackedAt: now,
      result: input.result === undefined ? undefined : (input.result as never),
      error: input.error ?? null,
    },
  });

  await prisma.deviceEvent.create({
    data: {
      deviceId: device.id,
      organizationId: device.organizationId,
      eventType: DeviceEventType.COMMAND_ACKED,
      description: input.success
        ? `${command.type} completed.`
        : `${command.type} failed${input.error ? `: ${input.error}` : '.'}`,
      metadata: { commandId },
    },
  });

  return toView(updated);
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

/**
 * Retire commands nobody collected.
 *
 * Without this, a device returning from a long outage would find and execute
 * instructions somebody issued hours ago. "Start the camera" is not a request
 * that ages well.
 */
export async function runCommandExpirySweep(): Promise<number> {
  const now = new Date();
  const expired = await prisma.deviceCommand.updateMany({
    where: {
      status: { in: [DeviceCommandStatus.PENDING, DeviceCommandStatus.DELIVERED] },
      expiresAt: { lt: now },
    },
    data: { status: DeviceCommandStatus.EXPIRED },
  });

  if (expired.count > 0) {
    commandLogger.info({ expired: expired.count }, 'Device commands expired uncollected');
  }
  return expired.count;
}
