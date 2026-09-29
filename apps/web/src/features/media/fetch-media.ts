import { MediaVariant, mediaFilePath } from '@saarthi/shared';
import { absoluteApiUrl, getAccessToken } from '@/lib/api-client';

/**
 * The bytes of a media asset, fetched with the viewer's session.
 *
 * A plain `<img src>` arrives anonymous, and private media comes back refused
 * (see `MediaImage`). Every screen that shows media therefore fetches it this
 * way, and it lives here once so the path handling below cannot drift between
 * copies — the copy that drifts is the one whose image silently never appears.
 *
 * `source` is either an asset id or the API path a view already handed back
 * (`/api/v1/media/<id>/file`).
 */
export async function fetchMediaBlob(
  source: string,
  options: { variant?: 'thumbnail'; signal?: AbortSignal } = {},
): Promise<Blob> {
  /*
   * A bare id becomes a media path; a path is used as given, minus the
   * `/api/v1` that `absoluteApiUrl` is about to add back. Views hand back
   * `/api/v1/media/<id>/file?variant=original`, while a list row often carries
   * only the id, and making every caller normalise that was how one of them
   * eventually would not.
   */
  const path = source.includes('/') ? source.replace(/^\/api\/v1/, '') : mediaFilePath(source);

  /*
   * The rendition, set rather than appended.
   *
   * A path from the API already carries `variant=original`, so appending a
   * second one left the server picking between two contradictory values for
   * the same parameter. And the name has to be the one the API knows:
   * `MediaVariant.THUMB` is `thumb`, so asking for `thumbnail` quietly fell
   * through to the full-size original on every thumbnail in the app.
   */
  const [base = path, search = ''] = path.split('?');
  const params = new URLSearchParams(search);
  if (options.variant === 'thumbnail') params.set('variant', MediaVariant.THUMB);
  const query = params.toString();
  const url = absoluteApiUrl(query ? `${base}?${query}` : base);

  const response = await fetch(url, {
    // Both: the header carries the access token, and the cookie carries the
    // refresh session for a request that arrives just as one expires.
    credentials: 'include',
    headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.blob();
}
