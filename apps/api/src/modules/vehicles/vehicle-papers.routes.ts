import type { FastifyInstance } from 'fastify';
import { Permission, idParamSchema } from '@saarthi/shared';
import { ok, parseParams } from '../../lib/http';
import { requireAuth, requirePermission } from '../../server/guards';
import { ownerPapersWallet } from './vehicle-papers.service';

/**
 * A vehicle's papers wallet, for the owner app.
 *
 * Read-only and free: it files what Saarthi already holds and never calls the
 * RTO provider. The files themselves are opened through the routes the web
 * already uses — `/documents/:id/download`, `/media/:id/file` and
 * `/vehicles/lookups/:lookupId/document` — so each keeps its own audit trail
 * and access check.
 */
export async function vehiclePapersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/:id/papers',
    { preHandler: requirePermission(Permission.DOCUMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await ownerPapersWallet(auth, id));
    },
  );
}
