import { hasAnyFuelRate, type CityFuelRate, type CityFuelRateQuery } from '@saarthi/shared';
import { config } from '../../config/env';
import { cache } from '../../infra/cache';
import { isAppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  fuelRateProvider,
  fuelRatesEnabled,
  type FuelRateScope,
} from '../../providers/fuel-rates';

/**
 * City fuel rates.
 *
 * One responsibility beyond fetching: never let a bad or absent answer become a
 * wrong number on screen. Three rules, in order of importance:
 *
 *  * A publisher outage returns `null`, not a stale figure. There is no
 *    fallback mirror here — unlike station locations, which age gracefully, a
 *    fuel price that is a week old is actively misleading and the UI is better
 *    off saying nothing.
 *  * A rate with no usable figure at all is treated as no rate.
 *  * Failures are logged and swallowed. A fuel rate is an enrichment on a
 *    station list; it must never take the station list down with it.
 */

const serviceLogger = logger.child({ module: 'fuel-rates' });

/**
 * How long a rate missing some fuel is kept.
 *
 * Only ever applied when a page failed to load or could not be read. Caching
 * that for the full TTL is how a petrol vehicle was shown "no rate" for hours
 * in a city whose petrol rate was published all along.
 */
const INCOMPLETE_RATE_TTL_SECONDS = 10 * 60;

/**
 * Cache key.
 *
 * Keyed on the resolved city and state, lower-cased, so "Gurugram", "GURGAON"
 * and "gurgaon" share one entry rather than billing three lookups for one city.
 */
function cacheKey(query: CityFuelRateQuery, scope: FuelRateScope): string {
  return [
    'fuel-rate',
    fuelRateProvider.name,
    scope,
    query.city.trim().toLowerCase(),
    (query.state ?? '').trim().toLowerCase(),
  ].join(':');
}

/**
 * Look up a city's published fuel rates.
 *
 * Returns `null` when no rate can be had honestly — the feature is disabled,
 * the city is not covered, the publisher is down, or the page no longer parses.
 * Every one of those is a "show no price" outcome for the caller.
 *
 * `scope: 'state'` asks for the state-wide average instead, with `query.city`
 * naming the state.
 */
export async function getCityFuelRate(
  query: CityFuelRateQuery,
  scope: FuelRateScope = 'city',
): Promise<CityFuelRate | null> {
  if (!fuelRatesEnabled) return null;

  const key = cacheKey(query, scope);

  // A miss and a known-uncovered city are different things, and both must be
  // cached: without the second, an uncovered city re-fetches three pages on
  // every map pan.
  const hit = await cache.get<CityFuelRate | { covered: false }>(key);
  if (hit !== null) {
    if ('covered' in hit) return null;
    return { ...hit, cached: true };
  }

  let rate: CityFuelRate | null = null;
  let ttlSeconds = config.fuelRates.cacheTtlSeconds;

  try {
    const provided = await fuelRateProvider.lookup({
      city: query.city,
      state: query.state ?? undefined,
      scope,
    });

    if (provided) {
      const { incomplete, ...published } = provided;
      const candidate: CityFuelRate = {
        ...published,
        retrievedAt: new Date().toISOString(),
        cached: false,
      };
      if (hasAnyFuelRate(candidate)) rate = candidate;
      if (incomplete) ttlSeconds = Math.min(ttlSeconds, INCOMPLETE_RATE_TTL_SECONDS);
    }
  } catch (error) {
    // Enrichment must not fail the request it decorates.
    serviceLogger.warn(
      {
        city: query.city,
        provider: fuelRateProvider.name,
        err: isAppError(error) ? error.message : error,
      },
      'Fuel rate lookup failed — no rate will be shown',
    );
    return null;
  }

  await cache.set(key, rate ?? { covered: false as const }, ttlSeconds);

  return rate;
}
