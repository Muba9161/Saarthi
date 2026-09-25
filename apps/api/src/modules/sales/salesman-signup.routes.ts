import type { FastifyInstance } from 'fastify';
import { salesmanSignupSchema } from '@saarthi/shared';
import { ok, parseBody } from '../../lib/http';
import { publicAppUrl } from '../../lib/public-url';
import { startSalesmanSignup } from './salesman-signup.service';

/**
 * Salesperson self-signup.
 *
 * Public by necessity — the person has no Saarthi account yet. It is throttled
 * hard because each call asks GODWeb and sends an email. Nothing here grants
 * access: it only emails the GODWeb address a link, and choosing the password
 * through that link (`POST /auth/reset-password`) is what finishes the signup.
 */
export async function salesmanSignupRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const input = parseBody(salesmanSignupSchema, request.body ?? {});
      return ok(reply, await startSalesmanSignup(input, publicAppUrl(request)));
    },
  );
}
