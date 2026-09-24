import * as React from 'react';
import { Bluetooth, RadioTower } from 'lucide-react';
import { TrackerProduct, type TrackerProductDefinition } from '@saarthi/shared';
import { cn } from '@/lib/utils';

/**
 * Photographs of the Saarthi trackers.
 *
 * Web copies of the sources in `design/devices/`, served from
 * `public/trackers/`. Used by the marketing pricing page, the add-vehicle and
 * add-truck dialogs and the telemetry tracker offer, so the product looks the
 * same everywhere it is sold.
 */
const PRODUCT_IMAGE: Record<TrackerProduct, string> = {
  [TrackerProduct.OBD_BLUETOOTH]: '/trackers/obd-bluetooth.webp',
  [TrackerProduct.CONNECTED_4G]: '/trackers/connected-4g.webp',
};

const PRODUCT_ICON: Record<TrackerProduct, typeof Bluetooth> = {
  [TrackerProduct.OBD_BLUETOOTH]: Bluetooth,
  [TrackerProduct.CONNECTED_4G]: RadioTower,
};

/** The product photo, falling back to an icon if the file cannot load. */
export function TrackerProductImage({
  product,
  className,
}: {
  product: TrackerProductDefinition;
  /** Sets the frame — aspect ratio, rounding. The photo covers it. */
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const Icon = PRODUCT_ICON[product.product];
  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-gradient-to-b from-muted/60 to-muted/20',
        className,
      )}
    >
      {failed ? (
        <Icon className="size-10 text-muted-foreground/60" aria-hidden />
      ) : (
        <img
          src={PRODUCT_IMAGE[product.product]}
          alt={product.name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-500 ease-smooth group-hover:scale-[1.04]"
        />
      )}
    </div>
  );
}
