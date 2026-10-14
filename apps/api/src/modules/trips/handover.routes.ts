import type { FastifyInstance } from 'fastify';
import { Permission, handoverOverrideSchema, idParamSchema } from '@saarthi/shared';
import { ok, parseBody, parseParams } from '../../lib/http';
import { requireAuth, requirePermission } from '../../server/guards';
import * as handovers from './handover.service';

/**
 * Handover codes — the customer's side (see their code) and the fleet's side
 * (see whether it was entered; the owner may clear it with a reason). The
 * driver enters the code through the trip routes themselves.
 */
export async function handoverRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /** The customer's delivery code for one of their orders. */
  app.get('/orders/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await handovers.handoverForCustomer(auth, { orderId: id }));
  });

  /** The passenger's pickup code for one of their bookings. */
  app.get('/bookings/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await handovers.handoverForCustomer(auth, { bookingId: id }));
  });

  /** Whether the codes on a trip were entered — never the codes themselves. */
  app.get('/trips/:id', { preHandler: requirePermission(Permission.TRIPS_READ) }, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await handovers.handoversForTrip(auth, id));
  });

  /** The owner clears a handover the customer could not give the code for. Reason required; audited. */
  app.post(
    '/trips/:id/override',
    { preHandler: requirePermission(Permission.TRIPS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(handoverOverrideSchema, request.body);
      return ok(reply, await handovers.overrideHandover(auth, id, input));
    },
  );
}
