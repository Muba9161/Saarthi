import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  cameraClipQuerySchema,
  idParamSchema,
  registerCameraSchema,
  setCameraEnabledSchema,
} from '@saarthi/shared';
import { created, noContent, ok, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requirePermission,
} from '../../server/guards';
import * as cameraService from './camera.service';

/**
 * Vehicle cameras.
 *
 * Registering a camera is device management (`devices.manage`); *watching* one
 * is a telemetry read, because that is the grant a dispatcher legitimately
 * holds. The access log is separate again and sits with the owner, since it
 * answers a question about people rather than about vehicles.
 */
export async function cameraRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/:id/cameras',
    {
      preHandler: [
        requirePermission(Permission.DEVICES_READ),
        requireFeature(Feature.HARDWARE_CONNECTIVITY),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await cameraService.listDeviceCameras(auth, id));
    },
  );

  app.post(
    '/:id/cameras',
    {
      preHandler: [
        requirePermission(Permission.DEVICES_MANAGE),
        requireFeature(Feature.HARDWARE_CONNECTIVITY),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(registerCameraSchema, request.body);
      return created(reply, await cameraService.registerCamera(auth, id, input));
    },
  );
}

/**
 * Camera-scoped routes: live view, clips and the access log.
 *
 * Mounted at `/cameras` rather than under the device, because a person opening
 * a live view is thinking about the camera in front of them, not about which
 * recorder it happens to be wired into.
 */
export async function cameraStreamRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.patch(
    '/:id',
    {
      preHandler: [
        requirePermission(Permission.DEVICES_MANAGE),
        requireFeature(Feature.HARDWARE_CONNECTIVITY),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(setCameraEnabledSchema, request.body);
      return ok(reply, await cameraService.setCameraEnabled(auth, id, input.enabled));
    },
  );

  /**
   * Open a live view.
   *
   * Rate limited hard. A ticket is a camera credential, and a loop requesting
   * them would both cost gateway capacity and fill the access log with noise
   * that hides a real pattern of someone watching a driver.
   */
  app.post(
    '/:id/live',
    {
      preHandler: [
        requirePermission(Permission.TELEMETRY_READ),
        requireFeature(Feature.TELEMETRY_LIVE),
      ],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);

      return ok(
        reply,
        await cameraService.startLiveView(auth, id, {
          ipAddress: request.clientIp ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        }),
      );
    },
  );

  /**
   * Still watching.
   *
   * Called periodically by an open player. Without it a live view would be cut
   * off mid-stream by the sweep, and every viewing would appear in the access
   * log as exactly one ticket-length long.
   *
   * Rate limit is generous because the player pings on a timer, and being
   * throttled here would end a session somebody is actively watching.
   */
  app.post(
    '/sessions/:id/keepalive',
    {
      preHandler: requirePermission(Permission.TELEMETRY_READ),
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await cameraService.keepStreamSessionAlive(id, { auth }));
    },
  );

  app.post(
    '/sessions/:id/end',
    { preHandler: requirePermission(Permission.TELEMETRY_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await cameraService.endLiveView(auth, id);
      return noContent(reply);
    },
  );

  app.get(
    '/:id/clips',
    {
      preHandler: [
        requirePermission(Permission.TELEMETRY_READ),
        requireFeature(Feature.TELEMETRY_HISTORY),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const query = parseQuery(cameraClipQuerySchema, request.query);
      return ok(reply, await cameraService.listCameraClips(auth, id, query));
    },
  );

  /**
   * Who has watched this camera.
   *
   * Owner-level. A driver asking whether their cabin camera has been watched
   * deserves a real answer, and that answer should not be available to whoever
   * happens to hold a dispatch login.
   */
  app.get(
    '/:id/access-log',
    { preHandler: requirePermission(Permission.DEVICES_MANAGE, Permission.ADMIN_AUDIT) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await cameraService.cameraAccessLog(auth, id));
    },
  );
}

/** Cameras currently pointed at one vehicle, for the passport screen. */
export async function vehicleCameraRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/:id/cameras',
    {
      preHandler: [
        requirePermission(Permission.TELEMETRY_READ),
        requireFeature(Feature.HARDWARE_CONNECTIVITY),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await cameraService.vehicleCameras(auth, id));
    },
  );
}
