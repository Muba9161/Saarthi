import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  discoverFastagSchema,
  fastagListQuerySchema,
  idParamSchema,
  importTollSchema,
  recordFastagBalanceSchema,
  recordFastagRechargeSchema,
  recordTollSchema,
  registerFastagSchema,
  syncFastagSchema,
  tollListQuerySchema,
  tollSummaryQuerySchema,
  updateFastagSchema,
} from '@saarthi/shared';
import { created, ok, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import * as fastagService from './fastag.service';
import * as tollService from './toll.service';

/**
 * FASTag and toll.
 *
 * Read and manage sit with the general fleet grant, because toll is an
 * operational cost a dispatcher works with daily — unlike a loan, which is the
 * owner's business alone. The one owner-level piece is the tag identifier
 * itself, and that is enforced inside the service by masking rather than by a
 * separate route.
 */
export async function tollRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // -------------------------------------------------------------------------
  // FASTag accounts
  // -------------------------------------------------------------------------

  /**
   * What the configured provider can actually do.
   *
   * The UI asks this first and hides what is unavailable, so a fleet without a
   * NETC integration is never shown a "check balance" button that cannot work.
   */
  app.get(
    '/fastag/capabilities',
    { preHandler: requirePermission(Permission.TOLL_READ) },
    async (_request, reply) => ok(reply, fastagService.fastagCapabilities()),
  );

  app.get(
    '/fastag',
    {
      preHandler: [requirePermission(Permission.TOLL_READ), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(fastagListQuerySchema, request.query);
      const result = await fastagService.listFastags(auth, organizationId, query);
      return ok(
        reply,
        { items: result.items, pagination: result.pagination },
        { totals: result.totals },
      );
    },
  );

  app.get(
    '/fastag/:id',
    {
      preHandler: [requirePermission(Permission.TOLL_READ), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await fastagService.getFastag(auth, id));
    },
  );

  app.post(
    '/fastag',
    {
      preHandler: [requirePermission(Permission.TOLL_MANAGE), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(registerFastagSchema, request.body);
      return created(reply, await fastagService.registerFastag(auth, organizationId, input));
    },
  );

  app.patch(
    '/fastag/:id',
    {
      preHandler: [requirePermission(Permission.TOLL_MANAGE), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateFastagSchema, request.body);
      return ok(reply, await fastagService.updateFastag(auth, id, input));
    },
  );

  /** Record a balance read at the issuer, with the moment it was true. */
  app.post(
    '/fastag/:id/balance',
    {
      preHandler: [requirePermission(Permission.TOLL_MANAGE), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(recordFastagBalanceSchema, request.body);
      return ok(reply, await fastagService.recordBalance(auth, id, input));
    },
  );

  /**
   * Record a recharge made at the issuer.
   *
   * Saarthi does not top up a tag — that is the issuing bank's rail — and the
   * response says so plainly rather than letting the button imply a payment.
   */
  app.post(
    '/fastag/:id/recharge',
    {
      preHandler: [requirePermission(Permission.TOLL_MANAGE), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(recordFastagRechargeSchema, request.body);
      return created(reply, await fastagService.recordRecharge(auth, id, input));
    },
  );

  /**
   * Find the tag fitted to a vehicle from its registration number.
   *
   * The one FASTag call that needs no tag id, which is what makes it usable the
   * moment a vehicle is added — nobody has to read a 24-character identifier
   * off a windscreen. Gated and rate limited like sync, because it is the same
   * billed lookup underneath.
   *
   * "This vehicle has no tag" comes back as a 200 with `found: false`, not as a
   * 404: it is an answer about the vehicle, not a failure of the request.
   */
  app.post(
    '/fastag/discover',
    {
      preHandler: [
        requirePermission(Permission.TOLL_MANAGE),
        requireFeature(Feature.TOLL_FASTAG_SYNC),
      ],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(discoverFastagSchema, request.body);
      return ok(reply, await fastagService.discoverFastag(auth, input));
    },
  );

  /**
   * Pull live tag state from NETC.
   *
   * Gated on its own entitlement because each call is billed, and rate limited
   * because a loop over a fleet would spend an allowance in seconds.
   */
  app.post(
    '/fastag/:id/sync',
    {
      preHandler: [
        requirePermission(Permission.TOLL_MANAGE),
        requireFeature(Feature.TOLL_FASTAG_SYNC),
      ],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(syncFastagSchema, request.body ?? {});
      return ok(reply, await fastagService.syncFastag(auth, id, input));
    },
  );

  // -------------------------------------------------------------------------
  // Toll crossings
  // -------------------------------------------------------------------------

  app.get(
    '/transactions',
    {
      preHandler: [requirePermission(Permission.TOLL_READ), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(tollListQuerySchema, request.query);
      const result = await tollService.listTollTransactions(auth, organizationId, query);
      return ok(
        reply,
        { items: result.items, pagination: result.pagination },
        { totals: result.totals },
      );
    },
  );

  app.get(
    '/summary',
    {
      preHandler: [requirePermission(Permission.TOLL_READ), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(tollSummaryQuerySchema, request.query);
      return ok(reply, await tollService.tollSummary(auth, organizationId, query));
    },
  );

  app.post(
    '/transactions',
    {
      preHandler: [requirePermission(Permission.TOLL_MANAGE), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(recordTollSchema, request.body);
      return created(reply, await tollService.recordToll(auth, organizationId, input));
    },
  );

  app.post(
    '/import',
    {
      preHandler: [requirePermission(Permission.TOLL_MANAGE), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(importTollSchema, request.body);
      return ok(reply, await tollService.importTollTransactions(auth, organizationId, input));
    },
  );
}

/** Toll surfaces hung off a trip, where the cost question is actually asked. */
export async function tripTollRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/:id/cost',
    { preHandler: requirePermission(Permission.TRIPS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await tollService.tripCostSummary(auth, id));
    },
  );

  app.get(
    '/:id/toll-variance',
    {
      preHandler: [requirePermission(Permission.TOLL_READ), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await tollService.tripTollVariance(auth, id));
    },
  );
}

/** The FASTag panel on the Vehicle Passport. */
export async function vehicleTollRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/:id/fastag',
    {
      preHandler: [requirePermission(Permission.TOLL_READ), requireFeature(Feature.TOLL_FASTAG)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await fastagService.vehicleFastags(auth, id));
    },
  );
}
