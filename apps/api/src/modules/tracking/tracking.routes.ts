import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  idParamSchema,
  trackingBatchSchema,
  trackingHistoryQuerySchema,
  trackingLocationSchema,
} from '@saarthi/shared';
import { created, ok, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import * as trackingService from './tracking.service';

/**
 * Tracking API.
 *
 * `POST /tracking/locations` is the single ingestion point shared by the mock
 * simulator, the driver app and (in production) the GPS provider webhook.
 */
export async function trackingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.post(
    '/locations',
    {
      preHandler: requirePermission(Permission.TRACKING_INGEST, Permission.TRUCKS_UPDATE),
      // Location updates are frequent by nature; lift the default cap.
      config: { rateLimit: { max: 2000, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(trackingLocationSchema, request.body);
      const result = await trackingService.ingestLocation(input, { auth });
      return created(reply, result);
    },
  );

  app.post(
    '/locations/batch',
    {
      preHandler: requirePermission(Permission.TRACKING_INGEST, Permission.TRUCKS_UPDATE),
      config: { rateLimit: { max: 500, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(trackingBatchSchema, request.body);
      const results = [];
      for (const location of input.locations) {
        results.push(await trackingService.ingestLocation(location, { auth }));
      }
      return created(reply, { accepted: results.length, results });
    },
  );

  // Live fleet map.
  app.get(
    '/fleet',
    {
      preHandler: [
        requirePermission(Permission.TRACKING_READ),
        requireFeature(Feature.TRACKING_LIVE),
      ],
    },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await trackingService.fleetPositions(organizationId));
    },
  );

  app.get(
    '/trucks/:id/history',
    {
      preHandler: [
        requirePermission(Permission.TRACKING_READ),
        requireFeature(Feature.TRACKING_HISTORY),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const query = parseQuery(trackingHistoryQuerySchema, request.query);
      return ok(reply, await trackingService.trackingHistory(auth, id, query));
    },
  );
}
