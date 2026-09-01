import type { FastifyInstance } from 'fastify';
import { Feature, Permission, cityFuelRateQuerySchema } from '@saarthi/shared';
import { ok, parseQuery } from '../../lib/http';
import { requireFeature, requirePermission } from '../../server/guards';
import * as fuelRateService from './fuel-rate.service';

/**
 * City fuel rate routes.
 *
 * Shares the nearby-services permission and entitlement with petrol stations:
 * the rate exists to annotate a fuel stop, so anyone entitled to find a fuel
 * stop is entitled to the rate beside it.
 *
 * A city with no published rate answers `200` with `null`, not `404`. "We have
 * no price for this city" is a successful answer to a legitimate question, and
 * modelling it as an error would push callers into try/catch for a normal case.
 */
export async function fuelRateRoutes(app: FastifyInstance): Promise<void> {
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
      const query = parseQuery(cityFuelRateQuerySchema, request.query);
      const rate = await fuelRateService.getCityFuelRate(query);

      return ok(reply, rate, {
        city: query.city,
        available: rate !== null,
        cached: rate?.cached ?? false,
      });
    },
  );
}
