import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { terminalUpdateCheckSchema, terminalUpdateDownloadParamsSchema } from '@saarthi/shared';
import { errors } from '../../lib/errors';
import { ok, parseParams, parseQuery } from '../../lib/http';
import {
  DRIVER_APPLICATION_ID,
  OWNER_APPLICATION_ID,
  latestPublishedApp,
  openPublishedRelease,
  updateOfferFor,
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
  return sendRelease(reply, release, `${target.fileStem}-${latest.versionName}.apk`, cacheControl);
}

/** Stream one opened release as an APK download. */
function sendRelease(
  reply: FastifyReply,
  release: Awaited<ReturnType<typeof openPublishedRelease>>,
  fileName: string,
  cacheControl: string,
): FastifyReply {
  return reply
    .header('content-type', 'application/vnd.android.package-archive')
    .header('content-length', release.size)
    .header('content-disposition', `attachment; filename="${fileName}"`)
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

    /**
     * Is there a newer build than the one asking? For the app's own Update button.
     *
     * The same answer a fitted terminal gets from the device gateway — newest
     * published, above the caller's version, within its Android level — but
     * open, because a phone app is asked by people who may hold no device
     * credential at all: someone riding along is never paired to a vehicle.
     * It says only what `/` already says publicly, plus the checksum the app
     * verifies its download against. `null` is the ordinary answer.
     */
    app.get(
      '/update',
      { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } },
      async (request, reply) => {
        const query = parseQuery(terminalUpdateCheckSchema, request.query ?? {});
        return ok(
          reply,
          await updateOfferFor({
            currentVersionCode: query.versionCode ?? null,
            deviceSdk: query.sdk ?? null,
            // Fixed by the route, never taken from the caller: each app's
            // update path can only ever serve that app.
            applicationId: target.applicationId,
          }),
        );
      },
    );

    /**
     * One exact published build, for the app updating itself.
     *
     * Named by version rather than "the newest", so a release published while a
     * phone is mid-download cannot swap the bytes under the checksum it holds.
     */
    app.get(
      '/update/:versionCode/download',
      { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
      async (request, reply) => {
        const { versionCode } = parseParams(terminalUpdateDownloadParamsSchema, request.params);
        const release = await openPublishedRelease(versionCode, target.applicationId);
        return sendRelease(
          reply,
          release,
          `${target.fileStem}-${versionCode}.apk`,
          // A version's bytes never change.
          'public, max-age=86400, immutable',
        );
      },
    );
  };
}
