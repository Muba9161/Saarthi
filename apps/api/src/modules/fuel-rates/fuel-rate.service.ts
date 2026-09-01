import { hasAnyFuelRate, type CityFuelRate, type CityFuelRateQuery } from '@saarthi/shared';
import { config } from '../../config/env';
import { cache } from '../../infra/cache';
import { isAppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { fuelRateProvider, fuelRatesEnabled } from '../../providers/fuel-rates';

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
 * Cache key.
 *
 * Keyed on the resolved city and state, lower-cased, so "Gurugram", "GURGAON"
 * and "gurgaon" share one entry rather than billing three lookups for one city.
 */
function cacheKey(query: CityFuelRateQuery): string {
  return [
    'fuel-rate',
    fuelRateProvider.name,
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
 */
export async function getCityFuelRate(query: CityFuelRateQuery): Promise<CityFuelRate | null> {
  if (!fuelRatesEnabled) return null;

  const key = cacheKey(query);

  // A miss and a known-uncovered city are different things, and both must be
  // cached: without the second, an uncovered city re-fetches three pages on
  // every map pan.
  const hit = await cache.get<CityFuelRate | { covered: false }>(key);
  if (hit !== null) {
    if ('covered' in hit) return null;
    return { ...hit, cached: true };
  }

  let rate: CityFuelRate | null = null;

  try {
    const provided = await fuelRateProvider.lookup({
      city: query.city,
      state: query.state ?? undefined,
    });

    if (provided && hasAnyFuelRate({ ...provided, cached: false, retrievedAt: '' })) {
      rate = { ...provided, retrievedAt: new Date().toISOString(), cached: false };
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

  await cache.set(
    key,
    rate ?? { covered: false as const },
    config.fuelRates.cacheTtlSeconds,
  );

  return rate;
}
