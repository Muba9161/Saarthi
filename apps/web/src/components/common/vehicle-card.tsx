import * as React from 'react';
import { humanizeEnum } from '@saarthi/shared';
import { StatusBadge } from '@/components/common/status-badge';
import { VEHICLE_ART_ASPECT, VehicleArt } from '@/components/common/vehicle-art';
import { cn } from '@/lib/utils';

/**
 * A vehicle as a card.
 *
 * The shape follows the reference fleet boards: the identity and the live
 * condition on one line at the top, the vehicle's picture given the whole
 * width beneath it, and the two or three figures an operator actually scans
 * for in a footer rail. Reading order matters more than it looks — the plate
 * is what someone is searching the grid for, so it goes first and stays first
 * even when the picture is the largest thing in the card.
 *
 * Deliberately not typed to `TruckSummary`: the same card is wanted for
 * trucks, for the mobility fleet and for a resale listing, and those three
 * records agree on nothing but these fields.
 */
export function VehicleCard({
  registrationNumber,
  type,
  status,
  photoId,
  facts = [],
  footer,
  className,
}: {
  registrationNumber: string;
  /** `truckType` or `vehicleType` — used to choose the illustration. */
  type: string | null | undefined;
  status?: string | null;
  /** A media asset id, when the record has a real photograph. */
  photoId?: string | null;
  /** The figures along the bottom. Three is the most that stays legible. */
  facts?: { label: string; value: React.ReactNode }[];
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <p className="truncate font-semibold tracking-[-0.01em]">{registrationNumber}</p>
          {type ? (
            <p className="truncate text-xs text-muted-foreground">{humanizeEnum(type)}</p>
          ) : null}
        </div>
        {status ? <StatusBadge status={status} size="sm" className="shrink-0" /> : null}
      </div>

      {/*
        A cover image, bled to the card's edges.

        Sized by aspect ratio rather than by height, and the ratio must stay in
        step with whatever `/vehicles/*` is cut to — 3:2 today. That is what
        stops the vehicle being cropped: a fixed height makes the box a
        different shape from the picture on a wide card, and `object-cover`
        pays for the difference by slicing the top and bottom off the truck.
        Matching the ratio means the box and the picture want the same shape,
        so nothing is cut at any card width.
      */}
      <VehicleArt
        type={type}
        registrationNumber={registrationNumber}
        {...(photoId ? { photoId } : {})}
        className={cn('mt-4 w-full', VEHICLE_ART_ASPECT)}
        padding="p-3"
      />

      {facts.length > 0 ? (
        <dl
          className={cn(
            'mt-auto grid gap-3 border-t border-border/70 px-5 py-4',
            facts.length >= 3 ? 'grid-cols-3' : 'grid-cols-2',
          )}
        >
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="section-label truncate">{fact.label}</dt>
              <dd className="tabular mt-0.5 truncate text-sm font-medium">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {footer ? <div className="border-t border-border/70 px-5 py-3">{footer}</div> : null}
    </div>
  );
}

export default VehicleCard;
