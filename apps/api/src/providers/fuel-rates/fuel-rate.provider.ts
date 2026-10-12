import type { CityFuelRate } from '@saarthi/shared';

/**
 * City fuel rate contract.
 *
 * The provider fetches and validates; caching, tenancy and HTTP shape are
 * Saarthi's concern. Keeping the boundary here means a second publisher — or a
 * paid API, if one becomes worth it — drops in without the service or the UI
 * changing.
 */

/**
 * What a rate is published for. A `state` rate is the publisher's state-wide
 * average — the fallback for a town nobody prices on its own, and always
 * labelled as such where it is shown.
 */
export type FuelRateScope = 'city' | 'state';

export interface FuelRateLookup {
  /** The place to price: a city, or the state itself when `scope` is `state`. */
  city: string;
  state?: string | undefined;
  scope?: FuelRateScope;
}

/**
 * What a provider returns, minus the fields only the service can know.
 *
 * `cached` and `retrievedAt` are set by the service, so the adapter cannot
 * accidentally claim a fetch was fresh when it was not.
 */
export type ProviderCityFuelRate = Omit<CityFuelRate, 'cached' | 'retrievedAt'> & {
  /**
   * True when some fuel could not be read this time, so a missing figure may
   * only be missing for now. The service caches such a rate briefly instead of
   * for the full day-part.
   */
  incomplete: boolean;
};

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
