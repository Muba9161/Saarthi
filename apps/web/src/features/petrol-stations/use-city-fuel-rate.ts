import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CityFuelRate } from '@saarthi/shared';
import { api } from '@/lib/api-client';

/**
 * Published fuel rates for a city.
 *
 * Keyed on the city rather than coordinates: retail rates are set per city, and
 * the station search already tells us which city the results landed in, so
 * there is nothing to gain from a second reverse-geocode.
 *
 * `null` is a legitimate, successful answer meaning "no rate for this city".
 * The caller shows nothing in that case — which is the whole point, because the
 * source this replaced showed a figure that was years stale.
 */
export function useCityFuelRate({
  city,
  state = null,
  enabled = true,
}: {
  city: string | null;
  state?: string | null;
  enabled?: boolean;
}): UseQueryResult<CityFuelRate | null> {
  const normalized = city?.trim() ?? '';

  return useQuery({
    // Lower-cased so the directory's "Gurugram" / "GURGAON" spellings share one
    // entry, matching how the server keys its own cache.
    queryKey: ['city-fuel-rate', normalized.toLowerCase(), (state ?? '').toLowerCase()],
    queryFn: () =>
      api.get<CityFuelRate | null>('/fuel-rates', {
        city: normalized,
        ...(state ? { state } : {}),
      }),
    enabled: enabled && normalized.length >= 2,
    // Rates revise once daily at 06:00 IST; the server caches for six hours.
    staleTime: 30 * 60_000,
    // A missing rate must not spam the publisher with retries.
    retry: false,
  });
}
