import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { Way2ApiRcProvider } from './way2api-rc.provider';
import type { VehicleRcProvider } from './vehicle-rc.provider';

/**
 * Vehicle RC provider factory.
 *
 * Unlike the AI copilot, this integration does not degrade to a local
 * substitute: RC data is a legal record, and a plausible-looking stand-in
 * would be worse than no answer. An unconfigured environment therefore has no
 * provider at all, and callers get an explicit "not configured" error.
 */
function createVehicleRcProvider(): VehicleRcProvider | null {
  if (!config.vehicleRc.apiKey) {
    logger.warn(
      'WAY2API_API_KEY is not set — vehicle registration lookup is disabled on this environment',
    );
    return null;
  }
  try {
    return new Way2ApiRcProvider();
  } catch (error) {
    logger.error({ err: error }, 'Vehicle RC provider could not be initialised');
    return null;
  }
}

export const vehicleRcProvider: VehicleRcProvider | null = createVehicleRcProvider();

if (vehicleRcProvider) {
  logger.info({ provider: vehicleRcProvider.name }, 'Vehicle RC provider ready');
}

/** The configured provider, or a 503 explaining that lookups are unavailable. */
export function requireVehicleRcProvider(): VehicleRcProvider {
  if (!vehicleRcProvider) {
    throw errors.providerNotConfigured(
      'vehicle-rc',
      'Vehicle registration lookup is not enabled on this environment.',
    );
  }
  return vehicleRcProvider;
}

export * from './vehicle-rc.provider';
export { normalizeWay2ApiRecord, maskRegistration } from './way2api-rc.provider';
