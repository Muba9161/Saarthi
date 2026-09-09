import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImagePlus, Loader2 } from 'lucide-react';
import type { MediaOwnerType, MediaPurpose } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FileDropzone, RemoveButton } from '@/components/common/file-dropzone';
import { MediaImage } from '@/features/media/media-image';
import { cn } from '@/lib/utils';

/**
 * Attach photographs to a record.
 *
 * Uploads go straight to the media library against an owner and a purpose, so
 * the same component serves a vehicle's gallery, a listing's exterior shots and
 * an odometer photo without knowing anything about any of them.
 *
 * Thumbnails go through `MediaImage` rather than a plain `<img src>`, because
 * media inherits its owner's visibility and the API authorises on the
 * `Authorization` header — a bare `src` arrives anonymous and a private vehicle
 * photo comes back refused. This component used to carry its own copy of that
 * fetch, and the copy is exactly what rotted: it passed the API's own
 * `/api/v1/...` path back through `absoluteApiUrl`, which prefixes `/api/v1`
 * again, so every thumbnail requested a URL that does not exist and every tile
 * rendered as a grey box with nothing in the console to say why.
 *
 * Chosen files appear in the grid immediately, from a local object URL, while
 * the real upload runs behind them. Uploads are sequential and a set of eight
 * photographs over a phone connection is not quick; without the placeholders
 * the grid sits empty long enough that people pick the same files again.
 */

interface MediaAsset {
  id: string;
  fileName: string;
  purpose: string;
  url: string;
  thumbnailUrl: string | null;
  altText: string | null;
}

/** A file being uploaded right now, shown from its local object URL. */
interface PendingPhoto {
  key: string;
  name: string;
  previewUrl: string;
}

const ACCEPTED_IMAGES = 'image/jpeg,image/png,image/webp,image/heic';
const MAX_PHOTO_MB = 10;

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
  /**
   * Called after a successful upload or removal, for callers holding state
   * this component cannot see — a completion score computed by the API, say.
   */
  onChanged?: () => void;
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
  onChanged,
}: PhotoUploaderProps) {
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState<PendingPhoto[]>([]);

  /**
   * Object URLs live until they are explicitly revoked, and this component can
   * churn through dozens in one sitting.
   *
   * They are tracked in a ref as well as in state because the unmount cleanup
   * cannot rely on a state updater running — React may skip it once the
   * component is gone, and the URLs would leak for the life of the document.
   */
  const pendingUrls = React.useRef<string[]>([]);

  const releasePending = React.useCallback(() => {
    for (const url of pendingUrls.current) URL.revokeObjectURL(url);
    pendingUrls.current = [];
    setPending([]);
  }, []);

  React.useEffect(
    () => () => {
      for (const url of pendingUrls.current) URL.revokeObjectURL(url);
      pendingUrls.current = [];
    },
    [],
  );

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
      onChanged?.();
    },
    onError: (error) => toast.error('Upload failed', { description: errorMessage(error) }),
    // Clear the placeholders whichever way it went: on success the real
    // thumbnails replace them, on failure there is nothing to stand in for.
    onSettled: releasePending,
  });

  const remove = useMutation({
    mutationFn: (assetId: string) => api.delete(`/media/${assetId}`),
    onSuccess: () => {
      toast.success('Photo removed');
      invalidate();
      onChanged?.();
    },
    onError: (error) =>
      toast.error('Could not remove the photo', { description: errorMessage(error) }),
  });

  const shown = assets.length + pending.length;
  const remaining = Math.max(0, max - shown);
  const short = requiredCount !== undefined ? Math.max(0, requiredCount - assets.length) : 0;
  const busy = upload.isPending || remove.isPending;
  const canAdd = !disabled && remaining > 0;

  const accept = (files: File[]): void => {
    const usable = files.slice(0, remaining);
    if (usable.length === 0) return;

    const placeholders = usable.map((file, index) => ({
      key: `${file.name}-${file.lastModified}-${index}`,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
    }));

    pendingUrls.current = placeholders.map((photo) => photo.previewUrl);
    setPending(placeholders);
    upload.mutate(usable);
  };

  /**
   * Everything the picker needs except its words.
   *
   * The empty frame and the add tile are the same control shown at two sizes;
   * splitting the shared half out is what stops the accept list, the size cap
   * and the remaining count drifting apart between them.
   */
  const dropzoneProps = {
    accept: ACCEPTED_IMAGES,
    multiple: max > 1,
    maxFiles: remaining,
    maxSizeMb: MAX_PHOTO_MB,
    busy: upload.isPending,
    busyLabel: `Uploading ${pending.length} photo${pending.length === 1 ? '' : 's'}…`,
    disabled: busy,
    onFiles: accept,
    onReject: (reason: string) => toast.error(reason),
    icon: ImagePlus,
  } as const;

  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">{label}</h4>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <p
          className={cn('text-xs', short > 0 ? 'font-medium text-warning' : 'text-muted-foreground')}
        >
          {short > 0 ? `${short} more needed` : `${assets.length} of ${max}`}
        </p>
      </div>

      {/*
        Photographs and the way to add one, in the same grid.

        The picker used to be a separate strip under the grid, which put the
        thing being added somewhere other than where it would appear. Here the
        empty frame is simply the next tile: it is the same size and the same
        shape as the picture that will replace it, so a set of four photos and a
        place to put the fifth read as one row rather than two controls.
      */}
      {shown > 0 ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted"
            >
              <MediaImage
                source={asset.id}
                alt={asset.altText ?? asset.fileName}
                variant="thumbnail"
                className="size-full object-cover"
              />
              {/* The name, over the picture, so two shots of the same panel can
                  be told apart without opening either. */}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-5 text-2xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {asset.fileName}
              </span>
              {!disabled ? (
                <RemoveButton
                  onClick={() => remove.mutate(asset.id)}
                  disabled={busy}
                  label={`Remove ${asset.fileName}`}
                />
              ) : null}
            </div>
          ))}

          {pending.map((photo) => (
            <div
              key={photo.key}
              className="relative aspect-[4/3] overflow-hidden rounded-xl border border-primary/40 bg-muted"
            >
              <img src={photo.previewUrl} alt="" className="size-full object-cover opacity-60" />
              <span className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[1px]">
                <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
                <span className="sr-only">Uploading {photo.name}</span>
              </span>
            </div>
          ))}

          {canAdd ? (
            <FileDropzone
              {...dropzoneProps}
              /*
                Reachable only when more are allowed than are already attached,
                which for a single-photo uploader is never — so it always reads
                as an addition rather than a replacement. No hint: the count in
                the header above says how many are left, and a second line does
                not fit a tile this size.
              */
              title="Add photos"
              className="aspect-[4/3] gap-1.5 px-2 py-0"
            />
          ) : null}
        </div>
      ) : canAdd ? (
        /* Nothing attached yet, so the frame gets the full width and states the
           rules — the one moment where there is room to say them. */
        <FileDropzone
          {...dropzoneProps}
          title={
            max > 1
              ? 'Drag photos here, or click to browse'
              : 'Drag a photo here, or click to browse'
          }
          hint={`JPEG, PNG, WebP or HEIC · up to ${MAX_PHOTO_MB} MB each`}
          className="min-h-40"
        />
      ) : null}

      {assets.length === 0 && disabled ? (
        <p className="text-xs text-muted-foreground">No photos yet.</p>
      ) : null}
    </section>
  );
}

/** A single-photo variant, for things like an odometer shot. */
export function SinglePhotoUploader(props: Omit<PhotoUploaderProps, 'max'>) {
  return <PhotoUploader {...props} max={1} />;
}

export type { MediaAsset };
export { Button };
