import {
  ACTIVE_TERMINAL_SESSION_STATUSES,
  DEVICE_HEARTBEAT_INTERVAL_SECONDS,
  DeviceNetworkType,
  DeviceStatus,
  DeviceSubsystemStatus,
  DeviceType,
  type TerminalSessionStatus,
  TerminalState,
  terminalStateForSession,
  type TerminalHealthView,
  type TerminalStateView,
  type TerminalVehicleQrView,
  type TerminalVehicleView,
  type VehicleType,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { buildAuthContext } from '../../auth/session.service';
import { renderPayloadPngDataUri } from '../qr/qr-render.service';
import { ensureVehicleCodeForDevice } from '../qr/qr.service';
import { readDeviceStatus } from '../devices/device-status.service';
import type { AuthContext } from '../../auth/context';
import type { AuthenticatedDeviceContext, DeviceCaller } from '../devices/device-auth';
import { terminalDriver } from './driver.view';
import { toSessionView, type SessionRecord, sessionInclude } from './session.view';

/**
 * What a Saarthi Terminal is allowed to know.
 *
 * A terminal is a device in the existing sense — it enrols, pairs, posts
 * telemetry and raises SOS through exactly the endpoints a Freematics uses. It
 * is not a privileged frontend, and nothing in this file trusts a field it
 * sent. Its vehicle comes from its own assignment; its organization comes from
 * its device row; its driver comes from the session an authorised person
 * approved.
 *
 * The one screen-shaped thing here is `terminalState`, which assembles
 * everything a tablet needs to decide what to render into a single answer.
 * That is not an optimisation for its own sake: a terminal in a yard on a bad
 * 2G link cannot afford six round trips to work out which screen it is on, and
 * six independent answers can disagree — which is how a tablet ends up showing
 * a welcome screen for a driver who has just been rejected.
 */

const terminalLogger = logger.child({ module: 'terminal' });

/**
 * Telemetry silence after which "vehicle data" stops being reported connected.
 *
 * Deliberately generous relative to the reporting interval: a vehicle parked in
 * an underground bay is not a fault, and a red indicator that lights up every
 * time a truck goes under a bridge is one drivers stop reading.
 */
const VEHICLE_DATA_STALE_SECONDS = 180;

// ---------------------------------------------------------------------------
// Terminal context
// ---------------------------------------------------------------------------

export interface TerminalContext {
  device: AuthenticatedDeviceContext;
  vehicleId: string;
  organizationId: string;
}

/**
 * Narrow a device caller to a paired terminal.
 *
 * Three separate refusals, each with its own message, because they need three
 * different actions from whoever is standing at the vehicle: enrol, pair, or
 * call support. A single "not authorised" would be true and useless.
 */
export function requireTerminal(caller: DeviceCaller): TerminalContext {
  if (caller.kind !== 'DEVICE') {
    throw errors.businessRule(
      'This terminal has not been connected to a vehicle yet. Scan the pairing code from Vehicle → Hardware in the Saarthi dashboard.',
    );
  }
  if (caller.deviceType !== DeviceType.VEHICLE_TERMINAL) {
    // A test phone reaching the terminal surface is a misconfiguration, not an
    // attack — but it must not be allowed to drive a driver-authorisation flow.
    throw errors.forbidden(
      'This device is not registered as a Saarthi Terminal. Pair it as a terminal to use these features.',
    );
  }
  if (!caller.vehicleId) {
    throw errors.businessRule(
      'This terminal is not connected to a vehicle. Scan the pairing code from Vehicle → Hardware in the Saarthi dashboard.',
    );
  }
  if (caller.status === DeviceStatus.SUSPENDED || caller.status === DeviceStatus.RETIRED) {
    throw errors.forbidden(
      `This terminal has been ${caller.status.toLowerCase()}. Contact your fleet administrator.`,
    );
  }

  return {
    device: caller,
    vehicleId: caller.vehicleId,
    organizationId: caller.organizationId,
  };
}

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------

export async function terminalVehicle(vehicleId: string): Promise<TerminalVehicleView> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: {
      id: true,
      registrationNumber: true,
      vehicleType: true,
      truckType: true,
      manufacturer: true,
      model: true,
      year: true,
      fuelType: true,
      capacityTons: true,
      odometerKm: true,
      status: true,
      archivedAt: true,
      organizationId: true,
    },
  });
  if (!vehicle || vehicle.archivedAt) throw errors.notFound('Vehicle');

  // `Truck` carries `organizationId` but no relation to Organization, so the
  // name is a second lookup rather than an include.
  const organization = await prisma.organization.findUnique({
    where: { id: vehicle.organizationId },
    select: { name: true },
  });

  return {
    id: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    vehicleType: vehicle.vehicleType as VehicleType,
    truckType: vehicle.truckType,
    manufacturer: vehicle.manufacturer,
    model: vehicle.model,
    year: vehicle.year,
    fuelType: vehicle.fuelType,
    capacityTons: vehicle.capacityTons,
    odometerKm: vehicle.odometerKm,
    status: vehicle.status,
    organizationName: organization?.name ?? '',
  };
}

/**
 * The vehicle's permanent QR, rendered for the terminal screen.
 *
 * Section 10 of the specification, in code: this resolves the vehicle's own
 * existing `QrCode`, provisioning one only if the vehicle has never had one. It
 * does not mint a per-driver code, it does not rotate anything, and the code it
 * returns is the same one printed on the windscreen sticker — so a driver who
 * scans the screen and a checkpoint officer who scans the sticker are looking
 * at one identity.
 *
 * The rendered image encodes the code's *target URL*, exactly as the printed
 * sticker does, so the driver's ordinary phone camera opens the Saarthi scan
 * page rather than showing an unhelpful blob of JSON.
 */
export async function terminalVehicleQr(
  vehicleId: string,
  frontendUrl?: string,
): Promise<TerminalVehicleQrView> {
  const code = await ensureVehicleCodeForDevice(vehicleId, frontendUrl);

  return {
    qrCodeId: code.id,
    shortLabel: code.shortLabel,
    targetUrl: code.targetUrl,
    // PNG, not SVG. Android's BitmapFactory does not decode SVG, so the browser
    // form of this data URI renders as nothing on a terminal — silently.
    imageDataUri: await renderPayloadPngDataUri(code.targetUrl, { size: 640 }),
    allowPublicResolve: code.allowPublicResolve,
    version: code.version,
    issuedAt: code.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/**
 * Re-exported so callers reach the terminal's whole surface through one module.
 *
 * The implementation lives in `driver.view.ts` because the session projection
 * needs it too, and a cycle between these two files would be resolved at
 * runtime by whichever one happened to load first.
 */
export { terminalDriver };

/**
 * Build the driver's own authorisation context from a live terminal session.
 *
 * This is what lets the terminal reuse the whole platform — passport,
 * maintenance, documents, nearby, the AI tool layer — without any of those
 * growing a device-shaped back door. The context is the driver's *real* one,
 * loaded fresh: if their account has been suspended, their membership removed
 * or their role changed since the session was approved, every downstream call
 * refuses, which is exactly what section 47 asks for.
 *
 * The terminal session id stands in for the web session id. That is honest —
 * it is the session that authorises this request — and it means an audit entry
 * written from a terminal points at the terminal session that produced it.
 */
export async function driverAuthForSession(session: {
  id: string;
  driverUserId: string;
  organizationId: string;
  status: TerminalSessionStatus;
}): Promise<AuthContext> {
  if (!ACTIVE_TERMINAL_SESSION_STATUSES.includes(session.status)) {
    throw errors.forbidden('This driver session is no longer active on the terminal.');
  }
  return buildAuthContext(session.driverUserId, session.id, session.organizationId);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

async function terminalHealth(
  device: AuthenticatedDeviceContext,
  lastTelemetryAt: Date | null,
): Promise<TerminalHealthView> {
  const snapshot = await readDeviceStatus(device.id);

  const heartbeatAgeMs = snapshot?.reportedAt
    ? Date.now() - new Date(snapshot.reportedAt).getTime()
    : null;

  return {
    // "Online" is the terminal's own recent heartbeat, not Saarthi's telemetry
    // verdict: a parked vehicle is silent and perfectly healthy, and reporting
    // it offline would put a red dot on every truck in the yard overnight.
    online:
      heartbeatAgeMs !== null &&
      heartbeatAgeMs <= DEVICE_HEARTBEAT_INTERVAL_SECONDS * 1000 * 6,
    batteryPercent: snapshot?.batteryPercent ?? null,
    batteryCharging: snapshot?.batteryCharging ?? null,
    networkType: (snapshot?.networkType ?? DeviceNetworkType.UNKNOWN) as DeviceNetworkType,
    gpsStatus: (snapshot?.gpsStatus ?? DeviceSubsystemStatus.UNKNOWN) as DeviceSubsystemStatus,
    cameraStatus: (snapshot?.cameraStatus ??
      DeviceSubsystemStatus.UNKNOWN) as DeviceSubsystemStatus,
    vehicleDataConnected:
      lastTelemetryAt !== null &&
      Date.now() - lastTelemetryAt.getTime() <= VEHICLE_DATA_STALE_SECONDS * 1000,
    lastHeartbeatAt: snapshot?.reportedAt ?? null,
    lastTelemetryAt: lastTelemetryAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// The one screen-shaped answer
// ---------------------------------------------------------------------------

/**
 * Everything the terminal needs to decide what to render.
 *
 * Cached for ten seconds and invalidated explicitly on every session
 * transition, because the one thing this must never be is stale about an
 * approval — a driver watching a tablet in a yard has nothing else to go on.
 * `invalidateTerminalState` is called from every write path that can change it.
 */
export async function terminalState(
  caller: DeviceCaller,
  options: { frontendUrl?: string } = {},
): Promise<TerminalStateView> {
  // An unpaired terminal is a legitimate, expected state — it is the first
  // screen the app ever shows — so it answers rather than refusing.
  if (caller.kind === 'PENDING_ENROLMENT') {
    return {
      state: TerminalState.UNPAIRED,
      terminal: {
        deviceId: null,
        deviceIdentifier: caller.deviceIdentifier,
        status: 'PENDING',
        paired: false,
        appVersion: null,
      },
      organizationId: null,
      vehicle: null,
      vehicleQr: null,
      session: null,
      health: null,
      serverTime: new Date().toISOString(),
      reportingIntervalSeconds: config.device.defaultReportingIntervalSeconds,
      heartbeatIntervalSeconds: DEVICE_HEARTBEAT_INTERVAL_SECONDS,
      simulationAllowed: config.device.simulationAllowed,
    };
  }

  if (caller.status === DeviceStatus.SUSPENDED || caller.status === DeviceStatus.RETIRED) {
    return {
      state: TerminalState.REVOKED,
      terminal: {
        deviceId: caller.id,
        deviceIdentifier: caller.deviceIdentifier,
        status: caller.status,
        paired: Boolean(caller.vehicleId),
        appVersion: null,
      },
      organizationId: caller.organizationId,
      vehicle: null,
      vehicleQr: null,
      session: null,
      health: null,
      serverTime: new Date().toISOString(),
      reportingIntervalSeconds: config.device.defaultReportingIntervalSeconds,
      heartbeatIntervalSeconds: DEVICE_HEARTBEAT_INTERVAL_SECONDS,
      simulationAllowed: config.device.simulationAllowed,
    };
  }

  if (!caller.vehicleId) {
    return {
      state: TerminalState.UNPAIRED,
      terminal: {
        deviceId: caller.id,
        deviceIdentifier: caller.deviceIdentifier,
        status: caller.status,
        paired: false,
        appVersion: null,
      },
      organizationId: caller.organizationId,
      vehicle: null,
      vehicleQr: null,
      session: null,
      health: null,
      serverTime: new Date().toISOString(),
      reportingIntervalSeconds:
        caller.reportingIntervalSeconds ?? config.device.defaultReportingIntervalSeconds,
      heartbeatIntervalSeconds: DEVICE_HEARTBEAT_INTERVAL_SECONDS,
      simulationAllowed: config.device.simulationAllowed,
    };
  }

  const cacheKey = cacheKeys.terminalState(caller.id);
  const cached = await cache.get<TerminalStateView>(cacheKey);
  if (cached) return { ...cached, serverTime: new Date().toISOString() };

  const [device, vehicle, session] = await Promise.all([
    prisma.hardwareDevice.findUnique({
      where: { id: caller.id },
      select: { appVersion: true, lastTelemetryAt: true, status: true },
    }),
    terminalVehicle(caller.vehicleId),
    prisma.terminalSession.findFirst({
      where: {
        terminalDeviceId: caller.id,
        status: { in: ACTIVE_TERMINAL_SESSION_STATUSES },
      },
      include: sessionInclude,
      orderBy: { requestedAt: 'desc' },
    }),
  ]);

  const vehicleQr = await terminalVehicleQr(caller.vehicleId, options.frontendUrl);
  const health = await terminalHealth(caller, device?.lastTelemetryAt ?? null);

  const sessionView = session
    ? await toSessionView(session as SessionRecord, { includeSelfie: true })
    : null;

  const view: TerminalStateView = {
    state: sessionView?.state ?? TerminalState.AWAITING_DRIVER,
    terminal: {
      deviceId: caller.id,
      deviceIdentifier: caller.deviceIdentifier,
      status: device?.status ?? caller.status,
      paired: true,
      appVersion: device?.appVersion ?? null,
    },
    organizationId: caller.organizationId,
    vehicle,
    vehicleQr,
    session: sessionView,
    health,
    serverTime: new Date().toISOString(),
    reportingIntervalSeconds:
      caller.reportingIntervalSeconds ?? config.device.defaultReportingIntervalSeconds,
    heartbeatIntervalSeconds: DEVICE_HEARTBEAT_INTERVAL_SECONDS,
    simulationAllowed: config.device.simulationAllowed,
  };

  await cache.set(cacheKey, view, cacheTtl.terminalState);
  return view;
}

/** Drop the cached state for one terminal. Called from every write path. */
export async function invalidateTerminalState(deviceId: string): Promise<void> {
  await cache.delete(cacheKeys.terminalState(deviceId)).catch((error: unknown) => {
    // A stale cache entry costs ten seconds of wrong screen, which is bad but
    // survivable; failing the write that produced it would be worse.
    terminalLogger.warn({ err: error, deviceId }, 'Could not invalidate terminal state');
  });
}

/**
 * The terminals fitted across one fleet.
 *
 * For the dashboard, not for a terminal. Includes the live session so an
 * operator can see at a glance which vehicles have somebody in them.
 */
export async function listTerminals(organizationId: string): Promise<
  {
    deviceId: string;
    deviceIdentifier: string;
    status: string;
    vehicleId: string | null;
    registrationNumber: string | null;
    appVersion: string | null;
    lastHeartbeatAt: string | null;
    lastTelemetryAt: string | null;
    batteryPercent: number | null;
    currentDriverName: string | null;
    state: TerminalState;
  }[]
> {
  const devices = await prisma.hardwareDevice.findMany({
    where: {
      organizationId,
      deviceType: DeviceType.VEHICLE_TERMINAL,
      archivedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      deviceIdentifier: true,
      status: true,
      appVersion: true,
      lastHeartbeatAt: true,
      lastTelemetryAt: true,
      batteryPercent: true,
      assignments: {
        where: { status: 'ACTIVE' },
        take: 1,
        select: { vehicleId: true, vehicle: { select: { registrationNumber: true } } },
      },
    },
  });

  if (devices.length === 0) return [];

  const sessions = await prisma.terminalSession.findMany({
    where: {
      terminalDeviceId: { in: devices.map((device) => device.id) },
      status: { in: ACTIVE_TERMINAL_SESSION_STATUSES },
    },
    select: {
      terminalDeviceId: true,
      status: true,
      checklistCompletedAt: true,
      driver: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
  });
  const byDevice = new Map(sessions.map((session) => [session.terminalDeviceId, session]));

  return devices.map((device) => {
    const assignment = device.assignments[0];
    const session = byDevice.get(device.id);
    return {
      deviceId: device.id,
      deviceIdentifier: device.deviceIdentifier,
      status: device.status,
      vehicleId: assignment?.vehicleId ?? null,
      registrationNumber: assignment?.vehicle.registrationNumber ?? null,
      appVersion: device.appVersion,
      lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() ?? null,
      lastTelemetryAt: device.lastTelemetryAt?.toISOString() ?? null,
      batteryPercent: device.batteryPercent,
      currentDriverName: session
        ? `${session.driver.user.firstName} ${session.driver.user.lastName}`.trim()
        : null,
      state: !assignment
        ? TerminalState.UNPAIRED
        : session
          ? terminalStateForSession(session.status as TerminalSessionStatus, {
              checklistComplete: session.checklistCompletedAt !== null,
            })
          : TerminalState.AWAITING_DRIVER,
    };
  });
}
