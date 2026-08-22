import type { FastifyInstance } from 'fastify';
import { Feature, Permission, petrolStationQuerySchema } from '@saarthi/shared';
import { ok, parseQuery } from '../../lib/http';
import { requireFeature, requirePermission } from '../../server/guards';
import * as petrolStationService from './petrol-station.service';

/**
 * Petrol station routes.
 *
 * Reuses the nearby-services permission and entitlement: from a driver's point
 * of view a fuel stop is a nearby service, and a fleet that has paid for
 * nearby services has paid for this.
 *
 * The route is point-and-radius only. There is deliberately no "list all"
 * endpoint — a national directory must never be pulled into a browser.
 */

/**
 * Accept the short `lat` / `lng` / `radius` spellings as well as Saarthi's
 * canonical `latitude` / `longitude` / `radiusKm`, so a map component can pass
 * whichever it already holds. Normalised here rather than in the shared schema
 * to keep the contract itself single-spelled.
 */
function withCoordinateAliases(query: unknown): unknown {
  if (typeof query !== 'object' || query === null) return query;
  const input = query as Record<string, unknown>;
  return {
    ...input,
    latitude: input.latitude ?? input.lat,
    longitude: input.longitude ?? input.lng ?? input.lon,
    radiusKm: input.radiusKm ?? input.radius,
  };
}

export async function petrolStationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    {
      preHandler: [
        requirePermission(Permission.NEARBY_READ),
        requireFeature(Feature.NEARBY_SERVICES),
      ],
    },
    async (request, reply) => {
      const query = parseQuery(petrolStationQuerySchema, withCoordinateAliases(request.query));
      const result = await petrolStationService.searchPetrolStations(query);

      return ok(reply, result, {
        cached: result.cached,
        stale: result.stale,
        count: result.stations.length,
      });
    },
  );
}
