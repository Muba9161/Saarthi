import type { CityFuelRate } from '@saarthi/shared';

/**
 * City fuel rate contract.
 *
 * The provider fetches and validates; caching, tenancy and HTTP shape are
 * Saarthi's concern. Keeping the boundary here means a second publisher — or a
 * paid API, if one becomes worth it — drops in without the service or the UI
 * changing.
 */

export interface FuelRateLookup {
  city: string;
  state?: string | undefined;
}

/**
 * What a provider returns, minus the fields only the service can know.
 *
 * `cached` and `retrievedAt` are set by the service, so the adapter cannot
 * accidentally claim a fetch was fresh when it was not.
 */
export type ProviderCityFuelRate = Omit<CityFuelRate, 'cached' | 'retrievedAt'>;

export interface FuelRateProvider {
  readonly name: string;
  /** Human name for attribution in the UI, e.g. "CarDekho". */
  readonly attribution: string;
  /**
   * Look a city's rates up.
   *
   * Returns `null` when the publisher does not cover the city — a normal
   * outcome, not an error. Throws only when the publisher itself is
   * unreachable or answers unusably.
   */
  lookup(input: FuelRateLookup): Promise<ProviderCityFuelRate | null>;
}
