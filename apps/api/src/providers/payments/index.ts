import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { CashfreePaymentProvider } from './cashfree-payment.provider';
import { MockPaymentProvider } from './mock-payment.provider';
import type { PaymentProvider } from './payment.provider';

/**
 * Payment provider factory.
 *
 * `PAYMENT_PROVIDER=cashfree` needs `CASHFREE_APP_ID` and `CASHFREE_SECRET_KEY`;
 * the config refuses to start without them rather than quietly falling back to
 * the mock, because money must not degrade silently.
 */
function createPaymentProvider(): PaymentProvider {
  switch (config.providers.payment) {
    case 'cashfree':
      return new CashfreePaymentProvider();
    case 'mock':
    default:
      return new MockPaymentProvider();
  }
}

export const paymentProvider: PaymentProvider = createPaymentProvider();

logger.info(
  {
    provider: paymentProvider.name,
    ...(paymentProvider.name === 'cashfree' ? { environment: config.cashfree.environment } : {}),
  },
  'Payment provider ready',
);

export * from './payment.provider';
export { verifyCashfreeSignature } from './cashfree-payment.provider';
