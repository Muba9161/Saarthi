import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  licenceLookupSchema,
  storedLicenceQuerySchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { ok, parseBody, parseQuery } from '../../lib/http';
import { requireAuth, requireFeature, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as licenceService from './licence-lookup.service';

/**
 * Driving licence lookup routes.
 *
 * Mounted under `/drivers`, so the public surface reads
 * `POST /api/v1/drivers/licence/lookup` while the implementation stays in its
 * own module alongside the vehicle RC one.
 *
 * Gated like the RC routes and for the same reasons — a licence record is
 * personal data and every call is billable.
 */
export async function licenceLookupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /**
   * The record Saarthi already holds. No provider call, no charge, no budget —
   * this is what the driver's Licence tab shows the moment it opens.
   */
  app.get(
    '/licence/latest',
    {
      preHandler: [
        requirePermission(Permission.DRIVER_LICENCE_LOOKUP),
        requireFeature(Feature.FLEET_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { licenceNumber } = parseQuery(storedLicenceQuerySchema, request.query);
      return ok(reply, await licenceService.getStoredLicence(auth, licenceNumber));
    },
  );

  app.post(
    '/licence/lookup',
    {
      config: {
        rateLimit: {
          max: config.drivingLicence.rateLimitMax,
          timeWindow: config.drivingLicence.rateLimitWindow,
        },
      },
      preHandler: [
        requirePermission(Permission.DRIVER_LICENCE_LOOKUP),
        requireFeature(Feature.FLEET_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(licenceLookupSchema, request.body);
      const { result, audit, budgetRemaining } = await licenceService.lookupLicence(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.DRIVER_LICENCE_LOOKUP,
        entityType: 'LicenceLookup',
        entityId: audit.lookupId,
        // Licence number and outcome only — the holder's details never enter
        // the audit log, and neither does the date of birth used to verify.
        after: {
          licenceNumber: audit.licenceNumber,
          driverId: audit.driverId,
          cached: audit.cached,
          providerReference: audit.providerReference,
          sensitiveFieldsIncluded: licenceService.canSeeSensitiveLicenceData(auth),
        },
      });

      return ok(
        reply,
        result,
        budgetRemaining === null ? undefined : { budgetRemaining },
      );
    },
  );
}
