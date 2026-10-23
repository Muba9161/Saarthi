import type { FastifyInstance } from 'fastify';
import {
  addRideShareContactSchema,
  idParamSchema,
  liveRideTokenParamSchema,
  ridePointsSchema,
  startRideShareSchema,
} from '@saarthi/shared';
import { created, ok, parseBody, parseParams } from '../../lib/http';
import { requireAuth } from '../../server/guards';
import * as shares from './ride-share.service';
import { mayRideAlong } from './ride-access';

/**
 * The rider's side of "Share my ride", mounted at `/ride-shares`, for Humsafar.
 * Starting one is for Personal plan account holders only (`ride-access`).
 */
export async function rideShareRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /** Whether this account may ride along — Humsafar asks before offering the choice. */
  app.get('/access', async (request, reply) => {
    const auth = requireAuth(request);
    return ok(reply, { rideAlong: mayRideAlong(auth), hasOwnerAccount: await shares.hasOwnerAccount(auth) });
  });

  app.post('/', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = parseBody(startRideShareSchema, request.body ?? {});
    return created(reply, await shares.startRideShare(requireAuth(request), input));
  });

  app.get('/mine', async (request, reply) => ok(reply, await shares.myRideShare(requireAuth(request))));

  app.post('/:id/contacts', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const { phone } = parseBody(addRideShareContactSchema, request.body);
    return ok(reply, await shares.addRideShareContact(requireAuth(request), id, phone));
  });

  /** Show the ride on this login's own owner account, in the owner app. */
  app.post('/:id/self', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await shares.shareWithOwnAccount(requireAuth(request), id));
  });

  app.post('/:id/end', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await shares.endRideShare(requireAuth(request), id));
  });
}

/**
 * The family's side, mounted at `/ride-shares`: rides being shared with me —
 * listed for Personal plan accounts; anyone else gets an empty list.
 */
export async function rideShareViewerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.get('/shared-with-me', async (request, reply) => ok(reply, await shares.ridesSharedWithMe(requireAuth(request))));
}

/**
 * The rider's phone reporting, mounted at `/ride-shares` beside the routes
 * above but without a sign-in: the share's reporting key (`X-Ride-Token`) is
 * the credential, good for that share only.
 */
export async function rideShareReportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/:id/report', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(ridePointsSchema, request.body);
    const key = request.headers['x-ride-token'];
    return ok(reply, await shares.reportRideShare(id, typeof key === 'string' ? key : undefined, input));
  });
}

/**
 * The live link, mounted at `/public/live` — opened by family from WhatsApp,
 * with no account. The signed token in the path is the only key.
 */
export async function publicLiveRideRoutes(app: FastifyInstance): Promise<void> {
  app.get('/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { token } = parseParams(liveRideTokenParamSchema, request.params);
    return ok(reply, await shares.publicLiveRide(token));
  });
}
