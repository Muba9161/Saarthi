import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { Way2ApiIdentityProvider } from './way2api-identity.provider';
import type { IdentityVerificationProvider } from './identity.provider';

/**
 * Identity verification provider factory.
 *
 * Like the RC and licence providers, this one does not degrade to a local
 * substitute. A "verified" badge on a driver's PAN is a claim about a
 * government record; inventing one in development would mean a fleet trusting
 * an identity nothing ever checked, which is worse than no answer at all.
 *
 * With no key configured the endpoints return 503 and the UI says verification
 * is unavailable on this environment — the local checksum validation still
 * runs, because that part is honest without a provider.
 */
function createIdentityProvider(): IdentityVerificationProvider | null {
  if (!config.identity.apiKey) {
    logger.warn(
      'WAY2API_API_KEY is not set — online identity verification (PAN, Voter ID, GST, ' +
        'Aadhaar–PAN link) is disabled on this environment. Checksum validation still applies.',
    );
    return null;
  }
  try {
    return new Way2ApiIdentityProvider();
  } catch (error) {
    logger.error({ err: error }, 'Identity verification provider could not be initialised');
    return null;
  }
}

export const identityProvider: IdentityVerificationProvider | null = createIdentityProvider();

if (identityProvider) {
  logger.info({ provider: identityProvider.name }, 'Identity verification provider ready');
}

/** `true` when this environment can reach a government source at all. */
export const identityProviderConfigured = identityProvider !== null;

/** The configured provider, or a 503 explaining that verification is unavailable. */
export function requireIdentityProvider(): IdentityVerificationProvider {
  if (!identityProvider) {
    throw errors.providerNotConfigured(
      'identity',
      'Online identity verification is not enabled on this environment.',
    );
  }
  return identityProvider;
}

export * from './identity.provider';
export {
  normalizeWay2ApiPan,
  normalizeWay2ApiVoterId,
  normalizeWay2ApiGst,
  looseNameMatch,
} from './way2api-identity.provider';
