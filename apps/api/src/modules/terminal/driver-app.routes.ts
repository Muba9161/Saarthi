import type { FastifyInstance, FastifyReply } from 'fastify';
import { errors } from '../../lib/errors';
import { ok } from '../../lib/http';
import { DRIVER_APPLICATION_ID, latestDriverApp, openPublishedRelease } from './release.service';

/**
 * Stream the newest published Saarthi Driver APK.
 *
 * Shared by the signed-in download on the dashboard and the public one on the
 * marketing site, so the two can never disagree about which build "the driver
 * app" is or how it is labelled. Only the caching differs, and the caller says
 * which it wants.
 */
export async function sendLatestDriverApp(
  reply: FastifyReply,
  cacheControl: string,
): Promise<FastifyReply> {
  const latest = await latestDriverApp();
  if (!latest) {
    throw errors.notFound(
      'Driver app',
      'No Saarthi Driver release has been published yet. Ask your fleet administrator.',
    );
  }

  const release = await openPublishedRelease(latest.versionCode, DRIVER_APPLICATION_ID);

  return reply
    .header('content-type', 'application/vnd.android.package-archive')
    .header('content-length', release.size)
    .header('content-disposition', `attachment; filename="saarthi-driver-${latest.versionName}.apk"`)
    .header('cache-control', cacheControl)
    .header('etag', `"${release.sha256}"`)
    .header('x-content-type-options', 'nosniff')
    .send(release.stream);
}

/**
 * The driver app, for anybody.
 *
 * Mounted without the session guard so the marketing site can offer the APK to
 * a visitor who has no Saarthi account yet. Installing the app grants nothing:
 * every screen in it still needs a sign-in, and a vehicle still needs an
 * approved assignment. The APK carries only public addresses (the API and the
 * map style), so publishing it reveals nothing the app would not show anyway.
 */
export async function publicDriverAppRoutes(app: FastifyInstance): Promise<void> {
  /**
   * What the download button should say, or `null` when nothing is published,
   * so the page shows no button rather than one that fails.
   *
   * Deliberately narrower than the signed-in answer: release notes are written
   * for drivers already on the product, not for the public.
   */
  app.get('/', async (_request, reply) => {
    const latest = await latestDriverApp();
    return ok(
      reply,
      latest
        ? {
            versionName: latest.versionName,
            versionCode: latest.versionCode,
            sizeBytes: latest.sizeBytes,
            publishedAt: latest.publishedAt,
          }
        : null,
    );
  });

  /**
   * The APK itself.
   *
   * Limited per address because each response is tens of megabytes: generous
   * enough for a depot, or a mobile carrier, putting many phones behind one IP,
   * and tight enough that one client cannot loop it into gigabytes. Cached only
   * briefly because the URL always means "the newest build", and a publish has
   * to reach the next visitor within minutes, not a day later.
   */
  app.get(
    '/download',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (_request, reply) => sendLatestDriverApp(reply, 'public, max-age=300'),
  );
}
