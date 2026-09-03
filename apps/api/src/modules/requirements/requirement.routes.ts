import type { FastifyInstance } from 'fastify';
import {
  Permission,
  awardBidSchema,
  bidListQuerySchema,
  cancelRequirementSchema,
  createRequirementSchema,
  idParamSchema,
  placeBidSchema,
  rejectBidSchema,
  requirementBoardQuerySchema,
  requirementListQuerySchema,
  shortlistBidSchema,
  updateRequirementSchema,
} from '@saarthi/shared';
import {
  created,
  noContent,
  ok,
  paginated,
  parseBody,
  parseParams,
  parseQuery,
} from '../../lib/http';
import { requireAuth, requireOrganizationId, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as requirementService from './requirement.service';

/**
 * Requirement routes.
 *
 * Grouped by audience, because the same row is two different things depending
 * on who is asking:
 *
 *   /requirements            — the customer's own requirements and their bids
 *   /requirements/board      — open requirements a provider may bid on
 *   /requirements/me/bids    — what this provider has offered, across the board
 *
 * There is no organization-type guard on these routes. The check that matters
 * is per-requirement rather than per-route — a supplier and a fleet legitimately
 * reach the same material requirement with different scopes — so it lives in
 * the service, where the requirement is actually in hand.
 */
export async function requirementRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // -------------------------------------------------------------------------
  // The provider board. Registered before /:id so "board" is never read as one.
  // -------------------------------------------------------------------------

  app.get(
    '/board',
    { preHandler: requirePermission(Permission.REQUIREMENTS_BID, Permission.REQUIREMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(requirementBoardQuerySchema, request.query);
      const result = await requirementService.listBoard(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/me/bids',
    { preHandler: requirePermission(Permission.REQUIREMENTS_BID) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(requirementListQuerySchema, request.query);
      const result = await requirementService.listOwnBids(auth, organizationId, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  // -------------------------------------------------------------------------
  // Customer side
  // -------------------------------------------------------------------------

  app.get(
    '/',
    { preHandler: requirePermission(Permission.REQUIREMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(requirementListQuerySchema, request.query);
      const result = await requirementService.listRequirements(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.REQUIREMENTS_CREATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(createRequirementSchema, request.body);
      const requirement = await requirementService.createRequirement(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.REQUIREMENT_CREATED,
        entityType: 'Requirement',
        entityId: requirement.id,
        after: { reference: requirement.reference, kind: requirement.kind, title: requirement.title },
      });

      return created(reply, requirement);
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.REQUIREMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await requirementService.getRequirement(auth, id));
    },
  );

  app.get(
    '/:id/timeline',
    { preHandler: requirePermission(Permission.REQUIREMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await requirementService.getTimeline(auth, id));
    },
  );

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.REQUIREMENTS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateRequirementSchema, request.body);
      const requirement = await requirementService.updateRequirement(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.REQUIREMENT_UPDATED,
        entityType: 'Requirement',
        entityId: id,
        after: input,
      });

      return ok(reply, requirement);
    },
  );

  app.post(
    '/:id/cancel',
    { preHandler: requirePermission(Permission.REQUIREMENTS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(cancelRequirementSchema, request.body);
      const requirement = await requirementService.cancelRequirement(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.REQUIREMENT_CANCELLED,
        entityType: 'Requirement',
        entityId: id,
        after: { reason: input.reason },
      });

      return ok(reply, requirement);
    },
  );

  // -------------------------------------------------------------------------
  // Bids
  // -------------------------------------------------------------------------

  app.get(
    '/:id/bids',
    { preHandler: requirePermission(Permission.REQUIREMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      // Parsed so an unknown filter is rejected rather than silently ignored.
      parseQuery(bidListQuerySchema, request.query);
      return ok(reply, await requirementService.listBids(auth, id));
    },
  );

  app.post(
    '/:id/bids',
    { preHandler: requirePermission(Permission.REQUIREMENTS_BID) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(placeBidSchema, request.body);
      const bid = await requirementService.placeBid(auth, organizationId, id, input);

      await auditFromRequest(request, {
        action: AuditAction.REQUIREMENT_BID_PLACED,
        entityType: 'RequirementBid',
        entityId: bid.id,
        after: { requirementId: id, scope: bid.scope, price: bid.price },
      });

      return created(reply, bid);
    },
  );

  app.delete(
    '/bids/:id',
    { preHandler: requirePermission(Permission.REQUIREMENTS_BID) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const { id } = parseParams(idParamSchema, request.params);
      await requirementService.withdrawBid(auth, organizationId, id);

      await auditFromRequest(request, {
        action: AuditAction.REQUIREMENT_BID_WITHDRAWN,
        entityType: 'RequirementBid',
        entityId: id,
      });

      return noContent(reply);
    },
  );

  app.post(
    '/:id/shortlist',
    { preHandler: requirePermission(Permission.REQUIREMENTS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(shortlistBidSchema, request.body);
      const bid = await requirementService.shortlistBid(auth, id, input.bidId, input.shortlisted);

      await auditFromRequest(request, {
        action: AuditAction.REQUIREMENT_BID_SHORTLISTED,
        entityType: 'RequirementBid',
        entityId: input.bidId,
        after: { shortlisted: input.shortlisted },
      });

      return ok(reply, bid);
    },
  );

  app.post(
    '/:id/reject',
    { preHandler: requirePermission(Permission.REQUIREMENTS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(rejectBidSchema, request.body);
      const bid = await requirementService.rejectBid(auth, id, input.bidId, input.reason);

      await auditFromRequest(request, {
        action: AuditAction.REQUIREMENT_BID_REJECTED,
        entityType: 'RequirementBid',
        entityId: input.bidId,
        after: { reason: input.reason },
      });

      return ok(reply, bid);
    },
  );

  /**
   * Award a bid.
   *
   * The most consequential call in the module: it appoints a counterparty and,
   * once nothing is outstanding, creates the order or booking that commits both
   * sides. Audited with the resulting record id so the trail survives even if
   * the requirement is later cancelled.
   */
  app.post(
    '/:id/award',
    { preHandler: requirePermission(Permission.REQUIREMENTS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(awardBidSchema, request.body);
      const result = await requirementService.awardBid(auth, id, input.bidId, input.note);

      await auditFromRequest(request, {
        action: AuditAction.REQUIREMENT_BID_AWARDED,
        entityType: 'Requirement',
        entityId: id,
        after: {
          bidId: input.bidId,
          status: result.requirement.status,
          orderId: result.orderId,
          bookingId: result.bookingId,
          tripId: result.tripId,
        },
      });

      return ok(reply, result);
    },
  );
}
