import * as React from 'react';
import { MapPin, Search, X } from 'lucide-react';
import type { LatLng } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { geocodeForward, type GeocodeFeature } from './directions';
import { isRoutingConfigured } from './map-config';

/**
 * Place search over the map.
 *
 * Geocoding is metered, so queries are debounced and only fire from three
 * characters up; an in-flight request is aborted the moment the query changes.
 */

export interface MapSearchProps {
  /** Biases results towards what the operator is currently looking at. */
  proximity?: LatLng | null;
  onSelect: (feature: GeocodeFeature) => void;
  className?: string;
  placeholder?: string;
}

const DEBOUNCE_MS = 320;

export function MapSearch({ proximity, onSelect, className, placeholder }: MapSearchProps) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<GeocodeFeature[]>([]);
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
      })
        .then((features) => {
          setResults(features);
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

  const choose = (feature: GeocodeFeature): void => {
    onSelect(feature);
    setQuery(feature.name);
    setOpen(false);
  };

  const clear = (): void => {
    setQuery('');
    setResults([]);
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
            if (event.key === 'Enter' && results[0]) choose(results[0]);
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
            results.map((feature) => (
              <li key={feature.id}>
                <button
                  type="button"
                  onClick={() => choose(feature)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-secondary/70"
                >
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{feature.name}</span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {feature.address}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
