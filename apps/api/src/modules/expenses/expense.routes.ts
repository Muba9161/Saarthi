import type { FastifyInstance } from 'fastify';
import { Permission, expenseListQuerySchema } from '@saarthi/shared';
import { parseQuery } from '../../lib/http';
import { requireAuth, requireOrganizationId, requirePermission } from '../../server/guards';
import * as expenseService from './expense.service';

/**
 * Road expense slips, for the fleet.
 *
 * Read under the fuel permission: both are running costs on the same
 * "Documents & costs" page, and anyone who may see what a tank cost may see
 * what the toll beside it cost.
 */
export async function expenseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { preHandler: requirePermission(Permission.FUEL_READ) }, async (request, reply) => {
    const auth = requireAuth(request);
    const organizationId = requireOrganizationId(request);
    const query = parseQuery(expenseListQuerySchema, request.query);
    const result = await expenseService.listExpenses(auth, organizationId, query);
    return reply.code(200).send({ success: true, data: result, meta: { totals: result.totals } });
  });
}
