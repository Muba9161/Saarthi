import * as React from 'react';
import { Car } from 'lucide-react';
import { MediaImage } from '@/features/media/media-image';

/**
 * A listing's cover photograph.
 *
 * The authenticated-fetch dance this used to perform in full now lives in
 * [MediaImage], because it was needed everywhere a media asset is shown and
 * existed only here — so every other image in the product silently rendered
 * blank. What is left is the part that is genuinely about a resale listing: a
 * card with a torn thumbnail reads as a broken product, so a missing photo
 * falls back to a vehicle mark rather than to a broken-image icon.
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
  return (
    <MediaImage
      source={photoId}
      alt={alt}
      variant="thumbnail"
      className={className ?? 'size-full object-cover'}
      fallback={
        <div className="flex size-full items-center justify-center bg-muted" aria-hidden>
          <Car className="size-8 text-muted-foreground/50" />
        </div>
      }
    />
  );
}

export default ListingPhoto;
