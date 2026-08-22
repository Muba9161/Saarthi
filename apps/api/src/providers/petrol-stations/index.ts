import { logger } from '../../lib/logger';
import { SsrPetrolStationProvider } from './ssr-petrol-station.provider';
import type { PetrolStationProvider } from './petrol-station.provider';

/**
 * Petrol station provider factory.
 *
 * The directory serves unauthenticated reads, so there is nothing to configure
 * for the feature to work locally — an optional key is picked up from the
 * environment when one exists.
 */
function createPetrolStationProvider(): PetrolStationProvider {
  return new SsrPetrolStationProvider();
}

export const petrolStationProvider: PetrolStationProvider = createPetrolStationProvider();

logger.info({ provider: petrolStationProvider.name }, 'Petrol station provider ready');

export * from './petrol-station.provider';
export { normalizeSsrStation } from './ssr-petrol-station.provider';
