import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  idParamSchema,
  resolveSosSchema,
  sosListQuerySchema,
  sosResponseSchema,
  sosUpdateSchema,
  triggerSosSchema,
} from '@saarthi/shared';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requireFeature, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as sosService from './sos.service';

/**
 * SOS routes.
 *
 * Triggering is deliberately the least-restricted write in the API: a driver
 * in trouble must never be blocked by a plan check or a rate limit, so the
 * feature gate applies to the *network* views, not to raising an alarm.
 */
export async function sosRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.post(
    '/',
    {
      preHandler: requirePermission(Permission.SOS_TRIGGER),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(triggerSosSchema, request.body);
      const incident = await sosService.triggerSos(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.SOS_TRIGGERED,
        entityType: 'SosIncident',
        entityId: incident.id,
        organizationId: incident.organizationId,
        after: { type: input.type, latitude: input.latitude, longitude: input.longitude },
      });

      return created(reply, incident);
    },
  );

  app.get('/', { preHandler: requirePermission(Permission.SOS_READ) }, async (request, reply) => {
    const auth = requireAuth(request);
    const query = parseQuery(sosListQuerySchema, request.query);
    const result = await sosService.listIncidents(auth, query);
    return paginated(reply, result.items, result.pagination);
  });

  // Requests waiting for this driver to accept or decline.
  app.get(
    '/requests',
    { preHandler: requirePermission(Permission.SOS_RESPOND) },
    async (request, reply) => {
      const auth = requireAuth(request);
      if (!auth.driverId) return ok(reply, []);
      return ok(reply, await sosService.pendingRequestsForDriver(auth.driverId));
    },
  );

  app.get('/:id', { preHandler: requirePermission(Permission.SOS_READ) }, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await sosService.getIncident(auth, id));
  });

  app.post(
    '/:id/respond',
    {
      preHandler: [
        requirePermission(Permission.SOS_RESPOND),
        requireFeature(Feature.SOS_NETWORK),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(sosResponseSchema, request.body);
      const incident = await sosService.respondToIncident(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.SOS_UPDATED,
        entityType: 'SosIncident',
        entityId: id,
        after: { action: input.action },
      });

      return ok(reply, incident);
    },
  );

  app.post(
    '/:id/status',
    { preHandler: requirePermission(Permission.SOS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(sosUpdateSchema, request.body);
      const incident = await sosService.updateIncidentStatus(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.SOS_UPDATED,
        entityType: 'SosIncident',
        entityId: id,
        after: { status: input.status },
      });

      return ok(reply, incident);
    },
  );

  app.post(
    '/:id/resolve',
    { preHandler: requirePermission(Permission.SOS_MANAGE, Permission.SOS_TRIGGER) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(resolveSosSchema, request.body);
      const incident = await sosService.resolveIncident(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.SOS_RESOLVED,
        entityType: 'SosIncident',
        entityId: id,
        after: { resolutionNote: input.resolutionNote },
      });

      return ok(reply, incident);
    },
  );

  // Manually widen the responder search.
  app.post(
    '/:id/expand-search',
    { preHandler: requirePermission(Permission.SOS_MANAGE) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      const expanded = await sosService.expandSearchRadius(id);
      return ok(reply, { expanded });
    },
  );
}
