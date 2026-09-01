import * as React from 'react';
import { MapPin, Search, X } from 'lucide-react';
import {
  bearing,
  compassDirection,
  distanceKm,
  formatDistanceKm,
  type LatLng,
} from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { geocodeForward, type GeocodeFeature } from './directions';
import { isRoutingConfigured } from './map-config';

/**
 * Place search over the map.
 *
 * Geocoding is metered, so queries are debounced and only fire from three
 * characters up; an in-flight request is aborted the moment the query changes.
 *
 * Two things make the results trustworthy rather than merely present:
 *
 *  * Every result is measured against the point the search was biased towards
 *    and shows that distance. India has the same place name in a dozen states —
 *    a row that cannot say how far away it is cannot be checked.
 *  * Results near that point are listed before distant ones, keeping the
 *    geocoder's own relevance order inside each group. The geocoder treats
 *    proximity as one signal among many, so without this a nationally
 *    better-known match a thousand kilometres away outranks the one next door.
 */

export interface MapSearchProps {
  /** Biases results towards what the operator is currently looking at. */
  proximity?: LatLng | null;
  onSelect: (feature: GeocodeFeature) => void;
  className?: string;
  placeholder?: string;
  /**
   * How far "near here" reaches, in km. Wide enough to cover a day's driving,
   * so a genuine long-distance destination is grouped second rather than lost.
   */
  localRadiusKm?: number;
}

const DEBOUNCE_MS = 320;
const DEFAULT_LOCAL_RADIUS_KM = 150;

interface RankedFeature {
  feature: GeocodeFeature;
  distanceKm: number | null;
  direction: string | null;
}

/**
 * Measure each result against the bias point, then float the local ones.
 *
 * `sort` is stable in every engine Saarthi supports, so the geocoder's ordering
 * survives inside each group and only the grouping is Saarthi's opinion.
 */
function rankFeatures(
  features: GeocodeFeature[],
  origin: LatLng | null,
  localRadiusKm: number,
): RankedFeature[] {
  const ranked: RankedFeature[] = features.map((feature) => {
    if (!origin) return { feature, distanceKm: null, direction: null };
    return {
      feature,
      distanceKm: distanceKm(origin, feature.position),
      direction: compassDirection(bearing(origin, feature.position)),
    };
  });

  if (!origin) return ranked;

  return ranked.sort((a, b) => {
    const aLocal = (a.distanceKm ?? Number.POSITIVE_INFINITY) <= localRadiusKm;
    const bLocal = (b.distanceKm ?? Number.POSITIVE_INFINITY) <= localRadiusKm;
    if (aLocal !== bLocal) return aLocal ? -1 : 1;
    return 0;
  });
}

export function MapSearch({
  proximity,
  onSelect,
  className,
  placeholder,
  localRadiusKm = DEFAULT_LOCAL_RADIUS_KM,
}: MapSearchProps) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<GeocodeFeature[]>([]);
  /** The bias point the current results were fetched against. */
  const [resultOrigin, setResultOrigin] = React.useState<LatLng | null>(null);
  const [open, setOpen] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  // A ref keeps the debounced effect from re-running whenever the map pans.
  const proximityRef = React.useRef(proximity);
  proximityRef.current = proximity;

  React.useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setFailed(false);
      return undefined;
    }

    const controller = new AbortController();
    setSearching(true);

    const timer = window.setTimeout(() => {
      const bias = proximityRef.current;
      geocodeForward(trimmed, {
        signal: controller.signal,
        ...(bias ? { proximity: bias } : {}),
        // Ask for more than are shown: the local group is picked from these, so
        // a nearby match ranked eighth nationally still surfaces first here.
        limit: 10,
      })
        .then((features) => {
          setResults(features);
          setResultOrigin(bias ?? null);
          setFailed(false);
          setOpen(true);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setResults([]);
          setFailed(true);
        })
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      setSearching(false);
    };
  }, [query]);

  // Geocoding rides on the routing key; without it there is nothing to search.
  if (!isRoutingConfigured) return null;

  const ranked = rankFeatures(results, resultOrigin, localRadiusKm);

  const choose = (feature: GeocodeFeature): void => {
    onSelect(feature);
    setQuery(feature.name);
    setOpen(false);
  };

  const clear = (): void => {
    setQuery('');
    setResults([]);
    setResultOrigin(null);
    setOpen(false);
    setFailed(false);
  };

  return (
    <div className={cn('w-full max-w-sm', className)}>
      <div className="glass flex items-center gap-1.5 rounded-xl px-2.5 py-1.5">
        <Search
          className={cn('size-4 shrink-0 text-muted-foreground', searching && 'animate-pulse')}
          aria-hidden="true"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') clear();
            // Enter takes the top row as displayed, which is the nearest good
            // match rather than whatever the geocoder happened to list first.
            if (event.key === 'Enter' && ranked[0]) choose(ranked[0].feature);
          }}
          placeholder={placeholder ?? 'Search a place, address or highway'}
          aria-label="Search the map"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {query ? (
          <Button size="icon-sm" variant="ghost" onClick={clear} aria-label="Clear search">
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>

      {open && (results.length > 0 || failed) ? (
        <ul className="glass mt-1.5 max-h-64 overflow-y-auto rounded-xl py-1">
          {failed ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              Search is unavailable right now.
            </li>
          ) : (
            ranked.map(({ feature, distanceKm: away, direction }) => (
              <li key={feature.id}>
                <button
                  type="button"
                  onClick={() => choose(feature)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-secondary/70"
                >
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{feature.name}</span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {feature.address}
                    </span>
                  </span>
                  {away !== null ? (
                    <span className="tabular shrink-0 text-right text-2xs text-muted-foreground">
                      <span className="block">{formatDistanceKm(away)}</span>
                      {direction ? <span className="block">{direction}</span> : null}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
