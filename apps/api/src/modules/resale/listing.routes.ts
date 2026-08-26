import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  createVehicleListingSchema,
  idParamSchema,
  listingListQuerySchema,
  updateVehicleListingSchema,
  withdrawListingSchema,
} from '@saarthi/shared';
import { created, makePagination, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requireFeature, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as listingService from './listing.service';

/**
 * Vehicle resale — seller routes.
 *
 * Only the seller's own side is exposed here: creating a listing from a vehicle
 * they own, editing it while it is still editable, publishing it once the gates
 * pass, and withdrawing it. Buyer-facing browse and offer routes are a separate
 * surface with a different permission.
 */
export async function resaleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /**
   * The marketplace itself.
   *
   * Open to anyone who may browse resale; the seller's walk-away price is never
   * part of this payload.
   */
  app.get(
    '/listings',
    {
      preHandler: [
        requirePermission(Permission.RESALE_BROWSE),
        requireFeature(Feature.RESALE_MARKETPLACE),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(listingListQuerySchema, request.query);
      const result = await listingService.browseListings(auth, query);
      return paginated(
        reply,
        result.items,
        makePagination(query.page, query.pageSize, result.total),
      );
    },
  );

  /**
   * The listing attached to a vehicle, if any.
   *
   * Answers `null` rather than 404 so the vehicle's Sell tab can render its
   * empty state without treating a normal "not listed yet" as an error.
   */
  app.get(
    '/listings/vehicle/:id',
    {
      preHandler: [
        requirePermission(Permission.RESALE_MANAGE),
        requireFeature(Feature.RESALE_MARKETPLACE),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await listingService.findListingForVehicle(auth, id));
    },
  );

  app.get(
    '/listings/:id',
    {
      preHandler: [
        requirePermission(Permission.RESALE_MANAGE),
        requireFeature(Feature.RESALE_MARKETPLACE),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await listingService.getOwnListing(auth, id));
    },
  );

  app.post(
    '/listings',
    {
      preHandler: [
        requirePermission(Permission.RESALE_MANAGE),
        requireFeature(Feature.RESALE_PUBLISH),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(createVehicleListingSchema, request.body);
      const result = await listingService.createListing(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.LISTING_CREATED,
        entityType: 'VehicleListing',
        entityId: result.listing.id,
        after: {
          reference: result.listing.reference,
          vehicleId: result.listing.vehicleId,
          askingPrice: Number(result.listing.askingPrice),
        },
      });

      return created(reply, result);
    },
  );

  app.patch(
    '/listings/:id',
    {
      preHandler: [
        requirePermission(Permission.RESALE_MANAGE),
        requireFeature(Feature.RESALE_PUBLISH),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateVehicleListingSchema, request.body);
      const result = await listingService.updateListing(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.LISTING_UPDATED,
        entityType: 'VehicleListing',
        entityId: id,
        after: { reference: result.listing.reference, status: result.listing.status },
      });

      return ok(reply, result);
    },
  );

  // Committing the vehicle to the market is the owner's decision, not a
  // manager's — RESALE_OFFER sits at owner level for exactly this reason.
  app.post(
    '/listings/:id/publish',
    {
      preHandler: [
        requirePermission(Permission.RESALE_OFFER),
        requireFeature(Feature.RESALE_PUBLISH),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const result = await listingService.publishListing(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.LISTING_PUBLISHED,
        entityType: 'VehicleListing',
        entityId: id,
        after: {
          reference: result.listing.reference,
          askingPrice: Number(result.listing.askingPrice),
          visibility: result.listing.visibility,
        },
      });

      return ok(reply, result);
    },
  );

  app.post(
    '/listings/:id/withdraw',
    { preHandler: requirePermission(Permission.RESALE_OFFER) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(withdrawListingSchema, request.body);
      const result = await listingService.withdrawListing(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.LISTING_WITHDRAWN,
        entityType: 'VehicleListing',
        entityId: id,
        after: { reference: result.listing.reference, reason: input.reason },
      });

      return ok(reply, result);
    },
  );
}
