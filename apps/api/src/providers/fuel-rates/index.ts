import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { CardekhoFuelRateProvider } from './cardekho-fuel-rate.provider';
import type { FuelRateProvider } from './fuel-rate.provider';

/**
 * Fuel rate provider factory.
 *
 * `FUEL_RATE_PROVIDER=none` yields a provider that covers nothing, so the UI
 * shows no rate at all. That is a legitimate configuration rather than a broken
 * one: showing nothing is always safer than showing a rate Saarthi cannot
 * stand behind.
 */

class DisabledFuelRateProvider implements FuelRateProvider {
  readonly name = 'none';
  readonly attribution = 'not configured';

  async lookup(): Promise<null> {
    return null;
  }
}

function createFuelRateProvider(): FuelRateProvider {
  if (config.fuelRates.provider === 'none') return new DisabledFuelRateProvider();
  return new CardekhoFuelRateProvider();
}

export const fuelRateProvider: FuelRateProvider = createFuelRateProvider();

export const fuelRatesEnabled: boolean = config.fuelRates.provider !== 'none';

logger.info(
  { provider: fuelRateProvider.name, enabled: fuelRatesEnabled },
  'Fuel rate provider ready',
);

export * from './fuel-rate.provider';
export { citySlug, parseFuelRate, parsePublishedOn } from './cardekho-fuel-rate.provider';
