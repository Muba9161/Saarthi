import type { FastifyInstance } from 'fastify';
import {
  Permission,
  startVerificationSchema,
  verificationCenterQuerySchema,
  verificationChargeParamsSchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { ok, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requirePermission, requirePlatformAdmin } from '../../server/guards';
import * as chargeService from './verification-charge.service';
import * as centerService from './verification-center.service';
import { listPriceViews } from './verification-pricing.service';

/**
 * The verification centre and Pay & Verify.
 *
 * Nothing here accepts a price, a payment status or a verification result
 * from the client. The amount is read from the server's price list, the
 * payment outcome from the gateway, and the verification outcome from the
 * provider — the client only ever reads them back.
 */
export async function verificationCenterRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /** The caller's own steps, or one driver's (`?driverId=`). */
  app.get(
    '/',
    { preHandler: requirePermission(Permission.VERIFICATION_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(verificationCenterQuerySchema, request.query);
      return ok(reply, await centerService.getVerificationCenter(auth, query));
    },
  );

  /** Customer-facing prices. Provider cost is never included. */
  app.get('/prices', async (_request, reply) => ok(reply, await listPriceViews()));

  /** Pay & Verify. Rate-limited like the direct identity checks. */
  app.post(
    '/checks',
    {
      config: {
        rateLimit: {
          max: config.identity.rateLimitMax,
          timeWindow: config.identity.rateLimitWindow,
        },
      },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(startVerificationSchema, request.body);
      return ok(reply, await chargeService.startVerification(auth, input));
    },
  );

  /** One paid attempt — what the wizard polls while a check is verifying. */
  app.get('/charges/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parseParams(verificationChargeParamsSchema, request.params);
    return ok(reply, await chargeService.getCharge(auth, id));
  });

  /** Verification history: type, status, date and amount paid. */
  app.get('/history', async (request, reply) => {
    const auth = requireAuth(request);
    return ok(reply, await chargeService.listVerificationHistory(auth));
  });

  /** Internal economics: provider cost, price, gross spread. */
  app.get(
    '/admin/economics',
    { preHandler: requirePlatformAdmin() },
    async (_request, reply) => ok(reply, await centerService.listVerificationEconomics()),
  );
}
