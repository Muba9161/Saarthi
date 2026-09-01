import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { OverpassPlaceProvider } from './overpass-place.provider';
import type { PlaceProvider } from './place.provider';

/**
 * Nearby places provider factory.
 *
 * `PLACES_PROVIDER=local` returns no provider at all, which makes the service
 * layer serve the `nearby_places` table alone — the behaviour Saarthi shipped
 * before a live directory existed, kept as an explicit, supported choice for
 * air-gapped installs and for demos that must not touch the network.
 */
function createPlaceProvider(): PlaceProvider | null {
  if (config.places.provider === 'local') return null;
  return new OverpassPlaceProvider();
}

export const placeProvider: PlaceProvider | null = createPlaceProvider();

logger.info(
  { provider: placeProvider?.name ?? 'local' },
  'Nearby places provider ready',
);

export * from './place.provider';
export { normalizeOverpassElement } from './overpass-place.provider';
