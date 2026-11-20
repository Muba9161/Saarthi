import type { FastifyInstance } from 'fastify';
import { festiveCalendarQuerySchema } from '@saarthi/shared';
import { ok, parseQuery } from '../../lib/http';
import { festiveCalendar } from './festive.service';

/**
 * The festive calendar, for the Android apps (the web app reads the same data
 * from `@saarthi/shared` directly).
 *
 * Public on purpose: the apps dress their sign-in and loading screens before
 * anybody has signed in, and the answer says nothing about the caller. Whether
 * a signed-in person wants the looks at all is on their session
 * (`festiveLooks`), not here.
 */
export async function festiveRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request, reply) => {
    const { locale } = parseQuery(festiveCalendarQuerySchema, request.query);
    // The answer changes once a day at most; an hour keeps a new day prompt.
    reply.header('Cache-Control', 'public, max-age=3600');
    return ok(reply, festiveCalendar(locale));
  });
}
