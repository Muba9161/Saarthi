import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  Feature,
  Permission,
  QrSubjectType,
  adjustScoreSchema,
  createDriverSchema,
  driverListQuerySchema,
  idParamSchema,
  joinFleetSchema,
  selfDriverSchema,
  updateDriverSchema,
} from '@saarthi/shared';
import { created, noContent, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as authService from '../../auth/auth.service';
import * as driverService from './driver.service';
import { driverAppInviteStatus, inviteDriversToApp } from './driver-app-invite.service';
import { releaseDriver } from './driver-release.service';
import * as qrService from '../qr/qr.service';
import { publicAppUrl } from '../../lib/public-url';

const driverAppInviteSchema = z.object({
  driverIds: z.array(z.string().uuid()).min(1).max(200),
});

export async function driverRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { preHandler: requirePermission(Permission.DRIVERS_READ) }, async (request, reply) => {
    const auth = requireAuth(request);
    const query = parseQuery(driverListQuerySchema, request.query);
    const result = await driverService.listDrivers(auth, query);
    return paginated(reply, result.items, result.pagination);
  });

  /** Which drivers have already been asked to install the Driver App. */
  app.get(
    '/app-invites',
    { preHandler: requirePermission(Permission.DRIVERS_READ) },
    async (request, reply) => ok(reply, await driverAppInviteStatus(requireAuth(request))),
  );

  /** Ask drivers to install the Saarthi Driver App — offered beside the tracker on telemetry. */
  app.post(
    '/app-invites',
    { preHandler: requirePermission(Permission.DRIVERS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(driverAppInviteSchema, request.body ?? {});
      return ok(reply, await inviteDriversToApp(auth, input.driverIds));
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.DRIVERS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await driverService.getDriver(auth, id));
    },
  );

  /*
   * A driver joining their employer's fleet with its invite code.
   *
   * Self-service by design, so it carries no permission gate beyond being a
   * driver: the code itself is the authorisation, and registration no longer
   * demands it up front (see `registerSchema`). The response is a fresh
   * session, because the driver's tenant changes with the move and the token
   * they arrived with names the seat they have just left.
   */
  app.post('/me/fleet', async (request, reply) => {
    const auth = requireAuth(request);
    const input = parseBody(joinFleetSchema, request.body);
    const result = await driverService.joinFleet(auth, input);

    await auditFromRequest(request, {
      action: AuditAction.DRIVER_JOINED_FLEET,
      entityType: 'Driver',
      entityId: result.driverId,
      // Recorded against the fleet that gained the driver, not the seat they
      // left: the receiving owner is who has to be able to see this happened,
      // and the seat is archived on the way out.
      organizationId: result.fleet.id,
      after: {
        organizationId: result.fleet.id,
        organizationName: result.fleet.name,
        vacatedOrganizationId: result.vacatedOrganizationId,
      },
    });

    return ok(
      reply,
      await authService.switchOrganization(auth.user.id, auth.sessionId, result.fleet.id),
    );
  });

  /*
   * The owner adding themselves to their own driver list — "Assign to
   * yourself" on a vehicle. Returns the existing profile when there is one, so
   * the vehicle dialog can call it without first asking.
   */
  app.post(
    '/me',
    { preHandler: requirePermission(Permission.DRIVERS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(selfDriverSchema, request.body);
      const result = await driverService.ensureSelfDriver(auth, organizationId, input);
      if (!result.created) return ok(reply, result.driver);

      // The owner's badge as a driver, issued exactly as for anybody added below.
      await qrService.provisionOnCreate(
        auth,
        QrSubjectType.DRIVER,
        result.driver.id,
        publicAppUrl(request),
      );

      await auditFromRequest(request, {
        action: AuditAction.DRIVER_CREATED,
        entityType: 'Driver',
        entityId: result.driver.id,
        after: { self: true, licenseNumber: result.driver.licenseNumber },
      });

      return created(reply, result.driver);
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.DRIVERS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(createDriverSchema, request.body);
      const result = await driverService.createDriver(auth, organizationId, input);

      // The driver's badge, issued with the account. See qr.service.ts.
      await qrService.provisionOnCreate(
        auth,
        QrSubjectType.DRIVER,
        result.driver.id,
        publicAppUrl(request),
      );

      await auditFromRequest(request, {
        action: AuditAction.DRIVER_CREATED,
        entityType: 'Driver',
        entityId: result.driver.id,
        after: { email: result.driver.email, licenseNumber: result.driver.licenseNumber },
      });

      return created(reply, result);
    },
  );

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.DRIVERS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateDriverSchema, request.body);
      const driver = await driverService.updateDriver(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.DRIVER_UPDATED,
        entityType: 'Driver',
        entityId: id,
        after: input,
      });

      return ok(reply, driver);
    },
  );

  /*
   * Remove a driver from this fleet. Not a deletion: the driver keeps their
   * account, history and documents, and is seated back on their own, free to
   * join another fleet — see `releaseDriver`.
   */
  app.delete(
    '/:id',
    { preHandler: requirePermission(Permission.DRIVERS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await releaseDriver(auth, id);
      await auditFromRequest(request, {
        action: AuditAction.DRIVER_RELEASED_FROM_FLEET,
        entityType: 'Driver',
        entityId: id,
        after: { releasedFrom: auth.organizationId },
      });
      return noContent(reply);
    },
  );

  app.get(
    '/:id/score',
    {
      preHandler: [
        requirePermission(Permission.DRIVERS_SCORE_READ),
        requireFeature(Feature.DRIVER_SCORING),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await driverService.getDriverScore(auth, id));
    },
  );

  app.post(
    '/:id/score/adjust',
    {
      preHandler: [
        requirePermission(Permission.DRIVERS_SCORE_ADJUST),
        requireFeature(Feature.DRIVER_SCORING),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(adjustScoreSchema, request.body);
      const score = await driverService.adjustDriverScore(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.DRIVER_SCORE_ADJUSTED,
        entityType: 'Driver',
        entityId: id,
        after: { category: input.category, points: input.points, reason: input.reason },
      });

      return ok(reply, score);
    },
  );

  app.get(
    '/:id/achievements',
    {
      preHandler: [
        requirePermission(Permission.DRIVERS_READ),
        requireFeature(Feature.DRIVER_ACHIEVEMENTS),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await driverService.getDriverAchievements(auth, id));
    },
  );
}
