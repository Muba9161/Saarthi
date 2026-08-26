import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { updateViewPreferenceSchema, viewSurfaceSchema } from '@saarthi/shared';
import { noContent, ok, parseBody, parseParams } from '../../lib/http';
import { requireAuth } from '../../server/guards';
import * as preferences from './view-preference.service';

/**
 * List presentation preferences.
 *
 * No permission guard beyond authentication: these are a person's own settings
 * about their own screens, scoped to their user id in every query. There is
 * nothing here another user could reach.
 */
const surfaceParamSchema = z.object({ surface: viewSurfaceSchema });

export async function viewPreferenceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // Returned in one call so the shell can prime every list at startup rather
  // than each screen fetching its own preference as it mounts.
  app.get('/', async (request, reply) =>
    ok(reply, await preferences.listViewPreferences(requireAuth(request))),
  );

  app.put('/:surface', async (request, reply) => {
    const auth = requireAuth(request);
    const { surface } = parseParams(surfaceParamSchema, request.params);
    const input = parseBody(updateViewPreferenceSchema, request.body ?? {});
    return ok(reply, await preferences.saveViewPreference(auth, surface, input));
  });

  app.delete('/:surface', async (request, reply) => {
    const auth = requireAuth(request);
    const { surface } = parseParams(surfaceParamSchema, request.params);
    await preferences.resetViewPreference(auth, surface);
    return noContent(reply);
  });
}
