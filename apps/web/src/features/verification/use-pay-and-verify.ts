import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  VerificationChargeStatus,
  formatCurrency,
  isTerminalChargeStatus,
  stepStateForCharge,
  type StartVerificationResult,
  type VerificationChargeView,
  type VerificationCheckType,
  type VerificationPriceView,
  type VerificationStepState,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { openPaymentCheckout } from '@/features/payments/cashfree';
import { confirmPayment } from '@/features/payments/use-checkout';

/**
 * Pay & Verify, from the browser's side.
 *
 * The browser never decides anything here. It asks the API to start the check,
 * opens the Cashfree checkout the API hands back (the existing Saarthi payment
 * flow), asks the API to confirm the payment with the gateway, and then reads
 * the charge back until the server reports where it ended. The `state` this
 * resolves with is always the server's persisted one — which is what lets a
 * caller celebrate a VERIFIED without ever celebrating a mere HTTP 200.
 */

export interface PayAndVerifyOutcome {
  mode: StartVerificationResult['mode'];
  state: VerificationStepState;
  charge: VerificationChargeView | null;
  message: string | null;
  /** The owning module's own answer, when the check ran within the request. */
  detail: unknown;
}

const POLL_INTERVAL_MS = 1_500;
const POLL_LIMIT_MS = 30_000;

/** Read a charge until it stops moving, or until the wait is up. */
async function settledCharge(chargeId: string): Promise<VerificationChargeView> {
  const deadline = Date.now() + POLL_LIMIT_MS;
  let charge = await api.get<VerificationChargeView>(`/verification-center/charges/${chargeId}`);
  while (!isTerminalChargeStatus(charge.status) && Date.now() < deadline) {
    // A checkout closed without paying stays PAYMENT_PROCESSING: nothing to wait for.
    if (charge.status === VerificationChargeStatus.PAYMENT_PROCESSING) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    charge = await api.get<VerificationChargeView>(`/verification-center/charges/${chargeId}`);
  }
  return charge;
}

/** Every surface a verification outcome can change. */
const AFFECTED_QUERIES = [
  ['verification-center'],
  ['documents'],
  ['identity'],
  ['verification'],
  ['driver'],
  ['drivers'],
  ['organization'],
  ['profile'],
  ['vehicle-lookup'],
  ['licence-lookup'],
];

export function usePayAndVerify() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback(
    async (body: Record<string, unknown>): Promise<PayAndVerifyOutcome> => {
      setBusy(true);
      try {
        const result = await api.post<StartVerificationResult>('/verification-center/checks', body);
        let charge = result.charge;

        if (result.mode === 'CHECKOUT' && result.checkout && charge) {
          await openPaymentCheckout(result.checkout);
          // A webhook may be settling the same payment; either one runs the check.
          await confirmPayment(result.checkout.reference).catch(() => undefined);
          charge = await settledCharge(charge.id);
        } else if (charge && !isTerminalChargeStatus(charge.status)) {
          charge = await settledCharge(charge.id);
        }

        // A paid attempt is read from its charge; anything answered for free
        // carries its state on the reply.
        const paid = result.mode === 'COMPLETED' || result.mode === 'CHECKOUT';
        return {
          mode: result.mode,
          state: paid && charge ? stepStateForCharge(charge.status) : result.state,
          charge,
          message: charge?.reason ?? result.message,
          detail: result.detail,
        };
      } finally {
        setBusy(false);
        for (const key of AFFECTED_QUERIES) void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    [queryClient],
  );

  return { run, busy };
}

/** Customer-facing prices. Provider cost never reaches the browser. */
export function useVerificationPrices() {
  return useQuery({
    queryKey: ['verification-center', 'prices'],
    queryFn: () => api.get<VerificationPriceView[]>('/verification-center/prices'),
    staleTime: 5 * 60_000,
  });
}

export function usePriceFor(checkType: VerificationCheckType | null | undefined): VerificationPriceView | null {
  const prices = useVerificationPrices();
  if (!checkType) return null;
  return prices.data?.find((price) => price.checkType === checkType) ?? null;
}

export function formatFee(price: VerificationPriceView | null): string {
  return price ? formatCurrency(price.amount, price.currency) : '';
}

/** "Pay ₹10 & Verify", or plain "Verify" while the price is loading. */
export function payLabel(price: VerificationPriceView | null): string {
  return price ? `Pay ${formatFee(price)} & Verify` : 'Pay & Verify';
}
