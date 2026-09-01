import { createHash, randomBytes } from 'node:crypto';
import { Permission, hasPermission } from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { assertTenantAccess } from '../../server/guards';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { videoProvider } from '../../providers/video';
import type { AuthContext } from '../../auth/context';

/**
 * Multi-camera devices and live viewing.
 *
 * The YC06 is the first hardware Saarthi supports that points a lens at a
 * person. That changes the design in three concrete ways, and each one is a
 * deliberate constraint rather than an oversight:
 *
 *   • **Cameras belong to the device, not the vehicle.** Moving a recorder
 *     between trucks moves its four channels with it, and footage from last
 *     month still resolves to the vehicle the device was fitted to then.
 *   • **Every live view is recorded.** Who watched, which camera, when, for how
 *     long. A camera aimed at a driver is a surveillance capability, and a log
 *     is the only thing that keeps it accountable.
 *   • **Video never passes through this API.** Saarthi issues a short-lived
 *     ticket; the browser talks to a video gateway. Nothing here proxies frames
 *     and nothing here stores them.
 */

const cameraLogger = logger.child({ module: 'devices:cameras' });

export interface CameraView {
  id: string;
  deviceId: string;
  deviceIdentifier: string;
  channel: number;
  position: string;
  label: string | null;
  status: string;
  enabled: boolean;
  continuousRecording: boolean;
  resolution: string | null;
  frameRate: number | null;
  lastFrameAt: string | null;
  thumbnailUrl: string | null;
  /** The vehicle this camera's device is fitted to right now, if any. */
  vehicleId: string | null;
  registrationNumber: string | null;
}

type CameraRow = Prisma.DeviceCameraGetPayload<{
  include: { device: { select: { deviceIdentifier: true; organizationId: true } } };
}>;

function toView(
  row: CameraRow,
  assignment: { vehicleId: string; registrationNumber: string } | null,
): CameraView {
  return {
    id: row.id,
    deviceId: row.deviceId,
    deviceIdentifier: row.device.deviceIdentifier,
    channel: row.channel,
    position: row.position,
    label: row.label,
    status: row.status,
    enabled: row.enabled,
    continuousRecording: row.continuousRecording,
    resolution: row.resolution,
    frameRate: row.frameRate,
    lastFrameAt: row.lastFrameAt?.toISOString() ?? null,
    thumbnailUrl: row.lastThumbnailUrl,
    vehicleId: assignment?.vehicleId ?? null,
    registrationNumber: assignment?.registrationNumber ?? null,
  };
}

/** Which vehicle each of these devices is currently fitted to. */
async function currentAssignments(
  deviceIds: string[],
): Promise<Map<string, { vehicleId: string; registrationNumber: string }>> {
  if (deviceIds.length === 0) return new Map();

  const assignments = await prisma.deviceAssignment.findMany({
    where: { deviceId: { in: deviceIds }, status: 'ACTIVE' },
    select: { deviceId: true, vehicleId: true },
  });

  const vehicles = await prisma.truck.findMany({
    where: { id: { in: assignments.map((row) => row.vehicleId) } },
    select: { id: true, registrationNumber: true },
  });
  const labels = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.registrationNumber]));

  return new Map(
    assignments.map((row) => [
      row.deviceId,
      { vehicleId: row.vehicleId, registrationNumber: labels.get(row.vehicleId) ?? 'Unknown' },
    ]),
  );
}

export async function listDeviceCameras(
  auth: AuthContext,
  deviceId: string,
): Promise<CameraView[]> {
  const device = await prisma.hardwareDevice.findUnique({ where: { id: deviceId } });
  if (!device) throw errors.notFound('Device');
  assertTenantAccess(auth, device.organizationId, 'Device');

  const cameras = await prisma.deviceCamera.findMany({
    where: { deviceId },
    orderBy: { channel: 'asc' },
    include: { device: { select: { deviceIdentifier: true, organizationId: true } } },
  });

  const assignments = await currentAssignments([deviceId]);
  return cameras.map((camera) => toView(camera, assignments.get(deviceId) ?? null));
}

/**
 * Every camera pointed at one vehicle right now.
 *
 * Resolved through the *current* device assignment rather than a stored link on
 * the vehicle, so a recorder swapped between trucks needs no data migration.
 */
export async function vehicleCameras(
  auth: AuthContext,
  vehicleId: string,
): Promise<CameraView[]> {
  const vehicle = await prisma.truck.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const assignments = await prisma.deviceAssignment.findMany({
    where: { vehicleId, status: 'ACTIVE' },
    select: { deviceId: true },
  });
  if (assignments.length === 0) return [];

  const cameras = await prisma.deviceCamera.findMany({
    where: { deviceId: { in: assignments.map((row) => row.deviceId) } },
    orderBy: [{ deviceId: 'asc' }, { channel: 'asc' }],
    include: { device: { select: { deviceIdentifier: true, organizationId: true } } },
  });

  return cameras.map((camera) =>
    toView(camera, { vehicleId, registrationNumber: vehicle.registrationNumber }),
  );
}

export interface RegisterCameraInput {
  channel: number;
  position?: string;
  label?: string;
  continuousRecording?: boolean;
  resolution?: string;
  frameRate?: number;
}

/**
 * Register or update one camera channel on a device.
 *
 * Upsert on (device, channel) because the channel is a physical input: fitting
 * a new lens to channel 2 replaces what was there, it does not add a second
 * camera 2.
 */
export async function registerCamera(
  auth: AuthContext,
  deviceId: string,
  input: RegisterCameraInput,
): Promise<CameraView> {
  const device = await prisma.hardwareDevice.findUnique({ where: { id: deviceId } });
  if (!device) throw errors.notFound('Device');
  assertTenantAccess(auth, device.organizationId, 'Device');

  if (input.channel > config.video.maxCamerasPerDevice) {
    throw errors.businessRule(
      `This device supports up to ${config.video.maxCamerasPerDevice} camera channels.`,
    );
  }

  const camera = await prisma.deviceCamera.upsert({
    where: { deviceId_channel: { deviceId, channel: input.channel } },
    create: {
      deviceId,
      organizationId: device.organizationId,
      channel: input.channel,
      position: (input.position ?? 'OTHER') as never,
      label: input.label ?? null,
      continuousRecording: input.continuousRecording ?? true,
      resolution: input.resolution ?? null,
      frameRate: input.frameRate ?? null,
    },
    update: {
      ...(input.position !== undefined ? { position: input.position as never } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.continuousRecording !== undefined
        ? { continuousRecording: input.continuousRecording }
        : {}),
      ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
      ...(input.frameRate !== undefined ? { frameRate: input.frameRate } : {}),
    },
    include: { device: { select: { deviceIdentifier: true, organizationId: true } } },
  });

  await recordAudit({
    action: AuditAction.CAMERA_REGISTERED,
    entityType: 'DeviceCamera',
    entityId: camera.id,
    actorUserId: auth.user.id,
    organizationId: device.organizationId,
    after: { channel: input.channel, position: input.position ?? 'OTHER' },
  });

  const assignments = await currentAssignments([deviceId]);
  return toView(camera, assignments.get(deviceId) ?? null);
}

export async function setCameraEnabled(
  auth: AuthContext,
  cameraId: string,
  enabled: boolean,
): Promise<CameraView> {
  const camera = await prisma.deviceCamera.findUnique({
    where: { id: cameraId },
    include: { device: { select: { deviceIdentifier: true, organizationId: true } } },
  });
  if (!camera) throw errors.notFound('Camera');
  assertTenantAccess(auth, camera.organizationId, 'Camera');

  const updated = await prisma.deviceCamera.update({
    where: { id: cameraId },
    data: { enabled, status: enabled ? camera.status : 'DISABLED' },
    include: { device: { select: { deviceIdentifier: true, organizationId: true } } },
  });

  const assignments = await currentAssignments([camera.deviceId]);
  return toView(updated, assignments.get(camera.deviceId) ?? null);
}

// ---------------------------------------------------------------------------
// Live viewing
// ---------------------------------------------------------------------------

export interface LiveViewResult {
  sessionId: string;
  gatewayUrl: string;
  token: string;
  protocol: string;
  expiresAt: string;
  iceServers: { urls: string; username?: string; credential?: string }[];
  posterUrl: string | null;
  simulated: boolean;
  camera: CameraView;
}

/**
 * Open a live view on one camera.
 *
 * The session row is written *before* the ticket is issued. If the gateway call
 * then fails, there is still a record that somebody tried — which is the point
 * of an access log for a camera pointed at a person.
 */
export async function startLiveView(
  auth: AuthContext,
  cameraId: string,
  context: { ipAddress: string | null; userAgent: string | null },
): Promise<LiveViewResult> {
  const camera = await prisma.deviceCamera.findUnique({
    where: { id: cameraId },
    include: { device: { select: { deviceIdentifier: true, organizationId: true } } },
  });
  if (!camera) throw errors.notFound('Camera');
  assertTenantAccess(auth, camera.organizationId, 'Camera');

  if (!hasPermission(auth.permissions, Permission.TELEMETRY_READ)) {
    throw errors.forbidden('You do not have permission to view vehicle cameras.');
  }

  const assignments = await currentAssignments([camera.deviceId]);
  const assignment = assignments.get(camera.deviceId) ?? null;

  if (!camera.enabled) {
    await recordDeniedSession(auth, camera, assignment, context, 'Camera is disabled.');
    throw errors.businessRule('This camera is switched off.');
  }

  if (!videoProvider.supportsLive) {
    await recordDeniedSession(
      auth,
      camera,
      assignment,
      context,
      'No video gateway configured.',
    );
    throw errors.providerNotConfigured('video', videoProvider.unavailableReason);
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.video.ticketTtlSeconds * 1000);

  const session = await prisma.videoStreamSession.create({
    data: {
      cameraId,
      organizationId: camera.organizationId,
      vehicleId: assignment?.vehicleId ?? null,
      requestedById: auth.user.id,
      status: 'REQUESTED',
      // Only the hash is stored. A stream credential in a database is a
      // credential in every backup of that database.
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    },
  });

  const ticket = await videoProvider.issueTicket({
    cameraId,
    deviceIdentifier: camera.device.deviceIdentifier,
    channel: camera.channel,
    sessionId: session.id,
    ttlSeconds: config.video.ticketTtlSeconds,
  });

  await prisma.videoStreamSession.update({
    where: { id: session.id },
    data: { status: 'ACTIVE', startedAt: new Date() },
  });

  await recordAudit({
    action: AuditAction.CAMERA_VIEWED,
    entityType: 'DeviceCamera',
    entityId: cameraId,
    actorUserId: auth.user.id,
    organizationId: camera.organizationId,
    after: {
      sessionId: session.id,
      channel: camera.channel,
      vehicleId: assignment?.vehicleId ?? null,
      simulated: ticket.simulated,
    },
  });

  cameraLogger.info(
    {
      cameraId,
      sessionId: session.id,
      userId: auth.user.id,
      vehicleId: assignment?.vehicleId ?? null,
    },
    'Live camera view opened',
  );

  return {
    sessionId: session.id,
    gatewayUrl: ticket.gatewayUrl,
    // The raw token is returned once, to the caller who asked for it, and never
    // again — the stored hash cannot reproduce it.
    token: ticket.token,
    protocol: ticket.protocol,
    expiresAt: ticket.expiresAt,
    iceServers: ticket.iceServers ?? [],
    posterUrl: ticket.posterUrl ?? null,
    simulated: ticket.simulated,
    camera: toView(camera, assignment),
  };
}

async function recordDeniedSession(
  auth: AuthContext,
  camera: { id: string; organizationId: string },
  assignment: { vehicleId: string } | null,
  context: { ipAddress: string | null; userAgent: string | null },
  reason: string,
): Promise<void> {
  await prisma.videoStreamSession.create({
    data: {
      cameraId: camera.id,
      organizationId: camera.organizationId,
      vehicleId: assignment?.vehicleId ?? null,
      requestedById: auth.user.id,
      status: 'DENIED',
      tokenHash: '',
      expiresAt: new Date(),
      reason,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    },
  });
}

/** Close a live view. Called by the client; also swept on expiry. */
// ---------------------------------------------------------------------------
// Publishing — device side
// ---------------------------------------------------------------------------

export interface PublishGrant {
  sessionId: string;
  ingestUrl: string;
  token: string;
  protocol: string;
  expiresAt: string;
  /**
   * STUN and TURN servers, when the deployment provides them.
   *
   * Empty on a LAN. A phone on a mobile network behind carrier-grade NAT
   * needs at least STUN to find a route to the gateway at all, so an empty
   * list here is a deployment answer rather than an omission.
   */
  iceServers: { urls: string; username?: string; credential?: string }[];
  constraints: {
    maxWidth: number;
    maxHeight: number;
    maxFrameRate: number;
    maxBitrateKbps: number;
  };
  simulated: boolean;
}

/**
 * Let a device push one of its cameras.
 *
 * The mirror of `startLiveView`, and it records into the same
 * `VideoStreamSession` table on purpose. A camera in a cab points at a person,
 * and the only thing that keeps that accountable is a complete record of when
 * it was on — which has to include the times the device started it, not merely
 * the times somebody watched.
 *
 * `requestedById` is the device's own id rather than a user's, because no user
 * asked. Recording the driver would be a claim about who acted that nobody
 * verified.
 */
export async function startPublishing(
  device: { id: string; deviceIdentifier: string; organizationId: string; vehicleId: string | null },
  channel: number,
): Promise<PublishGrant> {
  const camera = await prisma.deviceCamera.findUnique({
    where: { deviceId_channel: { deviceId: device.id, channel } },
  });
  if (!camera) {
    throw errors.notFound(
      'Camera',
      `This device has no camera registered on channel ${channel}.`,
    );
  }

  if (!camera.enabled) {
    throw errors.businessRule(
      'This camera has been switched off from the Saarthi dashboard.',
    );
  }

  if (!videoProvider.supportsPublishing) {
    // Told plainly, so the app can stop the encoder and say why rather than
    // opening the camera and sending frames into nothing — which on a phone
    // costs battery and a driver's mobile data for no result.
    throw errors.providerNotConfigured(
      'video',
      videoProvider.supportsLive
        ? 'This environment can display cameras but has nowhere for a device to publish to.'
        : videoProvider.unavailableReason,
    );
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.video.publishTtlSeconds * 1000);

  const session = await prisma.videoStreamSession.create({
    data: {
      cameraId: camera.id,
      organizationId: device.organizationId,
      vehicleId: device.vehicleId,
      requestedById: device.id,
      status: 'REQUESTED',
      // Only the hash is stored. A stream credential in a database is a
      // credential in every backup of that database.
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt,
      userAgent: `device:${device.deviceIdentifier}`,
    },
  });

  const ticket = await videoProvider.issuePublishTicket({
    cameraId: camera.id,
    deviceIdentifier: device.deviceIdentifier,
    channel,
    sessionId: session.id,
    ttlSeconds: config.video.publishTtlSeconds,
  });

  await prisma.$transaction([
    prisma.videoStreamSession.update({
      where: { id: session.id },
      data: { status: 'ACTIVE', startedAt: new Date() },
    }),
    prisma.deviceCamera.update({
      where: { id: camera.id },
      data: { status: 'ONLINE', lastFrameAt: new Date() },
    }),
  ]);

  cameraLogger.info(
    { deviceIdentifier: device.deviceIdentifier, channel, sessionId: session.id },
    'Device camera publishing started',
  );

  return {
    sessionId: session.id,
    ingestUrl: ticket.ingestUrl,
    token: ticket.token,
    protocol: ticket.protocol,
    expiresAt: ticket.expiresAt,
    constraints: ticket.constraints,
    iceServers: ticket.iceServers ?? [],
    simulated: ticket.simulated,
  };
}

/**
 * Close a session the device itself opened.
 *
 * Best-effort from the device's side — a phone that loses signal mid-stream
 * never gets to call this, which is what `runStreamSessionSweep` is for. When
 * it does arrive it gives the access log an honest end time rather than one
 * inferred from a timeout.
 */
export async function stopPublishing(
  device: { id: string },
  sessionId: string,
): Promise<void> {
  const session = await prisma.videoStreamSession.findUnique({
    where: { id: sessionId },
    include: { camera: { select: { id: true, deviceId: true } } },
  });
  if (!session) throw errors.notFound('Stream session');

  // A device may only close its own. Reported as not-found so one unit cannot
  // probe for another's session ids.
  if (session.camera.deviceId !== device.id) throw errors.notFound('Stream session');

  if (session.endedAt) return;

  await prisma.$transaction([
    prisma.videoStreamSession.update({
      where: { id: sessionId },
      data: { status: 'ENDED', endedAt: new Date() },
    }),
    prisma.deviceCamera.update({
      where: { id: session.camera.id },
      data: { status: 'OFFLINE' },
    }),
  ]);
}

/**
 * How long a session survives without hearing from whoever opened it.
 *
 * Distinct from the ticket TTL, and the distinction is the whole point.
 *
 * A *ticket* is a credential: short-lived on purpose, because it admits its
 * holder to a camera and a leaked one should be worthless within minutes. It
 * governs whether a *new* connection may be opened.
 *
 * A *session* is somebody watching. It should last exactly as long as they are
 * watching — which is not known in advance, so it cannot be a fixed window.
 * Conflating the two ended live views after two minutes and recorded every
 * viewing in the access log as two minutes long, however long it really was.
 *
 * So a connected client says "still here" periodically and this is the grace
 * period between those. Generous enough to ride out a stalled tab or a phone
 * on a weak signal; short enough that a browser somebody closed without warning
 * is not recorded as having watched for hours.
 */
const SESSION_KEEPALIVE_GRACE_MS = 2 * 60_000;

/**
 * Keep a session open because its client is still connected.
 *
 * Deliberately does not re-issue a ticket. The credential that opened the
 * connection has done its job and is not extended; this extends only Saarthi's
 * record that the connection is still up, which is what the access log and the
 * sweep read.
 */
export async function keepStreamSessionAlive(
  sessionId: string,
  actor: { auth?: AuthContext; deviceId?: string },
): Promise<{ expiresAt: string }> {
  const session = await prisma.videoStreamSession.findUnique({
    where: { id: sessionId },
    include: { camera: { select: { deviceId: true } } },
  });
  if (!session) throw errors.notFound('Stream session');

  if (actor.auth) {
    assertTenantAccess(actor.auth, session.organizationId, 'Stream session');
  } else if (actor.deviceId && session.camera.deviceId !== actor.deviceId) {
    // A device may only refresh its own, and is told "not found" so one unit
    // cannot probe for another's session ids.
    throw errors.notFound('Stream session');
  }

  // A session somebody has closed stays closed. Reviving it on a late keep-alive
  // from a client that has not noticed yet would defeat the Close button.
  if (session.status !== 'ACTIVE' && session.status !== 'REQUESTED') {
    throw errors.businessRule('This viewing session has already ended.');
  }

  const expiresAt = new Date(Date.now() + SESSION_KEEPALIVE_GRACE_MS);
  await prisma.videoStreamSession.update({
    where: { id: sessionId },
    data: { expiresAt, status: 'ACTIVE' },
  });

  return { expiresAt: expiresAt.toISOString() };
}

export async function endLiveView(auth: AuthContext, sessionId: string): Promise<void> {
  const session = await prisma.videoStreamSession.findUnique({ where: { id: sessionId } });
  if (!session) throw errors.notFound('Stream session');
  assertTenantAccess(auth, session.organizationId, 'Stream session');

  if (session.status !== 'ACTIVE') return;

  await prisma.videoStreamSession.update({
    where: { id: sessionId },
    data: { status: 'ENDED', endedAt: new Date() },
  });
}

/**
 * Who has watched this camera.
 *
 * Owner-level, because it is a record of people rather than of vehicles: it
 * answers "has my manager been watching me drive", which is a question a driver
 * is entitled to have answered accurately.
 */
export async function cameraAccessLog(auth: AuthContext, cameraId: string) {
  const camera = await prisma.deviceCamera.findUnique({ where: { id: cameraId } });
  if (!camera) throw errors.notFound('Camera');
  assertTenantAccess(auth, camera.organizationId, 'Camera');

  const sessions = await prisma.videoStreamSession.findMany({
    where: { cameraId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(sessions.map((row) => row.requestedById))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const names = new Map(
    users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]),
  );

  return sessions.map((session) => ({
    sessionId: session.id,
    watchedBy: names.get(session.requestedById) ?? 'Unknown',
    status: session.status,
    requestedAt: session.createdAt.toISOString(),
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    durationSeconds:
      session.startedAt && session.endedAt
        ? Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 1000)
        : null,
    reason: session.reason,
  }));
}

/** Recorded clips for one camera, newest first. Thumbnails only. */
export async function listCameraClips(
  auth: AuthContext,
  cameraId: string,
  query: { from?: Date; to?: Date; limit: number },
) {
  const camera = await prisma.deviceCamera.findUnique({
    where: { id: cameraId },
    include: { device: { select: { deviceIdentifier: true, organizationId: true } } },
  });
  if (!camera) throw errors.notFound('Camera');
  assertTenantAccess(auth, camera.organizationId, 'Camera');

  if (!videoProvider.supportsPlayback) {
    throw errors.providerNotConfigured('video', videoProvider.unavailableReason);
  }

  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 24 * 3_600_000);

  return videoProvider.listClips({
    cameraId,
    deviceIdentifier: camera.device.deviceIdentifier,
    channel: camera.channel,
    from,
    to,
    limit: query.limit,
  });
}

/**
 * Expire sessions whose ticket has lapsed.
 *
 * A browser that closes without telling the server would otherwise leave a
 * session showing as ACTIVE for ever, and the access log would misreport how
 * long someone watched.
 */
export async function runStreamSessionSweep(): Promise<number> {
  // `expiresAt` is pushed forward by `keepStreamSessionAlive` for as long as a
  // client is connected, so a session past it is one nobody is holding open any
  // more — a closed tab, a phone that lost signal, or a ticket never redeemed.
  // Ending those is what keeps the access log's durations honest.
  const result = await prisma.videoStreamSession.updateMany({
    where: { status: { in: ['REQUESTED', 'ACTIVE'] }, expiresAt: { lt: new Date() } },
    data: {
      status: 'ENDED',
      endedAt: new Date(),
      reason: 'Client stopped responding.',
    },
  });

  if (result.count > 0) {
    cameraLogger.debug({ ended: result.count }, 'Expired video stream sessions');
  }
  return result.count;
}
