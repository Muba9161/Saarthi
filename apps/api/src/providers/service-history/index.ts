import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { InternalServiceHistoryProvider } from './internal-service-history.provider';
import { MockServiceHistoryProvider } from './mock-service-history.provider';
import type { ServiceHistoryProvider } from './service-history.provider';

/**
 * Service-history provider factory.
 *
 * The mock is refused in production for a sharper reason than usual: a
 * simulated service record does not just look wrong on a dashboard, it enters
 * the vehicle history a buyer, an insurer or a workshop will later rely on.
 */
function createServiceHistoryProvider(): ServiceHistoryProvider {
  switch (config.serviceHistory.provider) {
    case 'mock':
      if (config.isProduction) {
        throw new Error(
          'SERVICE_HISTORY_PROVIDER=mock is not permitted in production — simulated service ' +
            'records would enter a vehicle history that buyers and insurers rely on.',
        );
      }
      return new MockServiceHistoryProvider();
    case 'internal':
    default:
      return new InternalServiceHistoryProvider();
  }
}

export const serviceHistoryProvider: ServiceHistoryProvider = createServiceHistoryProvider();

logger.info(
  {
    provider: serviceHistoryProvider.name,
    retrieval: serviceHistoryProvider.supportsRetrieval,
  },
  'Service history provider ready',
);

export * from './service-history.provider';
