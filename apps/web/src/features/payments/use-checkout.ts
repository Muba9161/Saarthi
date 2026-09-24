import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { CheckoutSession, PaymentStatus } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { openPaymentCheckout, openSubscriptionCheckout } from './cashfree';

interface PaymentState {
  reference: string;
  status: PaymentStatus;
}

/** Ask the API — which asks the gateway — how a payment actually ended. */
export function confirmPayment(reference: string): Promise<PaymentState> {
  return api.post<PaymentState>(`/payments/${encodeURIComponent(reference)}/confirm`);
}

/**
 * Pay a one-time checkout and report how it ended, from the gateway's records.
 *
 * `null` means the payment already settled in-process (the mock gateway).
 * For flows that must act on the outcome — add the vehicle only once its slot
 * is paid for — rather than just announce it.
 */
export async function payAndConfirm(checkout: CheckoutSession | null): Promise<PaymentStatus> {
  if (!checkout) return 'SUCCEEDED';
  await openPaymentCheckout(checkout);
  return (await confirmPayment(checkout.reference)).status;
}

function announce(status: PaymentStatus, successMessage: string): void {
  if (status === 'SUCCEEDED') toast.success(successMessage);
  else if (status === 'FAILED') toast.error('The payment did not go through. Nothing was charged.');
  else toast.info('Payment not completed yet', { description: 'You can finish it at any time.' });
}

/**
 * Run a checkout the API handed back, then settle it with the API.
 *
 * `null` means the payment already settled in-process (the mock gateway), so
 * there is nothing to open. `onSettled` runs once the outcome is known, to
 * refresh whatever the payment changed.
 */
export function useCheckout(onSettled: () => void) {
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback(
    async (checkout: CheckoutSession | null, successMessage: string): Promise<void> => {
      if (!checkout) {
        onSettled();
        return;
      }
      setBusy(true);
      try {
        if (checkout.kind === 'subscription') {
          // Leaves the page; `useCheckoutReturn` picks up on the way back.
          await openSubscriptionCheckout(checkout);
          return;
        }
        await openPaymentCheckout(checkout);
        const result = await confirmPayment(checkout.reference);
        announce(result.status, successMessage);
      } catch (error) {
        toast.error('Payment could not be completed', { description: errorMessage(error) });
      } finally {
        setBusy(false);
        onSettled();
      }
    },
    [onSettled],
  );

  return { run, busy };
}

/**
 * Finish what a redirect started. Cashfree returns the payer with
 * `?order_id=…` (a payment) or `?subscription_id=…` (autopay); either is
 * confirmed with the API once, then removed from the address bar.
 */
export function useCheckoutReturn(options: {
  onPayment?: (state: PaymentState) => void;
  onSubscription?: () => Promise<void> | void;
}): void {
  const [params, setParams] = useSearchParams();
  const orderId = params.get('order_id');
  const subscriptionId = params.get('subscription_id');
  const handled = React.useRef(false);
  const { onPayment, onSubscription } = options;

  React.useEffect(() => {
    if (handled.current || (!orderId && !subscriptionId)) return;
    handled.current = true;

    const clear = () =>
      setParams(
        (current) => {
          current.delete('order_id');
          current.delete('subscription_id');
          return current;
        },
        { replace: true },
      );

    void (async () => {
      try {
        if (orderId) {
          const state = await confirmPayment(orderId);
          announce(state.status, 'Payment received');
          onPayment?.(state);
        } else if (subscriptionId) {
          await onSubscription?.();
        }
      } catch (error) {
        toast.error('Could not confirm the payment', { description: errorMessage(error) });
      } finally {
        clear();
      }
    })();
  }, [orderId, subscriptionId, onPayment, onSubscription, setParams]);
}
