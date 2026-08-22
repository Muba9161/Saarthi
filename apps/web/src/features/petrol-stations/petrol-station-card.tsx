import { ExternalLink, Fuel } from 'lucide-react';
import { fuelOfferingLabel, isAlwaysOpen, type PetrolStation } from '@saarthi/shared';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A petrol station in the results list.
 *
 * Deliberate wording: the directory tells us which fuels a station *sells* and
 * the rate published for its area. It does not report tank levels, dispenser
 * status or live stock, so nothing here says "available now" and no quantity
 * is ever shown.
 */

function priceLabel(value: number | null): string {
  return value === null ? '—' : `₹${value.toFixed(2)}`;
}

function FuelRow({
  label,
  offered,
  price,
}: {
  label: string;
  offered: boolean | null;
  price: number | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className="tabular font-medium">{priceLabel(price)}</span>
        <span
          className={cn(
            'ml-2 text-[11px]',
            offered ? 'text-success' : 'text-muted-foreground',
          )}
        >
          {fuelOfferingLabel(offered)}
        </span>
      </span>
    </div>
  );
}

export function PetrolStationCard({
  station,
  selected = false,
  onSelect,
}: {
  station: PetrolStation;
  selected?: boolean;
  onSelect?: (stationId: string) => void;
}) {
  const place = [station.city, station.state].filter(Boolean).join(', ');

  return (
    <Card
      variant="glass"
      className={cn(
        'space-y-2 p-3 transition-all',
        onSelect && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lifted',
        selected && 'ring-2 ring-primary/50 shadow-glow',
      )}
      onClick={onSelect ? () => onSelect(station.id) : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {station.company ? (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-warning">
              {station.company}
            </p>
          ) : null}
          <p className="truncate text-sm font-medium">{station.name ?? 'Petrol station'}</p>
          <p className="truncate text-xs text-muted-foreground">{station.address ?? place}</p>
        </div>
        {station.distanceKm !== null ? (
          <div className="shrink-0 text-right">
            <p className="tabular text-sm font-medium">{station.distanceKm} km</p>
            {station.direction ? (
              <p className="text-xs text-muted-foreground">{station.direction}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-1 border-t border-border pt-2">
        <FuelRow label="Petrol" offered={station.hasPetrol} price={station.petrolPrice} />
        <FuelRow label="Diesel" offered={station.hasDiesel} price={station.dieselPrice} />
        <FuelRow label="CNG" offered={station.hasCng} price={station.cngPrice} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {station.timings ? (
          <Badge variant={isAlwaysOpen(station.timings) ? 'success' : 'muted'} size="sm">
            {station.timings}
          </Badge>
        ) : null}
        {station.directionsUrl ? (
          <a
            href={station.directionsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            <ExternalLink className="size-3" />
            Directions
          </a>
        ) : null}
      </div>
    </Card>
  );
}

/** Header strip for the station list, including the honesty note on prices. */
export function PetrolStationListHeader({
  count,
  stale,
}: {
  count: number;
  stale: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Fuel className="size-3.5 text-warning" />
        {count} station{count === 1 ? '' : 's'} nearby
      </p>
      <p className="text-[11px] text-muted-foreground">
        {stale
          ? 'The fuel directory is unreachable — showing the last data Saarthi stored for this area.'
          : 'Fuel types and prices as published by the fuel directory, not live pump readings.'}
      </p>
    </div>
  );
}
