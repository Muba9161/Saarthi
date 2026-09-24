/**
 * Payment provider contract.
 *
 * Saarthi never sees a card number, a UPI PIN or a bank credential. A payment
 * is an *intent* handed to a gateway, and what comes back is a reference and an
 * outcome — which is why swapping the mock for Cashfree cannot turn the
 * `payments` table into cardholder data.
 *
 * Two kinds of gateway sit behind it:
 *
 *   • one that settles in-process (the mock), where `createIntent` returns
 *     SUCCEEDED or FAILED and the caller finishes the job immediately;
 *   • one with a hosted checkout (Cashfree), where `createIntent` returns
 *     PENDING with a `checkout` session for the web app to open, and the
 *     outcome is confirmed later — by webhook, or by `fetchIntent` when the
 *     payer returns. Never from the browser's word alone.
 *
 * Anything gateway-specific (headers, signatures, status vocabularies) stays
 * inside the implementation.
 */

import type { CheckoutSession } from '@saarthi/shared';

export type { CheckoutSession };

export interface PaymentCustomer {
  /** A stable id for the payer at the gateway — the organization id. */
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface PaymentIntentInput {
  /** Saarthi's own reference, echoed back for reconciliation. */
  reference: string;
  /** Minor-unit-free amount in INR. */
  amount: number;
  currency: string;
  description: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  /** The payer's stable id at the gateway. Defaults to the organization in metadata. */
  customerId?: string;
  /** Web-app path the payer returns to after a hosted checkout. */
  returnPath?: string;
  /**
   * Route parts of this payment straight to marketplace vendors — a fleet, a
   * supplier. Whatever is not split stays with Saarthi.
   */
  splits?: PaymentSplit[];
  /** Opaque data returned unchanged by the gateway. */
  metadata: Record<string, string>;
}

export type PaymentOutcome = 'SUCCEEDED' | 'PENDING' | 'FAILED';

export interface PaymentIntentResult {
  /** The gateway's identifier for this payment. */
  providerReference: string;
  status: PaymentOutcome;
  /** Present when the payer must complete a hosted checkout. */
  checkout: CheckoutSession | null;
  /** Where to send the payer, for gateways that redirect instead. */
  redirectUrl: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  /** When the gateway considers the money settled. */
  processedAt: Date | null;
}

export interface PaymentStatusResult {
  status: PaymentOutcome;
  failureMessage: string | null;
  processedAt: Date | null;
}

export interface RefundInput {
  providerReference: string;
  /** Partial refunds are allowed; omit to refund in full. */
  amount: number;
  reason: string;
}

export interface RefundResult {
  providerReference: string;
  status: 'SUCCEEDED' | 'PENDING' | 'FAILED';
  refundedAmount: number;
  failureMessage: string | null;
  processedAt: Date | null;
}

/** A share of a payment routed to a marketplace vendor's bank account. */
export interface PaymentSplit {
  vendorId: string;
  amount: number;
}

export interface BankVerificationInput {
  accountNumber: string;
  ifsc: string;
  name: string;
  phone: string | null;
}

export interface BankVerificationResult {
  /** VALID once the penny reached the account; PENDING while the bank has not answered. */
  status: 'VALID' | 'INVALID' | 'PENDING';
  nameAtBank: string | null;
  bankName: string | null;
  reference: string | null;
  reason: string | null;
}

export interface VendorInput {
  vendorId: string;
  name: string;
  email: string;
  phone: string;
  accountNumber: string;
  accountHolder: string;
  ifsc: string;
  pan: string;
}

/** A vendor's standing at the payment provider. ACTIVE is the only one that can be paid. */
export interface VendorState {
  vendorId: string;
  active: boolean;
  providerStatus: string;
}

export interface SplitSettlementState {
  /** Vendors whose share of this payment has been paid out to their bank. */
  settledVendorIds: string[];
}

/** An autopay mandate's state, in Saarthi's own vocabulary. */
export type MandateStatus = 'ACTIVE' | 'PENDING' | 'ON_HOLD' | 'CANCELLED' | 'FAILED';

export interface MandateInput {
  /** Saarthi's reference for the mandate. */
  reference: string;
  /** What each monthly charge takes, GST included. */
  monthlyAmount: number;
  /** When the first charge is taken — the end of the free trial. */
  firstChargeAt: Date;
  customer: PaymentCustomer;
  returnPath: string;
}

export interface MandateResult {
  reference: string;
  status: MandateStatus;
  /** The provider's own status word, stored verbatim for support. */
  providerStatus: string;
  checkout: CheckoutSession | null;
}

export interface MandateState {
  status: MandateStatus;
  providerStatus: string;
}

export interface PaymentProvider {
  readonly name: 'mock' | 'cashfree';
  /**
   * True when this provider settles instantly and in-process, so a caller can
   * finish the job straight away rather than wait for confirmation.
   */
  readonly settlesSynchronously: boolean;
  createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult>;
  /** The authoritative outcome of an intent, asked of the gateway itself. */
  fetchIntent(reference: string): Promise<PaymentStatusResult>;
  /** A fresh checkout for an intent that can still be paid, or null if it cannot. */
  resumeCheckout(reference: string): Promise<CheckoutSession | null>;
  refund(input: RefundInput): Promise<RefundResult>;

  /** Set up monthly autopay, with the first charge deferred to `firstChargeAt`. */
  createMandate(input: MandateInput): Promise<MandateResult>;
  fetchMandate(reference: string): Promise<MandateState>;
  /** Point an existing mandate at a new monthly amount. */
  changeMandateAmount(reference: string, monthlyAmount: number): Promise<void>;
  cancelMandate(reference: string): Promise<void>;

  /** Penny validation: prove a bank account exists and belongs to the named holder. */
  verifyBankAccount(input: BankVerificationInput): Promise<BankVerificationResult>;
  /** Create (or recreate) the vendor record payments are routed to. */
  createVendor(input: VendorInput): Promise<VendorState>;
  fetchVendor(vendorId: string): Promise<VendorState>;
  /** Split a payment already taken — for amounts only known after payment. */
  splitAfterPayment(reference: string, splits: PaymentSplit[]): Promise<void>;
  /** Which of these vendors have been paid out their share of this payment. */
  fetchSplitSettlement(reference: string, vendorIds: string[]): Promise<SplitSettlementState>;
}
