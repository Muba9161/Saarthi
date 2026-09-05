import * as React from 'react';
import { Loader2, MapPin, Navigation } from 'lucide-react';
import type { LatLng } from '@saarthi/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FleetMap, type MapMarkerPoint } from '@/features/maps/fleet-map';
import { type NavigationRoute } from '@/features/maps/directions';
import { searchPlaces, type PlaceResult } from '@/features/maps/places';
import { formatEtaClock, formatEtaDuration } from '@/features/maps/route-progress';
import { isRoutingConfigured } from '@/features/maps/map-config';
import { cn } from '@/lib/utils';

/**
 * Where a journey starts and where it ends.
 *
 * A fixed tour runs the route its package describes. A taxi does not — the
 * fare is charged by the kilometre, so the passenger has to say where they are
 * going before anyone can price it, and the API refuses a per-kilometre
 * booking that arrives without a destination.
 *
 * Both ends are picked from the place search rather than typed, because the
 * booking needs coordinates, not prose: a distance cannot be measured from
 * "near the old bus stand", and a driver cannot be sent to it either. What is
 * typed stays as the address, and choosing a result attaches the point.
 *
 * The map is not decoration. It is the only way a passenger can tell that the
 * pin landed on the right "MG Road" of the four the geocoder offered, and
 * seeing the line drawn between the two is what makes an unfamiliar fare
 * believable.
 */

export interface JourneyPoint {
  address: string;
  latitude: number | null;
  longitude: number | null;
}

export const EMPTY_POINT: JourneyPoint = { address: '', latitude: null, longitude: null };

/** A point that can actually be used — one with somewhere on the earth attached. */
export function isLocatable(
  point: JourneyPoint | null | undefined,
): point is JourneyPoint & { latitude: number; longitude: number } {
  return Boolean(point && point.latitude !== null && point.longitude !== null);
}

/**
 * How long to wait after the last keystroke before searching.
 *
 * Long enough that typing a colony name is a couple of requests rather than
 * fifteen — Nominatim asks callers not to hammer it — and short enough that
 * the list appears while the finger is still moving.
 */
const SEARCH_DEBOUNCE_MS = 350;

function PlaceField({
  id,
  label,
  placeholder,
  value,
  onChange,
  near,
  required,
  error,
  hint,
  icon: Icon,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: JourneyPoint;
  onChange: (next: JourneyPoint) => void;
  /** Biases results towards where the work is. */
  near?: LatLng | null;
  required?: boolean;
  error?: string | null;
  hint?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const [results, setResults] = React.useState<PlaceResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  /** Closed after a pick, so choosing a place does not search for its own label. */
  const [dismissed, setDismissed] = React.useState(true);

  const query = value.address.trim();
  const pinned = isLocatable(value);
  const nearKey = near ? `${near.latitude.toFixed(2)},${near.longitude.toFixed(2)}` : '';

  /*
   * Search as it is typed.
   *
   * The button this replaced made every lookup a decision, and a dispatcher
   * who did not press it simply got no coordinates at all. Debounced, and
   * aborted when the query moves on, so the answer on screen is always the
   * answer to what is currently in the box.
   */
  React.useEffect(() => {
    if (dismissed || pinned || query.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      const bias = nearKey
        ? {
            latitude: Number(nearKey.split(',')[0]),
            longitude: Number(nearKey.split(',')[1]),
          }
        : undefined;

      void searchPlaces(query, {
        limit: 6,
        signal: controller.signal,
        ...(bias ? { near: bias } : {}),
      })
        .then((found) => {
          if (!controller.signal.aborted) setResults(found);
        })
        .catch(() => {
          if (!controller.signal.aborted) setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, nearKey, pinned, dismissed]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} required={required}>
        {label}
      </Label>

      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={value.address}
          placeholder={placeholder}
          autoComplete="off"
          aria-invalid={Boolean(error) || undefined}
          className="pl-9 pr-9"
          onChange={(event) => {
            setDismissed(false);
            // Editing the text invalidates the pin that came with it — the
            // alternative is a booking whose address and coordinates
            // describe two different places.
            onChange({ address: event.target.value, latitude: null, longitude: null });
          }}
          onKeyDown={(event) => {
            // Enter inside a wizard step would otherwise advance the step.
            if (event.key === 'Enter') event.preventDefault();
            if (event.key === 'Escape') setDismissed(true);
          }}
        />
        {searching ? (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {!dismissed && !pinned && results.length > 0 ? (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({
                    address: place.address,
                    latitude: place.position.latitude,
                    longitude: place.position.longitude,
                  });
                  setResults([]);
                  setDismissed(true);
                }}
                className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary"
              >
                <span className="block truncate text-sm font-medium">{place.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {place.address}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!dismissed && !pinned && !searching && query.length >= 3 && results.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing matched. Try the colony or landmark name together with the city.
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : pinned ? (
        <p className="text-xs text-success">Pinned on the map.</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function JourneyPicker({
  pickup,
  onPickupChange,
  dropoff,
  onDropoffChange,
  /** Per-kilometre packages cannot be priced without a destination. */
  dropoffRequired = false,
  pickupError,
  dropoffError,
  departAt,
  near,
  onRouteChange,
  labels,
  className,
}: {
  pickup: JourneyPoint;
  onPickupChange: (next: JourneyPoint) => void;
  dropoff: JourneyPoint;
  onDropoffChange: (next: JourneyPoint) => void;
  dropoffRequired?: boolean;
  pickupError?: string | null;
  dropoffError?: string | null;
  /** When the journey starts, so the arrival clock is for the right day. */
  departAt?: Date | null;
  /**
   * Where to bias the search — the vehicle's last known position, usually.
   * "Station Road" exists in a hundred towns, and the one meant is nearly
   * always the one near the lorry.
   */
  near?: LatLng | null;
  /** The road route, once both ends are pinned — for pricing the run. */
  onRouteChange?: (route: NavigationRoute | null) => void;
  /**
   * Wording for the two ends.
   *
   * The mechanics are identical whether the load is a family or forty tonnes
   * of cement, but the words are not: a freight dispatcher collects from a
   * yard and delivers to a site, and asking them "where are you going?" reads
   * as though the software has mistaken them for the passenger.
   */
  labels?: {
    pickup?: string;
    pickupPlaceholder?: string;
    dropoff?: string;
    dropoffPlaceholder?: string;
    dropoffHint?: string;
  };
  className?: string;
}) {
  const [route, setRoute] = React.useState<NavigationRoute | null>(null);

  const report = React.useCallback(
    (next: NavigationRoute | null) => {
      setRoute(next);
      onRouteChange?.(next);
    },
    [onRouteChange],
  );

  const markers: MapMarkerPoint[] = [];
  if (isLocatable(pickup)) {
    markers.push({
      id: 'journey-pickup',
      latitude: pickup.latitude,
      longitude: pickup.longitude,
      label: pickup.address || 'Pickup',
      kind: 'origin',
    });
  }
  if (isLocatable(dropoff)) {
    markers.push({
      id: 'journey-dropoff',
      latitude: dropoff.latitude,
      longitude: dropoff.longitude,
      label: dropoff.address || 'Destination',
      kind: 'destination',
    });
  }

  const bothPinned = markers.length === 2;

  return (
    <div className={cn('space-y-3', className)}>
      <PlaceField
        id="journey-pickup"
        label={labels?.pickup ?? 'Pickup'}
        placeholder={labels?.pickupPlaceholder ?? 'Where should we collect you?'}
        icon={MapPin}
        value={pickup}
        onChange={onPickupChange}
        near={near ?? null}
        error={pickupError ?? null}
        required
      />

      <PlaceField
        id="journey-dropoff"
        label={labels?.dropoff ?? 'Destination'}
        placeholder={labels?.dropoffPlaceholder ?? 'Where are you going?'}
        icon={Navigation}
        value={dropoff}
        onChange={onDropoffChange}
        // Once the pickup is known it is the better bias for the destination:
        // most journeys end nearer their start than to anywhere else.
        near={
          isLocatable(pickup)
            ? { latitude: pickup.latitude, longitude: pickup.longitude }
            : (near ?? null)
        }
        error={dropoffError ?? null}
        required={dropoffRequired}
        hint={
          labels?.dropoffHint ??
          (dropoffRequired
            ? 'This trip is charged by the kilometre, so the fare depends on this.'
            : 'Optional — leave it blank to follow the package route.')
        }
      />

      {markers.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <FleetMap
            markers={markers}
            /*
             * With both ends pinned the router draws the roads that actually
             * connect them. With one, there is nothing to route — the map is
             * there to show where the pin landed.
             */
            navigation={bothPinned && isRoutingConfigured}
            {...(bothPinned && !isRoutingConfigured
              ? {
                  route: markers.map((marker) => ({
                    latitude: marker.latitude,
                    longitude: marker.longitude,
                  })),
                }
              : {})}
            onRouteChange={report}
            height="220px"
            autoFit
            showControls={false}
          />
          {route ? (
            <RouteSummary route={route} departAt={departAt ?? null} className="p-3 pt-2.5" />
          ) : null}
        </div>
      ) : (
        <div className="flex h-[110px] items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground">
          <MapPin className="size-4" />
          Search a place above to see it on the map.
        </div>
      )}
    </div>
  );
}

/** Shown while the fare is being re-quoted for a changed journey. */
export function QuotePending() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      Pricing your journey…
    </span>
  );
}

/**
 * What the route works out to: how far, how long, and what time that lands.
 *
 * The road distance here is not the one the fare is charged on — that is
 * measured straight-line on the server, and quoted in the price breakdown —
 * so this is labelled "by road" to keep the two figures from reading as a
 * contradiction. It is the honest answer to "how long will this take", which
 * neither a package duration nor a straight line can give.
 *
 * `departAt` shifts the arrival clock to a journey that has not started yet: a
 * cab booked for tomorrow morning arrives tomorrow morning, not in 40 minutes.
 */
export function RouteSummary({
  route,
  departAt,
  className,
}: {
  route: NavigationRoute | null;
  departAt?: Date | null;
  className?: string;
}) {
  if (!route) return null;

  const from = departAt && departAt.getTime() > Date.now() ? departAt.getTime() : Date.now();
  const facts: { label: string; value: string }[] = [
    { label: 'Distance by road', value: `${(route.distanceMeters / 1000).toFixed(1)} km` },
    { label: 'Driving time', value: formatEtaDuration(route.durationSeconds) },
    { label: 'Arrives about', value: formatEtaClock(from + route.durationSeconds * 1000) },
  ];
  if (route.summary) facts.push({ label: 'Via', value: route.summary });

  return (
    <dl className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4', className)}>
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{fact.label}</dt>
          <dd className="truncate text-sm font-medium tabular-nums">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
