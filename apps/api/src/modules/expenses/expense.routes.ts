import type { FastifyInstance } from 'fastify';
import { Permission, expenseListQuerySchema, fleetExpenseSlipSchema } from '@saarthi/shared';
import { created, parseBody, parseQuery } from '../../lib/http';
import { requireAuth, requireOrganizationId, requirePermission } from '../../server/guards';
// The terminal's single-file reader: one photograph and a few fields, the same upload as a slip from the cab.
import { readTerminalUpload } from '../terminal/terminal-http';
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

  /**
   * A slip filed from a signed-in app — an owner driving their own vehicle, or
   * the office. Multipart: the photograph and the slip's fields.
   */
  app.post(
    '/',
    {
      preHandler: requirePermission(Permission.FUEL_MANAGE, Permission.TRIPS_DRIVE),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { fields, file } = await readTerminalUpload(request);
      const input = parseBody(fleetExpenseSlipSchema, {
        truckId: fields.truckId,
        category: fields.category,
        amount: fields.amount,
        vendorName: fields.vendorName,
        notes: fields.notes,
        latitude: fields.latitude,
        longitude: fields.longitude,
      });
      return created(reply, await expenseService.fileExpenseSlip(auth, input, file));
    },
  );
}
