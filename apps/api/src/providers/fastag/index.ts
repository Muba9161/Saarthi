import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { InternalFastagProvider } from './internal-fastag.provider';
import { MastersIndiaFastagProvider } from './mastersindia-fastag.provider';
import { MockFastagProvider } from './mock-fastag.provider';
import type { FastagProvider } from './fastag.provider';

/**
 * FASTag provider factory.
 *
 * The real adapter falls back to the internal one when its credentials are
 * missing, rather than failing the boot: a fleet that has not signed up for a
 * NETC integration should still be able to record its tags by hand. What it
 * must never do is silently substitute the *mock*, which is why that is a
 * separate, explicit choice and is refused in production.
 */
function createFastagProvider(): FastagProvider {
  switch (config.fastag.provider) {
    case 'mastersindia':
      try {
        return new MastersIndiaFastagProvider();
      } catch (error) {
        logger.warn(
          { err: error },
          'FASTag provider selected but not configured — falling back to recorded data only',
        );
        return new InternalFastagProvider();
      }

    case 'mock':
      if (config.isProduction) {
        throw new Error(
          'FASTAG_PROVIDER=mock is not permitted in production — a simulated balance would be ' +
            'shown where an operator expects a real one.',
        );
      }
      return new MockFastagProvider();

    case 'internal':
    default:
      return new InternalFastagProvider();
  }
}

export const fastagProvider: FastagProvider = createFastagProvider();

logger.info(
  {
    provider: fastagProvider.name,
    lookup: fastagProvider.supportsLookup,
    balance: fastagProvider.supportsBalance,
    transactions: fastagProvider.supportsTransactions,
  },
  'FASTag provider ready',
);

export * from './fastag.provider';
