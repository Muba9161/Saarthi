/**
 * Payment provider contract.
 *
 * Saarthi never sees a card number, a UPI PIN or a bank credential. A payment
 * is an *intent* handed to a gateway, and what comes back is a reference and an
 * outcome — which is why swapping the mock for Razorpay or Stripe later cannot
 * turn the `payments` table into cardholder data.
 *
 * The interface is deliberately narrow. Anything a specific gateway needs
 * beyond this (redirect URLs, webhook signatures, three-D-Secure flows) belongs
 * inside its implementation, not in the shared contract.
 */

export interface PaymentIntentInput {
  /** Saarthi's own reference, echoed back for reconciliation. */
  reference: string;
  /** Minor-unit-free amount in INR. */
  amount: number;
  currency: string;
  description: string;
  /** Who is paying, for the gateway's own records. */
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  /** Opaque data returned unchanged by the gateway. */
  metadata: Record<string, string>;
}

export interface PaymentIntentResult {
  /** The gateway's identifier for this payment. */
  providerReference: string;
  status: 'SUCCEEDED' | 'PENDING' | 'FAILED';
  /** Where to send the payer, for gateways that need a hosted page. */
  redirectUrl: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  /** When the gateway considers the money settled. */
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

export interface PaymentProvider {
  readonly name: string;
  /**
   * True when this provider settles instantly and in-process. The booking flow
   * uses it to decide whether to wait for a webhook or move straight on, so a
   * local demo does not need a tunnel to a public callback URL.
   */
  readonly settlesSynchronously: boolean;
  createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}
