import * as React from 'react';
import { Car } from 'lucide-react';
import { absoluteApiUrl, getAccessToken } from '@/lib/api-client';

/**
 * A listing's cover photograph.
 *
 * Media inherits its owner's visibility, so images are fetched with the session
 * token and rendered from an object URL rather than referenced by `src`. A
 * listing without a usable photo falls back to a placeholder instead of a
 * broken image — a card with a torn thumbnail reads as a broken product.
 */
export function ListingPhoto({
  photoId,
  alt,
  className,
}: {
  photoId: string | null;
  alt: string;
  className?: string;
}) {
  const [source, setSource] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!photoId) {
      setSource(null);
      return undefined;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const response = await fetch(absoluteApiUrl(`/media/${photoId}/file?variant=thumbnail`), {
          credentials: 'include',
          headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
        });
        if (!response.ok) throw new Error('unavailable');
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  if (!photoId || failed) {
    return (
      <div className="flex size-full items-center justify-center bg-muted" aria-hidden>
        <Car className="size-8 text-muted-foreground/50" />
      </div>
    );
  }

  if (!source) {
    return <div className="size-full animate-pulse bg-muted" aria-hidden />;
  }

  return <img src={source} alt={alt} className={className ?? 'size-full object-cover'} loading="lazy" />;
}
