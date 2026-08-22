import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  cancelReturnLoadSchema,
  createReturnLoadSchema,
  emptyRiskQuerySchema,
  idParamSchema,
  matchListQuerySchema,
  opportunityQuerySchema,
  quoteFromMatchSchema,
  rejectMatchSchema,
  returnCandidateQuerySchema,
  returnLoadListQuerySchema,
  updateReturnLoadSchema,
} from '@saarthi/shared';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as returnLoadService from './return-load.service';

/**
 * Return-load routes.
 *
 * Reads are open to anyone with `returnloads.read`, including drivers, who see
 * their own vehicle's return plan. Writes need `returnloads.manage`, and turning
 * a match into a quote additionally needs `orders.quote` — because that is the
 * action that commits the fleet to a price.
 */
export async function returnLoadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireFeature(Feature.RETURN_LOADS));

  app.get(
    '/',
    { preHandler: requirePermission(Permission.RETURN_LOADS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(returnLoadListQuerySchema, request.query);
      const result = await returnLoadService.listReturnLoads(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.RETURN_LOADS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(createReturnLoadSchema, request.body);
      const result = await returnLoadService.createReturnLoad(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.RETURN_LOAD_CREATED,
        entityType: 'ReturnLoadRequest',
        entityId: result.id,
        organizationId,
        after: {
          truckId: result.truckId,
          origin: result.originAddress,
          destination: result.destinationAddress,
        },
      });

      return created(reply, result);
    },
  );

  /**
   * Trips arriving soon with nothing lined up for the way home.
   * Declared before `/:id` so "empty-risk" is not read as an id.
   */
  app.get(
    '/empty-risk',
    { preHandler: requirePermission(Permission.RETURN_LOADS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const { horizonHours } = parseQuery(emptyRiskQuerySchema, request.query);
      return ok(
        reply,
        await returnLoadService.emptyReturnRisk(auth, organizationId, horizonHours),
      );
    },
  );

  app.get(
    '/opportunities',
    { preHandler: requirePermission(Permission.RETURN_LOADS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(opportunityQuerySchema, request.query);
      return ok(
        reply,
        await returnLoadService.opportunities(auth, organizationId, {
          horizonHours: query.horizonHours,
          ...(query.minScore !== undefined ? { minScore: query.minScore } : {}),
          ...(query.truckId ? { truckId: query.truckId } : {}),
        }),
      );
    },
  );

  app.post(
    '/matches/:id/quote',
    {
      preHandler: [
        requirePermission(Permission.RETURN_LOADS_MANAGE),
        requirePermission(Permission.ORDERS_QUOTE),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(quoteFromMatchSchema, request.body);
      const result = await returnLoadService.quoteFromMatch(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.RETURN_LOAD_QUOTED,
        entityType: 'OrderQuote',
        entityId: result.quoteId,
        after: { orderId: result.orderId, matchId: result.matchId, price: input.price },
      });

      return created(reply, result);
    },
  );

  app.post(
    '/matches/:id/reject',
    { preHandler: requirePermission(Permission.RETURN_LOADS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const { reason } = parseBody(rejectMatchSchema, request.body);
      await returnLoadService.rejectMatch(auth, id, reason);
      return ok(reply, { rejected: true });
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.RETURN_LOADS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await returnLoadService.getReturnLoad(auth, id));
    },
  );

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.RETURN_LOADS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateReturnLoadSchema, request.body);
      const result = await returnLoadService.updateReturnLoad(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.RETURN_LOAD_UPDATED,
        entityType: 'ReturnLoadRequest',
        entityId: id,
        after: input,
      });

      return ok(reply, result);
    },
  );

  app.post(
    '/:id/cancel',
    { preHandler: requirePermission(Permission.RETURN_LOADS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const { reason } = parseBody(cancelReturnLoadSchema, request.body);
      const result = await returnLoadService.cancelReturnLoad(auth, id, reason);

      await auditFromRequest(request, {
        action: AuditAction.RETURN_LOAD_CANCELLED,
        entityType: 'ReturnLoadRequest',
        entityId: id,
        after: { reason: reason ?? null },
      });

      return ok(reply, result);
    },
  );

  app.get(
    '/:id/matches',
    { preHandler: requirePermission(Permission.RETURN_LOADS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const query = parseQuery(matchListQuerySchema, request.query);
      const result = await returnLoadService.listMatches(auth, id, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.post(
    '/:id/refresh-matches',
    { preHandler: requirePermission(Permission.RETURN_LOADS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const result = await returnLoadService.refreshMatches(auth, id, { notify: false });

      await auditFromRequest(request, {
        action: AuditAction.RETURN_LOAD_MATCHED,
        entityType: 'ReturnLoadRequest',
        entityId: id,
        after: result,
      });

      return ok(reply, result);
    },
  );
}

/**
 * Mounted on the order surface rather than here, because it answers a question
 * about an order ("which of my trucks is already heading this way") and belongs
 * next to the order it is asked about.
 */
export async function orderReturnCandidateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/:id/return-candidates',
    {
      preHandler: [
        requirePermission(Permission.ORDERS_MANAGE),
        requireFeature(Feature.RETURN_LOADS),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const query = parseQuery(returnCandidateQuerySchema, request.query);
      return ok(
        reply,
        await returnLoadService.returnCandidatesForOrder(auth, id, {
          ...(query.minScore !== undefined ? { minScore: query.minScore } : {}),
          limit: query.limit,
        }),
      );
    },
  );
}
