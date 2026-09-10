import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { HttpGodWebProvider } from './http-godweb.provider';
import type { GodWebProvider } from './godweb.provider';

/**
 * GODWeb provider factory.
 *
 * Like the identity, RC and licence providers, this one **does not degrade to
 * a local substitute**, and the reason is the same as it is there, only
 * sharper: a "verified" salesman profile is a claim that GODWeb recognises a
 * person, and a commission will eventually be paid against it. A development
 * stub that said yes would be a stub that authorised money.
 *
 * With nothing configured, GODID verification is unavailable:
 *
 *   * `POST /sales/salesmen` still creates a profile, in
 *     `PENDING_VERIFICATION`;
 *   * the verify endpoint answers 503 and says why;
 *   * the profile issues no referral link and accrues no commission;
 *   * a platform administrator may vouch for the GODID by hand
 *     (`POST /sales/salesmen/:id/verify-manually`), which records their user
 *     id, the evidence they cite and an audit entry — so the environment is
 *     operable before GODWeb publishes its endpoint, without anything
 *     pretending GODWeb was asked.
 *
 * The dependency is documented in
 * `docs/SAARTHI_SALES_IMPLEMENTATION_REPORT.md`.
 */
function createGodWebProvider(): GodWebProvider | null {
  if (!config.godweb.configured) {
    logger.warn(
      'GODWEB_BASE_URL / GODWEB_API_KEY are not set — GODID verification is disabled on this ' +
        'environment. Salesman profiles will stay PENDING_VERIFICATION, issue no referral link ' +
        'and accrue no commission until a platform administrator verifies them.',
    );
    return null;
  }

  try {
    return new HttpGodWebProvider();
  } catch (error) {
    logger.error({ err: error }, 'GODWeb provider could not be initialised');
    return null;
  }
}

export const godWebProvider: GodWebProvider | null = createGodWebProvider();

if (godWebProvider) {
  logger.info({ provider: godWebProvider.name }, 'GODWeb salesman validation ready');
}

/** `true` when this environment can ask GODWeb about a GODID at all. */
export const godWebConfigured = godWebProvider !== null;

/** The configured provider, or a 503 that explains the missing dependency. */
export function requireGodWebProvider(): GodWebProvider {
  if (!godWebProvider) {
    throw errors.providerNotConfigured(
      'godweb',
      'GODID verification is not enabled on this environment. A Saarthi platform ' +
        'administrator can verify this salesperson manually in the meantime.',
    );
  }
  return godWebProvider;
}

export * from './godweb.provider';
export { normalizeGodWebSalesperson } from './http-godweb.provider';
