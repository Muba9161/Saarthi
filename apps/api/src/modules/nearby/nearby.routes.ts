import type { FastifyInstance } from 'fastify';
import {
  Feature,
  NEARBY_CATEGORIES,
  Permission,
  nearbySearchSchema,
  nearbyTrucksSchema,
} from '@saarthi/shared';
import { ok, parseQuery } from '../../lib/http';
import { requireAuth, requireFeature, requirePermission } from '../../server/guards';
import * as nearbyService from './nearby.service';

export async function nearbyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/categories', async (_request, reply) => ok(reply, NEARBY_CATEGORIES));

  app.get(
    '/places',
    {
      preHandler: [
        requirePermission(Permission.NEARBY_READ),
        requireFeature(Feature.NEARBY_SERVICES),
      ],
    },
    async (request, reply) => {
      const query = parseQuery(nearbySearchSchema, request.query);
      return ok(reply, await nearbyService.searchNearbyPlaces(query));
    },
  );

  app.get(
    '/places/summary',
    {
      preHandler: [
        requirePermission(Permission.NEARBY_READ),
        requireFeature(Feature.NEARBY_SERVICES),
      ],
    },
    async (request, reply) => {
      const query = parseQuery(nearbySearchSchema, request.query);
      return ok(
        reply,
        await nearbyService.nearbyCategoryCounts(query.latitude, query.longitude, query.radiusKm),
      );
    },
  );

  app.get(
    '/trucks',
    {
      preHandler: [
        requirePermission(Permission.NEARBY_READ),
        requireFeature(Feature.NEARBY_TRUCKS),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(nearbyTrucksSchema, request.query);
      return ok(reply, await nearbyService.findNearbyTrucks(auth, query));
    },
  );
}
