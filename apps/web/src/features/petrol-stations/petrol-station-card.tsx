import { ExternalLink, Fuel, Route as RouteIcon, X } from 'lucide-react';
import {
  FUEL_DIRECTORY_PRICE_NOTE,
  describeFuelRate,
  formatFuelRate,
  fuelOfferingText,
  hasAnyFuelRate,
  isAlwaysOpen,
  stationFuelOffering,
  type CityFuelRate,
  type FuelOffering,
  type FuelRateEntry,
  type PetrolFuelFilter,
  type PetrolStation,
} from '@saarthi/shared';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A petrol station in the results list.
 *
 * Two deliberate omissions, both because the directory cannot support the
 * claim:
 *
 *  * No price, at all. The directory's rate is a city figure years out of date
 *    — 8% below the real pump price when measured — and carries no timestamp to
 *    disclose that. See `FUEL_DIRECTORY_PRICE_NOTE` in the domain model.
 *  * Nothing says "available now". The directory reports no tank level,
 *    dispenser state or stock, and no quantity is ever shown.
 *
 * What it does show is the part that holds up: where the station is, who brands
 * it, its hours, and which fuels it sells.
 */

const OFFERING_TONE: Record<FuelOffering, string> = {
  sold: 'text-success',
  'not-sold': 'text-muted-foreground',
  unknown: 'text-muted-foreground',
};

function FuelRow({ label, offering }: { label: string; offering: FuelOffering }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('text-[11px]', OFFERING_TONE[offering])}>
        {fuelOfferingText(offering)}
      </span>
    </div>
  );
}

const FUEL_ROWS: { fuel: PetrolFuelFilter; label: string }[] = [
  { fuel: 'petrol', label: 'Petrol' },
  { fuel: 'diesel', label: 'Diesel' },
  { fuel: 'cng', label: 'CNG' },
];

export function PetrolStationCard({
  station,
  selected = false,
  onSelect,
  onShowRoute,
  onClearRoute,
  routeActive = false,
}: {
  station: PetrolStation;
  selected?: boolean;
  onSelect?: (stationId: string) => void;
  /** Draw the route to this station on the map already on screen. */
  onShowRoute?: (station: PetrolStation) => void;
  onClearRoute?: () => void;
  /** This station is the one currently routed to. */
  routeActive?: boolean;
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
        {FUEL_ROWS.map(({ fuel, label }) => (
          <FuelRow key={fuel} label={label} offering={stationFuelOffering(station, fuel)} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {station.timings ? (
          <Badge variant={isAlwaysOpen(station.timings) ? 'success' : 'muted'} size="sm">
            {station.timings}
          </Badge>
        ) : null}

        {onShowRoute ? (
          routeActive ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              onClick={(event) => {
                event.stopPropagation();
                onClearRoute?.();
              }}
            >
              <X className="size-3" />
              Clear route
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={(event) => {
                event.stopPropagation();
                onShowRoute(station);
              }}
            >
              <RouteIcon className="size-3" />
              Route
            </button>
          )
        ) : station.directionsUrl ? (
          // Fallback for callers that cannot draw a route themselves.
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

/**
 * Header strip for the station list.
 *
 * Carries the city's published rate when one could be had honestly, and says
 * plainly that there is none when it could not. The rate comes from a retail
 * rate publisher rather than the station directory, and always with the date
 * the publisher stamped on it — the directory's own figures were a single city
 * number years out of date with no date attached, which is exactly the failure
 * this display exists to make impossible.
 */
export function PetrolStationListHeader({
  count,
  stale,
  rate = null,
  rateLoading = false,
}: {
  count: number;
  stale: boolean;
  /** The city's published rate, or `null` when none is available. */
  rate?: CityFuelRate | null;
  rateLoading?: boolean;
}) {
  const rows: { label: string; entry: FuelRateEntry | null }[] = [
    { label: 'Petrol', entry: rate?.petrol ?? null },
    { label: 'Diesel', entry: rate?.diesel ?? null },
    { label: 'CNG', entry: rate?.cng ?? null },
  ].filter((row) => row.entry !== null);

  const showRate = hasAnyFuelRate(rate) && rows.length > 0;

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Fuel className="size-3.5 text-warning" />
        {count} station{count === 1 ? '' : 's'} nearby
      </p>

      {showRate && rate ? (
        <div className="rounded-lg border border-border bg-muted/40 p-2">
          <p className="text-[11px] font-medium">{describeFuelRate(rate)}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
            {rows.map((row) => (
              <span key={row.label}>
                <span className="text-muted-foreground">{row.label} </span>
                <span className="tabular font-medium">{formatFuelRate(row.entry)}</span>
              </span>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            City rate via {rate.source}, not an individual pump price.
          </p>
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        {stale
          ? 'The fuel directory is unreachable — showing the last data Saarthi stored for this area.'
          : showRate
            ? 'Fuel types as listed by the station directory. It reports no tank level or stock.'
            : rateLoading
              ? 'Checking today’s published rate…'
              : FUEL_DIRECTORY_PRICE_NOTE}
      </p>
    </div>
  );
}
