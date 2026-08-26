import type { FastifyInstance } from 'fastify';
import {
  PLAN_CATALOGUE,
  Permission,
  VEHICLE_TOPUP,
  idParamSchema,
  purchaseTopUpSchema,
} from '@saarthi/shared';
import { created, ok, parseBody, parseParams } from '../../lib/http';
import {
  requireAuth,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import * as topUpService from './topup.service';

/**
 * Subscription capacity.
 *
 * Reading capacity is a `SUBSCRIPTION_READ` action — a manager about to add a
 * vehicle should be able to see whether there is room. Buying and cancelling
 * commit money, so they need `SUBSCRIPTION_MANAGE`, which only the owner holds.
 */
export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/capacity',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await topUpService.vehicleCapacity(organizationId));
    },
  );

  app.get(
    '/topups',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await topUpService.listTopUps(organizationId));
    },
  );

  /** The plan lineup plus the top-up, as the pricing screens render it. */
  app.get(
    '/plans',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_READ) },
    async (_request, reply) => ok(reply, { plans: PLAN_CATALOGUE, topUp: VEHICLE_TOPUP }),
  );

  app.post(
    '/topups',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(purchaseTopUpSchema, request.body ?? {});
      const result = await topUpService.purchaseTopUp(auth, organizationId, input);
      return created(reply, result);
    },
  );

  app.post(
    '/topups/:id/cancel',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await topUpService.cancelTopUp(auth, organizationId, id));
    },
  );
}
