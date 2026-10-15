import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { errors } from '../../lib/errors';
import { ok } from '../../lib/http';
import {
  DRIVER_APPLICATION_ID,
  OWNER_APPLICATION_ID,
  latestPublishedApp,
  openPublishedRelease,
} from './release.service';

/** A phone app Saarthi offers as a direct download. */
export interface DownloadableApp {
  applicationId: string;
  /**
   * The saved file's name before the version. Named after what the app is
   * called on the phone, so the file in Downloads and the icon it installs
   * agree.
   */
  fileStem: string;
  /** Said when nothing is published, so the caller knows whom to ask. */
  missingMessage: string;
}

export const DRIVER_APP: DownloadableApp = {
  applicationId: DRIVER_APPLICATION_ID,
  fileStem: 'humsafar',
  missingMessage: 'No Humsafar release has been published yet. Ask your fleet administrator.',
};

export const OWNER_APP: DownloadableApp = {
  applicationId: OWNER_APPLICATION_ID,
  fileStem: 'vorldx-saarthi',
  missingMessage: 'No VorldX Saarthi release has been published yet.',
};

/**
 * Stream the newest published APK of one phone app.
 *
 * Shared by the signed-in download on the dashboard and the public ones on the
 * marketing site, so they can never disagree about which build "the app" is or
 * how it is labelled. Only the caching differs, and the caller says which it
 * wants.
 */
export async function sendLatestApp(
  reply: FastifyReply,
  target: DownloadableApp,
  cacheControl: string,
): Promise<FastifyReply> {
  const latest = await latestPublishedApp(target.applicationId);
  if (!latest) throw errors.notFound('App', target.missingMessage);

  const release = await openPublishedRelease(latest.versionCode, target.applicationId);

  return reply
    .header('content-type', 'application/vnd.android.package-archive')
    .header('content-length', release.size)
    .header(
      'content-disposition',
      `attachment; filename="${target.fileStem}-${latest.versionName}.apk"`,
    )
    .header('cache-control', cacheControl)
    .header('etag', `"${release.sha256}"`)
    .header('x-content-type-options', 'nosniff')
    .send(release.stream);
}

/**
 * A phone app, for anybody.
 *
 * Mounted without the session guard so the marketing site can offer the APK to
 * a visitor who has no Saarthi account yet. Installing an app grants nothing:
 * every screen in it still needs a sign-in. The APK carries only public
 * addresses (the API and the map style), so publishing it reveals nothing the
 * app would not show anyway.
 */
export function publicAppRoutes(target: DownloadableApp): FastifyPluginAsync {
  return async (app: FastifyInstance): Promise<void> => {
    /**
     * What the download button should say, or `null` when nothing is
     * published, so the page shows no button rather than one that fails.
     *
     * Deliberately narrower than the signed-in answer: release notes are
     * written for people already on the product, not for the public.
     */
    app.get('/', async (_request, reply) => {
      const latest = await latestPublishedApp(target.applicationId);
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
     * enough for a depot, or a mobile carrier, putting many phones behind one
     * IP, and tight enough that one client cannot loop it into gigabytes.
     * Cached only briefly because the URL always means "the newest build", and
     * a publish has to reach the next visitor within minutes, not a day later.
     */
    app.get(
      '/download',
      { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
      async (_request, reply) => sendLatestApp(reply, target, 'public, max-age=300'),
    );
  };
}
