import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import type { MediaOwnerType, MediaPurpose } from '@saarthi/shared';
import { absoluteApiUrl, api, errorMessage, getAccessToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Attach photographs to a record.
 *
 * Uploads go straight to the media library against an owner and a purpose, so
 * the same component serves a vehicle's gallery, a listing's exterior shots and
 * an odometer photo without knowing anything about any of them.
 *
 * Images are fetched with the session token rather than referenced by URL,
 * because media inherits its owner's visibility — a private vehicle photo must
 * not be readable by pasting its address into a browser.
 */

interface MediaAsset {
  id: string;
  fileName: string;
  purpose: string;
  url: string;
  thumbnailUrl: string | null;
  altText: string | null;
}

/** Renders an authenticated image as an object URL. */
function AuthenticatedImage({ asset }: { asset: MediaAsset }) {
  const [source, setSource] = React.useState<string | null>(null);

  React.useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const response = await fetch(absoluteApiUrl(asset.thumbnailUrl ?? asset.url), {
          credentials: 'include',
          headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
        });
        if (!response.ok) return;
        const blob = await response.blob();
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      } catch {
        // A thumbnail that will not load is not worth an error message.
      }
    })();

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.id, asset.url, asset.thumbnailUrl]);

  if (!source) {
    return <div className="size-full animate-pulse bg-muted" aria-hidden />;
  }

  return (
    <img
      src={source}
      alt={asset.altText ?? asset.fileName}
      className="size-full object-cover"
      loading="lazy"
    />
  );
}

export interface PhotoUploaderProps {
  ownerType: MediaOwnerType;
  ownerId: string;
  purpose: MediaPurpose;
  label: string;
  description?: string;
  /** Stop accepting uploads once this many photos exist. */
  max?: number;
  /** Show how many are still needed before some downstream gate passes. */
  requiredCount?: number;
  disabled?: boolean;
}

export function PhotoUploader({
  ownerType,
  ownerId,
  purpose,
  label,
  description,
  max = 24,
  requiredCount,
  disabled = false,
}: PhotoUploaderProps) {
  const queryClient = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const photos = useQuery({
    queryKey: ['media', ownerType, ownerId, purpose],
    queryFn: () =>
      api.get<MediaAsset[]>(`/media/owner/${ownerType.toLowerCase()}/${ownerId}`, { purpose }),
    enabled: Boolean(ownerId),
  });

  const assets = photos.data ?? [];
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['media', ownerType, ownerId, purpose] });
    void queryClient.invalidateQueries({ queryKey: ['resale-listing'] });
  };

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      // Sequential rather than parallel: a phone on a highway uploading eight
      // photos at once tends to fail all eight instead of the last one.
      for (const file of files) {
        const body = new FormData();
        body.append('ownerType', ownerType);
        body.append('ownerId', ownerId);
        body.append('purpose', purpose);
        body.append('file', file, file.name);
        await api.post('/media', body);
      }
    },
    onSuccess: () => {
      toast.success('Photos uploaded');
      invalidate();
    },
    onError: (error) => toast.error('Upload failed', { description: errorMessage(error) }),
  });

  const remove = useMutation({
    mutationFn: (assetId: string) => api.delete(`/media/${assetId}`),
    onSuccess: () => {
      toast.success('Photo removed');
      invalidate();
    },
    onError: (error) => toast.error('Could not remove the photo', { description: errorMessage(error) }),
  });

  const remaining = Math.max(0, max - assets.length);
  const short = requiredCount !== undefined ? Math.max(0, requiredCount - assets.length) : 0;
  const busy = upload.isPending || remove.isPending;

  const pick = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []).slice(0, remaining);
    if (files.length > 0) upload.mutate(files);
    // Allow re-selecting the same file after a failure.
    event.target.value = '';
  };

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">{label}</h4>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <p
          className={cn(
            'text-xs',
            short > 0 ? 'font-medium text-warning' : 'text-muted-foreground',
          )}
        >
          {short > 0 ? `${short} more needed` : `${assets.length} of ${max}`}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {assets.map((asset) => (
          <div
            key={asset.id}
            className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-muted"
          >
            <AuthenticatedImage asset={asset} />
            {!disabled ? (
              <button
                type="button"
                aria-label={`Remove ${asset.fileName}`}
                onClick={() => remove.mutate(asset.id)}
                disabled={busy}
                className="absolute right-1 top-1 rounded-md bg-background/85 p-1 opacity-0 shadow-sm transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}

        {!disabled && remaining > 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {upload.isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <ImagePlus className="size-5" />
            )}
            <span className="text-xs">{upload.isPending ? 'Uploading…' : 'Add photos'}</span>
          </button>
        ) : null}
      </div>

      {assets.length === 0 && disabled ? (
        <p className="text-xs text-muted-foreground">No photos yet.</p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        hidden
        onChange={pick}
      />
    </section>
  );
}

/** A single-photo variant, for things like an odometer shot. */
export function SinglePhotoUploader(props: Omit<PhotoUploaderProps, 'max'>) {
  return <PhotoUploader {...props} max={1} />;
}

export type { MediaAsset };
export { Button };
