import type { FastifyInstance } from 'fastify';
import {
  OrganizationType,
  Permission,
  commerceMatchQuerySchema,
  idParamSchema,
  interpretCommerceSchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { ok, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireBusiness,
  requireOrganizationType,
  requirePermission,
} from '../../server/guards';
import { interpret } from './interpret.service';
import { matchSellers } from './matching.service';
import { activeCategories } from './taxonomy.service';

/**
 * Smart commerce: the shared taxonomy, the one-line interpreter behind the
 * seller's "What are you selling?" and the customer's "What do you need?",
 * and seller matching for fleet owners.
 */
export async function commerceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // The tree a manual category picker offers when the engine is unsure.
  app.get(
    '/categories',
    { preHandler: requirePermission(Permission.MATERIALS_MANAGE, Permission.REQUIREMENTS_CREATE) },
    async (_request, reply) => ok(reply, await activeCategories()),
  );

  // Proposes a structure; stores nothing. The save endpoints validate again.
  app.post(
    '/interpret',
    {
      preHandler: requirePermission(Permission.MATERIALS_MANAGE, Permission.REQUIREMENTS_CREATE),
      config: { rateLimit: { max: config.commerce.interpretRateLimit, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(interpretCommerceSchema, request.body);
      return ok(reply, await interpret(auth, input));
    },
  );

  // Fleet owners only: this names Sellers, and the customer never sees it.
  app.get(
    '/requirements/:id/matches',
    {
      preHandler: [
        requirePermission(Permission.REQUIREMENTS_BID),
        requireOrganizationType(OrganizationType.FLEET_OWNER, OrganizationType.ENTERPRISE),
        requireBusiness('Seller sourcing is for fleet businesses.'),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const query = parseQuery(commerceMatchQuerySchema, request.query);
      return ok(reply, await matchSellers(auth, id, query));
    },
  );
}
