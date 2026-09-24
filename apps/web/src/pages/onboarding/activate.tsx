import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BadgeCheck, CalendarClock, CreditCard, PackagePlus, RefreshCw } from 'lucide-react';
import { BILLING_GRACE_DAYS, DATA_PURGE_AFTER_DAYS, Permission, formatCurrency } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useCheckout, useCheckoutReturn } from '@/features/payments/use-checkout';
import type { BillingStatus } from '@/features/subscriptions/billing-card';
import {
  isAutopayAwaiting,
  isAutopayConfirmed,
  useBillingActions,
} from '@/features/subscriptions/use-billing-actions';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Activate the plan — the step a new paid account lands on straight after
 * registering.
 *
 * Two things, in order, both through Cashfree:
 *
 *   1. pay for any extra vehicles and trackers ordered at signup (a one-time
 *      payment, in Cashfree's popup);
 *   2. approve autopay for the plan. The plan itself is free for the trial;
 *      autopay takes the first monthly charge only when the trial ends.
 *
 * Either can be left for later — the account works during the trial — and both
 * stay available on the subscription screen.
 */

function inrDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function StepCard({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex gap-4 p-5">
        <span
          className={
            done
              ? 'flex size-8 shrink-0 items-center justify-center rounded-full bg-success/12 text-success'
              : 'flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary'
          }
          aria-hidden
        >
          {done ? <BadgeCheck className="size-4" /> : index}
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {done ? (
              <Badge variant="success" dot>
                Done
              </Badge>
            ) : null}
          </div>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

export function ActivatePlanPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = can(Permission.SUBSCRIPTION_MANAGE);

  const billing = useQuery({
    queryKey: ['subscription', 'billing'],
    queryFn: () => api.get<BillingStatus | null>('/subscriptions/billing'),
  });

  const refresh = React.useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['subscription'] });
    void queryClient.invalidateQueries({ queryKey: ['session'] });
  }, [queryClient]);

  const checkout = useCheckout(refresh);
  const actions = useBillingActions({ onCheckout: checkout.run, onChanged: refresh, returnTo: 'activation' });

  // Back from authorising autopay on Cashfree's page.
  const confirmAutopay = React.useCallback(async () => {
    const status = await api.post<BillingStatus | null>('/subscriptions/billing/autopay/refresh');
    if (status?.autopay?.status === 'ACTIVE') toast.success('Autopay is set up');
    else toast.info('Autopay is waiting for your bank to confirm');
    refresh();
  }, [refresh]);
  useCheckoutReturn({ onPayment: refresh, onSubscription: confirmAutopay });

  if (billing.isLoading) return <LoadingState label="Loading your plan…" />;
  if (billing.error) return <ErrorState error={billing.error} onRetry={() => void billing.refetch()} />;

  const status = billing.data;
  // Nothing to activate: a free account, or one with no plan to bill.
  if (!status || (!status.billable && status.pendingPayments.length === 0)) {
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <PageHeader title="You're all set" description="There is nothing to pay for on this account." />
        <Button onClick={() => navigate('/', { replace: true })}>Go to dashboard</Button>
      </div>
    );
  }

  const extrasDone = status.pendingPayments.length === 0;
  const autopayDone = isAutopayConfirmed(status.autopay);
  const autopayAwaiting = isAutopayAwaiting(status.autopay);
  const working =
    checkout.busy || actions.startAutopay.isPending || actions.resume.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        eyebrow="Welcome to Saarthi"
        title={
          status.trialDaysLeft !== null
            ? `Your ${status.trialDaysLeft}-day free trial has started`
            : 'Activate your plan'
        }
        description={`${status.planName} is ready to use - nothing is charged today. Set up autopay now and it carries on without a break when the trial ends, at ${formatCurrency(status.monthlyTotal)} a month.`}
      />

      {!extrasDone ? (
        <StepCard index={1} title="Pay for your extras" done={false}>
          {status.pendingPayments.map((pending) => (
            <div key={pending.reference} className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {[
                  pending.topUps > 0 ? `${pending.topUps} extra vehicle${pending.topUps === 1 ? '' : 's'}` : null,
                  pending.trackers > 0 ? `${pending.trackers} tracker${pending.trackers === 1 ? '' : 's'}` : null,
                ]
                  .filter(Boolean)
                  .join(' and ')}{' '}
                — paid once now, added the moment payment succeeds.
              </p>
              {canManage ? (
                <Button
                  onClick={() => actions.resume.mutate(pending.reference)}
                  disabled={working}
                  loading={actions.resume.isPending && actions.resume.variables === pending.reference}
                >
                  <PackagePlus className="size-4" aria-hidden />
                  Pay {formatCurrency(pending.amount)}
                </Button>
              ) : null}
            </div>
          ))}
        </StepCard>
      ) : null}

      {status.billable ? (
        <StepCard
          index={status.pendingPayments.length > 0 ? 2 : 1}
          title="Set up autopay"
          done={autopayDone}
        >
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
            {status.trialEndsAt
              ? `Nothing is charged today. Your first payment of ${formatCurrency(status.monthlyTotal)} is taken on ${inrDate(status.trialEndsAt)}, when the trial ends, and then every month. Cancel at any time.`
              : `${formatCurrency(status.monthlyTotal)} is charged every month. Cancel at any time.`}
          </p>
          {canManage && !autopayDone ? (
            <Button onClick={() => actions.startAutopay.mutate()} disabled={working} loading={actions.startAutopay.isPending}>
              <RefreshCw className="size-4" aria-hidden />
              {autopayAwaiting ? 'Complete autopay setup' : 'Set up autopay with Cashfree'}
            </Button>
          ) : null}
          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <CreditCard className="size-3.5" aria-hidden />
            Handled by Cashfree. Saarthi never sees your card, UPI or bank details.
          </p>
          {!autopayDone ? (
            <p className="text-2xs leading-relaxed text-muted-foreground">
              Optional - you can set it up later from Settings. An account that is not renewed when
              its trial ends is archived {BILLING_GRACE_DAYS} days later, and permanently deleted{' '}
              {DATA_PURGE_AFTER_DAYS} days after that.
            </p>
          ) : null}
        </StepCard>
      ) : null}

      {!canManage ? (
        <p className="text-sm text-muted-foreground">Ask the account owner to complete these steps.</p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {extrasDone && (autopayDone || !status.billable) ? (
          <Button onClick={() => navigate('/', { replace: true })}>Go to dashboard</Button>
        ) : (
          <Button variant="ghost" onClick={() => navigate('/', { replace: true })}>
            I'll do this later
          </Button>
        )}
      </div>
    </div>
  );
}

export default ActivatePlanPage;
