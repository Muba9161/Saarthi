import { randomUUID } from 'node:crypto';
import { logger } from '../../lib/logger';
import type {
  PaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
} from './payment.provider';

/**
 * Local mock gateway.
 *
 * Settles instantly so the whole booking flow — pay, provider confirms, trip,
 * tracking, rating — can be demonstrated without a payment account or a public
 * callback URL.
 *
 * Two honesty rules:
 *
 *  * Every reference is prefixed `MOCK-`, so a mock settlement can never be
 *    mistaken for a real one in the database, a log or a support conversation.
 *  * Failure is reachable. A gateway that always succeeds trains everyone to
 *    assume the failure path works; `simulateFailure` on the pay request drives
 *    a genuine decline through the same code a real decline would take.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly settlesSynchronously = true;

  private readonly log = logger.child({ module: 'payments', provider: 'mock' });

  async createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    const providerReference = `MOCK-${randomUUID().slice(0, 8).toUpperCase()}`;

    // The caller asks for a decline through metadata rather than a separate
    // method, so the failing path is the same call site as the happy one.
    if (input.metadata.simulateFailure === 'true') {
      this.log.info(
        { reference: input.reference, providerReference },
        'Mock payment declined on request',
      );
      return {
        providerReference,
        status: 'FAILED',
        redirectUrl: null,
        failureCode: 'MOCK_DECLINED',
        failureMessage: 'The mock gateway declined this payment as requested.',
        processedAt: null,
      };
    }

    if (input.amount <= 0) {
      return {
        providerReference,
        status: 'FAILED',
        redirectUrl: null,
        failureCode: 'INVALID_AMOUNT',
        failureMessage: 'A payment must be for more than zero.',
        processedAt: null,
      };
    }

    this.log.info(
      { reference: input.reference, providerReference, amount: input.amount },
      'Mock payment settled',
    );

    return {
      providerReference,
      status: 'SUCCEEDED',
      redirectUrl: null,
      failureCode: null,
      failureMessage: null,
      processedAt: new Date(),
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.log.info(
      { providerReference: input.providerReference, amount: input.amount },
      'Mock refund settled',
    );
    return {
      providerReference: `MOCK-RF-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: 'SUCCEEDED',
      refundedAmount: input.amount,
      failureMessage: null,
      processedAt: new Date(),
    };
  }
}
