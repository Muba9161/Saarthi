import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  Permission,
  assignTrackerSchema,
  idParamSchema,
  purchaseTopUpSchema,
  purchaseTrackerSchema,
  purchaseVehicleOrderSchema,
  selectPlanSchema,
  startAutopaySchema,
} from '@saarthi/shared';
import { created, ok, parseBody, parseParams } from '../../lib/http';
import {
  requireAuth,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import * as autopayService from './autopay.service';
import { billingHistory } from './billing-history.service';
import { purchaseVehicleOrder } from './vehicle-order.service';
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
const pendingReferenceSchema = z.object({
  reference: z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

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
  // Billing: the trial, autopay and paying for the plan
  // -------------------------------------------------------------------------

  app.get(
    '/billing',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await autopayService.billingStatus(organizationId));
    },
  );

  /** Every payment to Saarthi and every plan event, newest first, with what comes next. */
  app.get(
    '/billing/history',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_READ) },
    async (request, reply) => ok(reply, await billingHistory(requireOrganizationId(request))),
  );

  /** Set up autopay. Returns a checkout to authorise it on a hosted gateway. */
  app.post(
    '/billing/autopay',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const { returnTo } = parseBody(startAutopaySchema, request.body ?? {});
      return ok(reply, await autopayService.startAutopay(auth, organizationId, returnTo));
    },
  );

  /** Where the mandate stands — called when the owner returns from authorising it. */
  app.post(
    '/billing/autopay/refresh',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await autopayService.refreshAutopay(organizationId));
    },
  );

  app.post(
    '/billing/autopay/cancel',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      return ok(reply, await autopayService.cancelAutopay(auth, organizationId));
    },
  );

  /** Pay for a month now — to renew a lapsed plan or pay without autopay. */
  app.post(
    '/billing/pay',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      return ok(reply, await autopayService.payPlanNow(auth, organizationId));
    },
  );

  /** Re-open the checkout for extra vehicles and trackers still waiting to be paid for. */
  app.post(
    '/billing/pending/:reference/checkout',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const { reference } = parseParams(pendingReferenceSchema, request.params);
      return ok(reply, await autopayService.resumePendingPayment(auth, organizationId, reference));
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

  /** The add-vehicle form's one payment: the vehicle's slot and/or its tracker. */
  app.post(
    '/vehicle-order',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(purchaseVehicleOrderSchema, request.body ?? {});
      return created(reply, await purchaseVehicleOrder(auth, organizationId, input));
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
