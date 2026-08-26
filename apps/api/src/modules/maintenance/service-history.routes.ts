import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  idParamSchema,
  serviceHistoryQuerySchema,
  serviceRecordSchema,
  syncServiceHistorySchema,
  updateServiceRecordSchema,
  verifyServiceRecordSchema,
} from '@saarthi/shared';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import * as serviceHistory from './service-history.service';

/**
 * Service history.
 *
 * Mounted apart from `/maintenance`, which schedules future work: these routes
 * are about what a vehicle has already had done to it. Same permission, because
 * the person who schedules the job is the person who files the invoice.
 */
export async function serviceHistoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_READ),
        requireFeature(Feature.MAINTENANCE_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(serviceHistoryQuerySchema, request.query);
      const result = await serviceHistory.listServiceRecords(auth, organizationId, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/:id',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_READ),
        requireFeature(Feature.MAINTENANCE_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await serviceHistory.getServiceRecord(auth, id));
    },
  );

  app.post(
    '/',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_MANAGE),
        requireFeature(Feature.MAINTENANCE_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(serviceRecordSchema, request.body);
      return created(reply, await serviceHistory.recordService(auth, organizationId, input));
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_MANAGE),
        requireFeature(Feature.MAINTENANCE_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateServiceRecordSchema, request.body);
      return ok(reply, await serviceHistory.updateServiceRecord(auth, id, input));
    },
  );

  /**
   * Confirm or reject a record that came from outside the fleet.
   *
   * The only route that can set VERIFIED. Nothing automatic reaches it — not an
   * import, not a provider sync, and above all not AI extraction.
   */
  app.post(
    '/:id/verify',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_MANAGE),
        requireFeature(Feature.MAINTENANCE_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(verifyServiceRecordSchema, request.body);
      return ok(reply, await serviceHistory.verifyServiceRecord(auth, id, input));
    },
  );
}

/**
 * Per-vehicle service surfaces, mounted under the vehicle path so the passport
 * screen loads them from where the rest of the vehicle record lives.
 */
export async function vehicleServiceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/:id/service-history',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_READ),
        requireFeature(Feature.MAINTENANCE_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await serviceHistory.vehicleServiceTimeline(auth, id));
    },
  );

  app.post(
    '/:id/service-history/sync',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_MANAGE),
        requireFeature(Feature.MAINTENANCE_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(syncServiceHistorySchema, request.body ?? {});
      return ok(reply, await serviceHistory.syncServiceHistory(auth, id, input));
    },
  );
}
