import type { FastifyInstance } from 'fastify';
import {
  Permission,
  assignTrackerSchema,
  idParamSchema,
  purchaseTopUpSchema,
  purchaseTrackerSchema,
  selectPlanSchema,
} from '@saarthi/shared';
import { created, ok, parseBody, parseParams } from '../../lib/http';
import {
  requireAuth,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import * as planService from './plan.service';
import * as topUpService from './topup.service';
import * as trackerService from './tracker.service';

/**
 * Subscription, capacity and the tracker add-on.
 *
 * Reading any of it is a `SUBSCRIPTION_READ` action — a manager about to add a
 * vehicle should be able to see whether there is room. Buying, changing plan and
 * cancelling commit money, so they need `SUBSCRIPTION_MANAGE`, which only the
 * owner holds.
 */
export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // -------------------------------------------------------------------------
  // Plan
  // -------------------------------------------------------------------------

  /** The plan lineup, the top-up and the tracker, as the pricing screens render it. */
  app.get(
    '/plans',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_READ) },
    async (_request, reply) => ok(reply, planService.planCatalogue()),
  );

  app.get(
    '/plan',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await planService.currentPlan(organizationId));
    },
  );

  app.post(
    '/plan',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(selectPlanSchema, request.body ?? {});
      return ok(reply, await planService.selectPlan(auth, organizationId, input));
    },
  );

  // -------------------------------------------------------------------------
  // Vehicle capacity
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Trackers
  // -------------------------------------------------------------------------

  /** How much of the fleet is measured rather than inferred from a phone. */
  app.get(
    '/trackers/coverage',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await trackerService.trackerCoverage(organizationId));
    },
  );

  app.get(
    '/trackers',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await trackerService.listTrackers(organizationId));
    },
  );

  app.post(
    '/trackers',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(purchaseTrackerSchema, request.body ?? {});
      return created(reply, await trackerService.purchaseTracker(auth, organizationId, input));
    },
  );

  /** Fit a tracker to a vehicle, or take it off one. `truckId: null` detaches. */
  app.post(
    '/trackers/:id/assign',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(assignTrackerSchema, request.body ?? {});
      return ok(reply, await trackerService.assignTracker(auth, organizationId, id, input));
    },
  );

  app.post(
    '/trackers/:id/retire',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await trackerService.retireTracker(auth, organizationId, id));
    },
  );
}
