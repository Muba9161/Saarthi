import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CheckoutSession } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';

interface CheckoutResponse {
  checkout: CheckoutSession | null;
}

/** Where Cashfree returns the owner after authorising autopay. */
export type AutopayReturnTo = 'subscription' | 'activation';

/**
 * The plan's billing actions — autopay, paying for a month, paying for extras
 * still waiting — shared by the subscription screen and the activation step a
 * new account sees after registering. Each hands the API's checkout to
 * `onCheckout`, which opens Cashfree and confirms the outcome.
 */
export function useBillingActions({
  onCheckout,
  onChanged,
  returnTo = 'subscription',
}: {
  onCheckout: (checkout: CheckoutSession | null, successMessage: string) => Promise<void>;
  onChanged: () => void;
  returnTo?: AutopayReturnTo;
}) {
  const startAutopay = useMutation({
    mutationFn: () => api.post<CheckoutResponse>('/subscriptions/billing/autopay', { returnTo }),
    onSuccess: (result) =>
      onCheckout(result.checkout, 'Autopay is set up. The first charge is taken when your trial ends.'),
    onError: (error) => toast.error('Could not set up autopay', { description: errorMessage(error) }),
  });

  const payNow = useMutation({
    mutationFn: () => api.post<CheckoutResponse>('/subscriptions/billing/pay'),
    onSuccess: (result) => onCheckout(result.checkout, 'Payment received - your plan is paid for the month.'),
    onError: (error) => toast.error('Could not start the payment', { description: errorMessage(error) }),
  });

  const cancelAutopay = useMutation({
    mutationFn: () => api.post('/subscriptions/billing/autopay/cancel'),
    onSuccess: () => {
      toast.success('Autopay cancelled', { description: 'Pay each month from this screen instead.' });
      onChanged();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resume = useMutation({
    mutationFn: (reference: string) =>
      api.post<CheckoutResponse>(`/subscriptions/billing/pending/${encodeURIComponent(reference)}/checkout`),
    onSuccess: (result) => onCheckout(result.checkout, 'Payment received - your order is on the account.'),
    onError: (error) => toast.error('Could not open the payment', { description: errorMessage(error) }),
  });

  return { startAutopay, payNow, cancelAutopay, resume };
}

/** Autopay counts as set up while it is live or awaiting the bank's confirmation. */
export function isAutopayLive(autopay: { status: string } | null): boolean {
  return autopay !== null && ['ACTIVE', 'PENDING', 'ON_HOLD'].includes(autopay.status);
}

/** Authorised and in force — the only state in which nothing is left to do. */
export function isAutopayConfirmed(autopay: { status: string } | null): boolean {
  return autopay !== null && ['ACTIVE', 'ON_HOLD'].includes(autopay.status);
}

/**
 * Started but not confirmed: the owner left Cashfree's page before approving,
 * or approved and the bank has not answered yet. "Complete autopay setup"
 * asks the server, which reopens the approval or keeps waiting as appropriate.
 */
export function isAutopayAwaiting(autopay: { status: string } | null): boolean {
  return autopay?.status === 'PENDING';
}
