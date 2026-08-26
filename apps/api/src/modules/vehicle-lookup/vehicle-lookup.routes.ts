import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  lookupIdParamSchema,
  storedLookupQuerySchema,
  vehicleLookupSchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { ok, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requireFeature, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as vehicleLookupService from './vehicle-lookup.service';

/**
 * Vehicle registration (RC) lookup routes.
 *
 * Mounted under `/vehicles` beside the owned-vehicle routes, so the public
 * surface reads `POST /api/v1/vehicles/lookup` while the two implementations
 * stay in separate modules.
 *
 * Every lookup costs money at the provider and returns personal data, so this
 * router is the most tightly gated in the API: authentication, an explicit
 * permission, a plan entitlement, its own rate limit on top of the global one,
 * and an audit entry for both the lookup and the document read.
 */
export async function vehicleLookupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /**
   * The record Saarthi already holds, if any.
   *
   * Free and idempotent: no provider call, no charge, no budget consumed. The
   * vehicle's Registration tab calls this on open so a record fetched last week
   * is simply there, rather than vanishing on every refresh.
   */
  app.get(
    '/lookups/latest',
    {
      preHandler: [
        requirePermission(Permission.VEHICLE_LOOKUP),
        requireFeature(Feature.FLEET_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { registrationNumber } = parseQuery(storedLookupQuerySchema, request.query);
      return ok(reply, await vehicleLookupService.getStoredLookup(auth, registrationNumber));
    },
  );

  app.post(
    '/lookup',
    {
      config: {
        rateLimit: {
          max: config.vehicleRc.rateLimitMax,
          timeWindow: config.vehicleRc.rateLimitWindow,
        },
      },
      preHandler: [
        requirePermission(Permission.VEHICLE_LOOKUP),
        requireFeature(Feature.FLEET_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(vehicleLookupSchema, request.body);
      const { result, audit, budgetRemaining } = await vehicleLookupService.lookupVehicle(
        auth,
        input,
      );

      await auditFromRequest(request, {
        action: AuditAction.VEHICLE_RC_LOOKUP,
        entityType: 'VehicleLookup',
        entityId: audit.lookupId,
        // Registration number only — the RC record itself never enters the log.
        after: {
          registrationNumber: audit.registrationNumber,
          cached: audit.cached,
          pdfStored: audit.pdfStored,
          providerReference: audit.providerReference,
          sensitiveFieldsIncluded: vehicleLookupService.canSeeSensitiveVehicleData(auth),
        },
      });

      // Reported in `meta` rather than the payload: it describes this
      // environment's allowance, not the vehicle that was looked up.
      return ok(
        reply,
        result,
        budgetRemaining === null ? undefined : { budgetRemaining },
      );
    },
  );

  // Streams Saarthi's own stored copy of the RC certificate. The provider's
  // temporary link is never exposed to the browser.
  app.get(
    '/lookups/:lookupId/document',
    {
      preHandler: [
        requirePermission(Permission.VEHICLE_LOOKUP),
        requireFeature(Feature.FLEET_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { lookupId } = parseParams(lookupIdParamSchema, request.params);
      const inline = (request.query as { disposition?: string }).disposition === 'inline';

      const document = await vehicleLookupService.downloadRcDocument(auth, lookupId);

      await auditFromRequest(request, {
        action: AuditAction.VEHICLE_RC_PDF_DOWNLOADED,
        entityType: 'VehicleLookup',
        entityId: lookupId,
        organizationId: document.organizationId,
        after: { registrationNumber: document.registrationNumber },
      });

      const safeName = document.fileName.replace(/"/g, '');
      return reply
        .header('content-type', document.mimeType)
        .header('content-length', document.size)
        .header(
          'content-disposition',
          `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
        )
        // Contains personal data: never cached by a shared proxy.
        .header('cache-control', 'private, no-store')
        .send(document.stream);
    },
  );
}
