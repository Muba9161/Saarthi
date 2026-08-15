import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  acceptQuoteSchema,
  cancelOrderSchema,
  createOrderSchema,
  createQuoteSchema,
  idParamSchema,
  marketplaceQuerySchema,
  matchTransportSchema,
  orderListQuerySchema,
  rateOrderSchema,
  updateOrderSchema,
  updateOrderStatusSchema,
} from '@saarthi/shared';
import { created, noContent, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as orderService from './order.service';

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { preHandler: requirePermission(Permission.ORDERS_READ) }, async (request, reply) => {
    const auth = requireAuth(request);
    const query = parseQuery(orderListQuerySchema, request.query);
    const result = await orderService.listOrders(auth, query);
    return paginated(reply, result.items, result.pagination);
  });

  // Open requirements a fleet can bid on.
  app.get(
    '/marketplace',
    {
      preHandler: [
        requirePermission(Permission.ORDERS_QUOTE),
        requireFeature(Feature.ORDERS_MARKETPLACE),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(marketplaceQuerySchema, request.query);
      const result = await orderService.listOpenRequirements(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  // Rank available transport for a requirement — the customer comparison view.
  app.post(
    '/match',
    { preHandler: requirePermission(Permission.ORDERS_CREATE, Permission.ORDERS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(matchTransportSchema, request.body);
      return ok(reply, await orderService.matchTransport(auth, input));
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.ORDERS_CREATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(createOrderSchema, request.body);
      const order = await orderService.createOrder(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.ORDER_CREATED,
        entityType: 'Order',
        entityId: order.id,
        after: { reference: order.reference, materialName: order.materialName, quantity: order.quantity },
      });

      return created(reply, order);
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.ORDERS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await orderService.getOrder(auth, id));
    },
  );

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.ORDERS_CREATE, Permission.ORDERS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateOrderSchema, request.body);
      const order = await orderService.updateOrder(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.ORDER_UPDATED,
        entityType: 'Order',
        entityId: id,
        after: input,
      });

      return ok(reply, order);
    },
  );

  app.get(
    '/:id/quotes',
    { preHandler: requirePermission(Permission.ORDERS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await orderService.listQuotes(auth, id));
    },
  );

  app.post(
    '/:id/quotes',
    {
      preHandler: [
        requirePermission(Permission.ORDERS_QUOTE),
        requireFeature(Feature.ORDERS_MARKETPLACE),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(createQuoteSchema, request.body);
      const quote = await orderService.createQuote(auth, organizationId, id, input);

      await auditFromRequest(request, {
        action: AuditAction.ORDER_QUOTE_CREATED,
        entityType: 'OrderQuote',
        entityId: quote.id,
        after: { orderId: id, price: quote.price },
      });

      return created(reply, quote);
    },
  );

  app.delete(
    '/quotes/:id',
    { preHandler: requirePermission(Permission.ORDERS_QUOTE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const { id } = parseParams(idParamSchema, request.params);
      await orderService.withdrawQuote(auth, organizationId, id);
      return noContent(reply);
    },
  );

  app.post(
    '/:id/accept-quote',
    { preHandler: requirePermission(Permission.ORDERS_CREATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(acceptQuoteSchema, request.body);
      const result = await orderService.acceptQuote(auth, id, input.quoteId);

      await auditFromRequest(request, {
        action: AuditAction.ORDER_QUOTE_ACCEPTED,
        entityType: 'Order',
        entityId: id,
        after: { quoteId: input.quoteId, tripId: result.tripId },
      });

      return ok(reply, result);
    },
  );

  app.post(
    '/:id/status',
    { preHandler: requirePermission(Permission.ORDERS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateOrderStatusSchema, request.body);
      const order = await orderService.transitionOrder(auth, id, input.status, input.reason);

      await auditFromRequest(request, {
        action: AuditAction.ORDER_STATUS_CHANGED,
        entityType: 'Order',
        entityId: id,
        after: { status: input.status },
      });

      return ok(reply, order);
    },
  );

  app.post(
    '/:id/cancel',
    { preHandler: requirePermission(Permission.ORDERS_CREATE, Permission.ORDERS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(cancelOrderSchema, request.body);
      const order = await orderService.cancelOrder(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.ORDER_CANCELLED,
        entityType: 'Order',
        entityId: id,
        after: { reason: input.reason },
      });

      return ok(reply, order);
    },
  );

  app.post(
    '/:id/rate',
    { preHandler: requirePermission(Permission.ORDERS_RATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(rateOrderSchema, request.body);
      await orderService.rateOrder(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.ORDER_RATED,
        entityType: 'Order',
        entityId: id,
        after: { rating: input.rating },
      });

      return ok(reply, { rated: true });
    },
  );
}
