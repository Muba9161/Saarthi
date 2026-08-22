import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { MockPaymentProvider } from './mock-payment.provider';
import type { PaymentProvider } from './payment.provider';

/**
 * Payment provider factory.
 *
 * `PAYMENT_PROVIDER=production` refuses to start rather than quietly falling
 * back to the mock. Every other provider in Saarthi degrades gracefully, but
 * money must not: a production deployment that silently "settled" payments
 * through a mock gateway would take bookings nobody had paid for.
 */
function createPaymentProvider(): PaymentProvider {
  switch (config.providers.payment) {
    case 'production':
      throw new Error(
        'PAYMENT_PROVIDER=production requires a real gateway implementation. ' +
          'Add one under src/providers/payments and select it here before deploying.',
      );
    case 'mock':
    default:
      return new MockPaymentProvider();
  }
}

export const paymentProvider: PaymentProvider = createPaymentProvider();

logger.info({ provider: paymentProvider.name }, 'Payment provider ready');

export * from './payment.provider';
