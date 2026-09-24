import type { FastifyInstance } from 'fastify';
import { connectWalletBankAccountSchema, paginationSchema } from '@saarthi/shared';
import { created, makePagination, ok, paginated, parseBody, parseQuery } from '../../lib/http';
import { requireAuth } from '../../server/guards';
import { connectBankAccount } from './wallet-bank.service';
import * as wallet from './wallet.service';

/**
 * The Saarthi wallet — Refer & Earn rewards and cash-out.
 *
 * Authentication is the only guard, as for the referral program itself: every
 * query is scoped to the caller's own user id, and eligibility is the
 * program's business rule. Connecting a bank account runs a paid penny
 * validation, so it is throttled hard.
 */
export async function walletRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request, reply) => ok(reply, await wallet.summary(requireAuth(request))));

  app.put(
    '/bank-account',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const input = parseBody(connectWalletBankAccountSchema, request.body ?? {});
      return ok(reply, await connectBankAccount(requireAuth(request), input));
    },
  );

  app.get('/cashouts', async (request, reply) => {
    const query = parseQuery(paginationSchema, request.query ?? {});
    const { items, total } = await wallet.listCashouts(requireAuth(request), query);
    return paginated(reply, items, makePagination(query.page, query.pageSize, total));
  });

  app.post(
    '/cashouts',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => created(reply, await wallet.requestCashout(requireAuth(request))),
  );
}
