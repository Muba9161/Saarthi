/**
 * A hosted-checkout session, as the API hands it to the web app.
 *
 * Carries only what the gateway's browser SDK needs to open its own checkout —
 * never a key or a secret. Absent (`null`) when the payment settled in-process.
 */
export interface CheckoutSession {
  provider: 'cashfree';
  mode: 'sandbox' | 'production';
  /** `payment` is a one-time checkout; `subscription` authorises autopay. */
  kind: 'payment' | 'subscription';
  sessionId: string;
  /** Saarthi's reference, to confirm the outcome with once the payer is back. */
  reference: string;
}
