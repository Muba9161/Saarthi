import type { CheckoutSession } from '@saarthi/shared';

/**
 * Cashfree's browser SDK, loaded only when a payment is actually opened.
 *
 * The SDK takes a session id the API created — it never sees a key — and
 * shows Cashfree's own hosted checkout. What it reports back is a hint only:
 * the outcome is always confirmed with the API afterwards.
 */

const SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

interface CashfreeInstance {
  checkout(options: {
    paymentSessionId: string;
    redirectTarget: '_modal' | '_self';
  }): Promise<unknown>;
  subscriptionsCheckout(options: {
    subsSessionId: string;
    redirectTarget: '_self';
  }): Promise<unknown>;
}

declare global {
  interface Window {
    Cashfree?: (options: { mode: 'sandbox' | 'production' }) => CashfreeInstance;
  }
}

let sdk: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.Cashfree) return Promise.resolve();
  sdk ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdk = null;
      reject(new Error('The payment page could not be loaded. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return sdk;
}

async function cashfreeFor(mode: CheckoutSession['mode']): Promise<CashfreeInstance> {
  await loadSdk();
  if (!window.Cashfree) throw new Error('The payment page could not be loaded.');
  return window.Cashfree({ mode });
}

/**
 * Open a one-time payment in Cashfree's modal. Resolves when the modal closes —
 * paid, abandoned or failed; the caller confirms which with the API.
 *
 * Payments are often started from inside one of our dialogs, and a modal
 * dialog disables pointer events on the page body while it is open. Cashfree
 * mounts its checkout on that body, so without lifting that for the duration
 * the payment form could be seen but not used.
 */
export async function openPaymentCheckout(session: CheckoutSession): Promise<void> {
  const cashfree = await cashfreeFor(session.mode);
  const previous = document.body.style.pointerEvents;
  document.body.style.pointerEvents = 'auto';
  try {
    await cashfree.checkout({ paymentSessionId: session.sessionId, redirectTarget: '_modal' });
  } finally {
    document.body.style.pointerEvents = previous;
  }
}

/**
 * Authorise autopay. Cashfree takes over the page and returns the owner to the
 * subscription screen with `?subscription_id=…`, where it is confirmed.
 */
export async function openSubscriptionCheckout(session: CheckoutSession): Promise<void> {
  const cashfree = await cashfreeFor(session.mode);
  await cashfree.subscriptionsCheckout({ subsSessionId: session.sessionId, redirectTarget: '_self' });
}
