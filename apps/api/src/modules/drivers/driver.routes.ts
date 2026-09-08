import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  QrSubjectType,
  adjustScoreSchema,
  createDriverSchema,
  driverListQuerySchema,
  idParamSchema,
  joinFleetSchema,
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
import * as qrService from '../qr/qr.service';
import { publicAppUrl } from '../../lib/public-url';

export async function driverRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { preHandler: requirePermission(Permission.DRIVERS_READ) }, async (request, reply) => {
    const auth = requireAuth(request);
    const query = parseQuery(driverListQuerySchema, request.query);
    const result = await driverService.listDrivers(auth, query);
    return paginated(reply, result.items, result.pagination);
  });

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

  app.delete(
    '/:id',
    { preHandler: requirePermission(Permission.DRIVERS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await driverService.archiveDriver(auth, id);
      await auditFromRequest(request, {
        action: AuditAction.DRIVER_UPDATED,
        entityType: 'Driver',
        entityId: id,
        after: { archived: true },
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
