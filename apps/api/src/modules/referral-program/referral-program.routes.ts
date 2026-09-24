import type { FastifyInstance } from 'fastify';
import { paginationSchema } from '@saarthi/shared';
import { makePagination, ok, paginated, parseQuery } from '../../lib/http';
import { publicAppUrl } from '../../lib/public-url';
import { requireAuth } from '../../server/guards';
import * as program from './referral-program.service';

/**
 * Refer & Earn.
 *
 * Authentication is the only guard: every query is scoped to the caller's own
 * user id, and eligibility is a business rule the service applies itself
 * (`canJoinReferralProgram`) rather than a permission or a plan feature — the
 * program is deliberately not tied to what somebody pays for.
 */
export async function referralProgramRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/me', async (request, reply) =>
    ok(reply, await program.summary(requireAuth(request), publicAppUrl(request))),
  );

  app.get('/me/referrals', async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query ?? {});
    const { items, total } = await program.listReferrals(requireAuth(request), query);
    return paginated(reply, items, makePagination(query.page, query.pageSize, total));
  });
}
