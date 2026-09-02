import * as React from 'react';
import { ImageOff } from 'lucide-react';
import { absoluteApiUrl, getAccessToken } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * An image the viewer has to be authorised to see.
 *
 * Every media asset in Saarthi inherits its owner's visibility, and the API
 * authorises a request by its `Authorization` header. A browser sends no such
 * header for an `<img src>` — that is not a Saarthi decision, it is how the
 * element works — so the request arrives anonymous, the media endpoint treats it
 * as "public only", and a private asset comes back refused.
 *
 * The failure is silent and total: the upload succeeds, the bytes are on disk,
 * the URL is correct, and the page shows an empty box. Nothing in the network
 * tab looks alarming unless you notice the 403 on a request the page never
 * appears to have made deliberately.
 *
 * So the bytes are fetched with the session token and rendered from an object
 * URL. That is what makes a private photograph appear at all.
 *
 * A single component rather than the pattern copied per feature, because the
 * copy that gets forgotten is the one whose image silently never appears —
 * which is exactly what happened to the driver arrival photos.
 */
export function MediaImage({
  /**
   * The asset. Either an id, or the API path a view already handed back
   * (`/api/v1/media/<id>/file`) — both are accepted so a caller does not have
   * to unpick one from the other.
   */
  source,
  alt,
  className,
  variant,
  /** Drawn while loading and when the image cannot be shown. */
  fallback,
  onClick,
}: {
  source: string | null | undefined;
  alt: string;
  className?: string;
  variant?: 'thumbnail';
  fallback?: React.ReactNode;
  onClick?: () => void;
}): React.ReactElement | null {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!source) {
      setObjectUrl(null);
      setFailed(false);
      return undefined;
    }

    let cancelled = false;
    let created: string | null = null;
    setFailed(false);

    void (async () => {
      try {
        /*
         * A bare id becomes a media path; a path is used as given. Views hand
         * back `/api/v1/media/<id>/file`, while a list row often carries only
         * the id, and making every caller normalise that was how one of them
         * eventually would not.
         */
        const path = source.includes('/')
          ? source.replace(/^\/api\/v1/, '')
          : `/media/${source}/file`;
        const url = absoluteApiUrl(
          variant === 'thumbnail'
            ? `${path}${path.includes('?') ? '&' : '?'}variant=thumbnail`
            : path,
        );

        const response = await fetch(url, {
          // Both: the header carries the access token, and the cookie carries
          // the refresh session for a request that arrives just as one expires.
          credentials: 'include',
          headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
        });
        if (!response.ok) throw new Error(String(response.status));

        const blob = await response.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      // Released on unmount. A long-lived list that forgets this holds every
      // image it has ever scrolled past in memory until the tab is closed.
      if (created) URL.revokeObjectURL(created);
    };
  }, [source, variant]);

  if (!source || failed) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg bg-muted text-muted-foreground/50',
          className,
        )}
        aria-label={`${alt} is unavailable`}
        role="img"
      >
        <ImageOff className="size-5" />
      </div>
    );
  }

  if (!objectUrl) {
    return <div className={cn('animate-pulse rounded-lg bg-muted', className)} aria-hidden />;
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      className={className}
      loading="lazy"
      {...(onClick ? { onClick, role: 'button' } : {})}
    />
  );
}

export default MediaImage;
