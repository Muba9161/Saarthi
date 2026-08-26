import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { Way2ApiLicenceProvider } from './way2api-licence.provider';
import type { DrivingLicenceProvider } from './driving-licence.provider';

/**
 * Driving licence provider factory.
 *
 * Like the RC provider, this one does not degrade to a local substitute: a
 * licence record is a legal document, and a plausible-looking stand-in would be
 * worse than no answer at all.
 */
function createDrivingLicenceProvider(): DrivingLicenceProvider | null {
  if (!config.drivingLicence.apiKey) {
    logger.warn(
      'WAY2API_API_KEY is not set — driving licence lookup is disabled on this environment',
    );
    return null;
  }
  try {
    return new Way2ApiLicenceProvider();
  } catch (error) {
    logger.error({ err: error }, 'Driving licence provider could not be initialised');
    return null;
  }
}

export const drivingLicenceProvider: DrivingLicenceProvider | null = createDrivingLicenceProvider();

if (drivingLicenceProvider) {
  logger.info({ provider: drivingLicenceProvider.name }, 'Driving licence provider ready');
}

/** The configured provider, or a 503 explaining that lookups are unavailable. */
export function requireDrivingLicenceProvider(): DrivingLicenceProvider {
  if (!drivingLicenceProvider) {
    throw errors.providerNotConfigured(
      'driving-licence',
      'Driving licence lookup is not enabled on this environment.',
    );
  }
  return drivingLicenceProvider;
}

export * from './driving-licence.provider';
export { normalizeWay2ApiLicence, maskLicence } from './way2api-licence.provider';
