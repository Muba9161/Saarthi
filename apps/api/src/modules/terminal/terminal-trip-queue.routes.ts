import type { FastifyInstance } from 'fastify';
import { terminalTripQueueOrderSchema, terminalTripQueueQuerySchema } from '@saarthi/shared';
import { ok, parseBody, parseParams, parseQuery } from '../../lib/http';
import { authenticateDeviceRequest } from '../devices/device-auth';
import {
  driverTripQueue,
  positionFrom,
  removeDriverTrip,
  reorderDriverTrips,
} from './driver-trip-queue.service';
import { authorizedSessionForTerminal } from './session.service';
import { driverAuthForSession, requireTerminal } from './terminal.service';
import { idParamSchema, terminalLimit } from './terminal-http';

/**
 * The signed-on driver's own trips that have not started, in their order —
 * and the order that drives least, when it saves enough to ask about.
 *
 * Starting one and ending one stay on `/trip/start` and `/trip/complete`,
 * which this queue feeds: the first takes a trip id, the second starts the
 * next trip here when the last one ends.
 */
export async function terminalTripQueueRoutes(app: FastifyInstance): Promise<void> {
  app.get('/trips/queue', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const query = parseQuery(terminalTripQueueQuerySchema, request.query);

    return ok(reply, await driverTripQueue(session, positionFrom(query)));
  });

  /** Run them in this order — the driver's own, or the suggestion they accepted. */
  app.post('/trips/queue', { config: terminalLimit(10) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(terminalTripQueueOrderSchema, request.body);

    return ok(reply, await reorderDriverTrips(session, input));
  });

  /** Take one of the driver's own not-yet-started trips off their queue. */
  app.post('/trips/:id/remove', { config: terminalLimit(10) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const { id } = parseParams(idParamSchema, request.params);
    const auth = await driverAuthForSession(session);

    return ok(reply, await removeDriverTrip(session, auth, id));
  });
}
