import type { FastifyInstance } from 'fastify';
import {
  Permission,
  bookingCostsSchema,
  confirmDeliverySchema,
  connectBankAccountSchema,
  idParamSchema,
  paginationSchema,
  procurementPaymentSchema,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { makePagination, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requireBusiness, requireOrganizationId, requirePermission } from '../../server/guards';
import { listCommissions } from './ledger.service';
import * as orderFinance from './order-finance.service';
import * as payoutAccounts from './payout-account.service';
import * as travelFinance from './travel-finance.service';

/**
 * Marketplace money.
 *
 * `/finance` is the business's own: its payout bank account and the
 * commissions Saarthi has taken on its profit. The order and booking routes
 * move money on one transaction; every amount in them is worked out on the
 * server, so no request body carries a price.
 */
export async function financeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  // Marketplace money is paid to businesses. A Personal account runs its own
  // vehicles and never receives marketplace payments, so it has no payout account.
  app.addHook(
    'preHandler',
    requireBusiness('Payout accounts are for businesses. A Personal account does not receive marketplace payments.'),
  );

  app.get(
    '/payout-account',
    { preHandler: requirePermission(Permission.PAYOUT_ACCOUNT_MANAGE) },
    async (request, reply) => ok(reply, await payoutAccounts.getPayoutAccount(requireOrganizationId(request))),
  );

  /** Connect a bank account; penny validation runs before it can be used. */
  app.post(
    '/payout-account',
    { preHandler: requirePermission(Permission.PAYOUT_ACCOUNT_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(connectBankAccountSchema, request.body ?? {});
      return ok(reply, await payoutAccounts.connectPayoutAccount(auth, requireOrganizationId(request), input));
    },
  );

  app.post(
    '/payout-account/refresh',
    { preHandler: requirePermission(Permission.PAYOUT_ACCOUNT_MANAGE) },
    async (request, reply) => ok(reply, await payoutAccounts.refreshPayoutAccount(requireOrganizationId(request))),
  );

  app.get(
    '/commissions',
    { preHandler: requirePermission(Permission.MARKETPLACE_FINANCE_READ) },
    async (request, reply) => {
      const query = parseQuery(paginationSchema, request.query);
      const result = await listCommissions(prisma, requireOrganizationId(request), query.page, query.pageSize);
      return paginated(reply, result.items, makePagination(query.page, query.pageSize, result.total));
    },
  );
}

/** The money of one fleet-delivered freight order. Mounted under `/orders`. */
export async function orderFinanceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/:id/finance',
    { preHandler: requirePermission(Permission.ORDERS_READ) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await orderFinance.financialSummary(requireAuth(request), id));
    },
  );

  /** Customer: the 30% at confirmation. */
  app.post(
    '/:id/finance/confirmation-payment',
    { preHandler: requirePermission(Permission.ORDERS_CREATE) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await orderFinance.payConfirmation(requireAuth(request), id));
    },
  );

  /** Fleet: paying its supplier for the material. */
  app.post(
    '/:id/finance/procurement-payment',
    { preHandler: requirePermission(Permission.PAYOUT_ACCOUNT_MANAGE) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(procurementPaymentSchema, request.body ?? {});
      return ok(reply, await orderFinance.payProcurement(requireAuth(request), id, input));
    },
  );

  /** Customer: what actually arrived — settles the final amount. */
  app.post(
    '/:id/finance/delivery',
    { preHandler: requirePermission(Permission.ORDERS_CREATE) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(confirmDeliverySchema, request.body ?? {});
      return ok(reply, await orderFinance.confirmDelivery(requireAuth(request), id, input));
    },
  );

  /** Customer: the balance after delivery. */
  app.post(
    '/:id/finance/final-payment',
    { preHandler: requirePermission(Permission.ORDERS_CREATE) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await orderFinance.payFinal(requireAuth(request), id));
    },
  );
}

/** A travel booking's money. Mounted under `/travel/bookings`. */
export async function bookingFinanceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/:id/finance',
    { preHandler: requirePermission(Permission.MARKETPLACE_FINANCE_READ) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await travelFinance.bookingFinanceSummary(requireAuth(request), id));
    },
  );

  /** Provider: the completed trip's costs — settles its profit and Saarthi's commission. */
  app.post(
    '/:id/finance/costs',
    { preHandler: requirePermission(Permission.PAYOUT_ACCOUNT_MANAGE) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(bookingCostsSchema, request.body ?? {});
      return ok(reply, await travelFinance.recordBookingCosts(requireAuth(request), id, input));
    },
  );
}
