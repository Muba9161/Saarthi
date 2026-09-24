import { randomUUID } from 'node:crypto';
import { logger } from '../../lib/logger';
import type {
  BankVerificationInput,
  BankVerificationResult,
  MandateInput,
  PaymentSplit,
  SplitSettlementState,
  VendorInput,
  VendorState,
  MandateResult,
  MandateState,
  PaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  PaymentStatusResult,
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
  readonly name = 'mock' as const;
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
        checkout: null,
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
        checkout: null,
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
      checkout: null,
      redirectUrl: null,
      failureCode: null,
      failureMessage: null,
      processedAt: new Date(),
    };
  }

  /** Mock intents settle as they are created, so anything asked about is settled. */
  async fetchIntent(): Promise<PaymentStatusResult> {
    return { status: 'SUCCEEDED', failureMessage: null, processedAt: new Date() };
  }

  /** Nothing is ever left open on the mock, so there is nothing to resume. */
  async resumeCheckout(): Promise<null> {
    return null;
  }

  /** Autopay needs no authorisation locally: the mandate is live at once. */
  async createMandate(input: MandateInput): Promise<MandateResult> {
    this.log.info(
      { reference: input.reference, amount: input.monthlyAmount },
      'Mock autopay mandate created',
    );
    return {
      reference: `MOCK-SUB-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: 'ACTIVE',
      providerStatus: 'ACTIVE',
      checkout: null,
    };
  }

  async fetchMandate(): Promise<MandateState> {
    return { status: 'ACTIVE', providerStatus: 'ACTIVE' };
  }

  async changeMandateAmount(): Promise<void> {}

  async cancelMandate(): Promise<void> {}

  /**
   * Penny validation, locally. An account number ending 0000 is refused, so the
   * failure path is reachable; anything else is valid in the holder's name.
   */
  async verifyBankAccount(input: BankVerificationInput): Promise<BankVerificationResult> {
    const invalid = input.accountNumber.endsWith('0000');
    return {
      status: invalid ? 'INVALID' : 'VALID',
      nameAtBank: invalid ? null : input.name.toUpperCase(),
      bankName: invalid ? null : 'MOCK BANK',
      reference: `MOCK-BAV-${randomUUID().slice(0, 8).toUpperCase()}`,
      reason: invalid ? 'The bank reported that this account does not exist.' : null,
    };
  }

  async createVendor(input: VendorInput): Promise<VendorState> {
    return { vendorId: input.vendorId, active: true, providerStatus: 'ACTIVE' };
  }

  async fetchVendor(vendorId: string): Promise<VendorState> {
    return { vendorId, active: true, providerStatus: 'ACTIVE' };
  }

  async splitAfterPayment(reference: string, splits: PaymentSplit[]): Promise<void> {
    this.log.info({ reference, splits: splits.length }, 'Mock split applied');
  }

  /** The mock pays vendors out as soon as they are split to. */
  async fetchSplitSettlement(_reference: string, vendorIds: string[]): Promise<SplitSettlementState> {
    return { settledVendorIds: vendorIds };
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
