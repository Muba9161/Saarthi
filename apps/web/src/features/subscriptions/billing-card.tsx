import { CalendarClock, CreditCard, RefreshCw, X } from 'lucide-react';
import { formatCurrency, humanizeEnum, type CheckoutSession } from '@saarthi/shared';
import { SectionHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { isAutopayAwaiting, isAutopayLive, useBillingActions } from './use-billing-actions';

/** `GET /subscriptions/billing`. */
export interface BillingStatus {
  provider: 'mock' | 'cashfree';
  tier: string;
  planName: string;
  status: string;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  periodEndsAt: string | null;
  monthlyTotal: number;
  autopay: { provider: string; status: string; reference: string } | null;
  billable: boolean;
  pendingPayments: {
    reference: string;
    amount: number;
    createdAt: string;
    topUps: number;
    trackers: number;
  }[];
}

function inrDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The plan's billing: the free trial, autopay, and anything waiting to be paid.
 *
 * Kept apart from the plan card because it answers a different question —
 * "will I be charged, and when" rather than "what am I on".
 */
export function BillingCard({
  billing,
  canManage,
  onCheckout,
  busy,
  onChanged,
}: {
  billing: BillingStatus;
  canManage: boolean;
  /** Runs the checkout the API handed back, then refreshes. */
  onCheckout: (checkout: CheckoutSession | null, successMessage: string) => Promise<void>;
  busy: boolean;
  onChanged: () => void;
}) {
  const { startAutopay, payNow, cancelAutopay, resume } = useBillingActions({ onCheckout, onChanged });

  if (!billing.billable && billing.pendingPayments.length === 0) return null;

  const trialing = billing.trialDaysLeft !== null;
  const lapsed = billing.status === 'EXPIRED' || billing.status === 'CANCELLED';
  const autopayLive = isAutopayLive(billing.autopay);
  const autopayAwaiting = isAutopayAwaiting(billing.autopay);
  const working = busy || startAutopay.isPending || payNow.isPending || resume.isPending;

  return (
    <Card className={cn(lapsed && 'border-warning/50', billing.status === 'PAST_DUE' && 'border-warning/50')}>
      <CardHeader className="pb-3">
        <SectionHeader
          title="Billing"
          description={
            billing.provider === 'cashfree'
              ? 'Payments are processed by Cashfree. Saarthi never sees your card or UPI details.'
              : 'This environment uses the mock gateway - no real money moves.'
          }
        />
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {billing.billable ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
                {trialing
                  ? `Free trial - ${billing.trialDaysLeft} day${billing.trialDaysLeft === 1 ? '' : 's'} left`
                  : lapsed
                    ? 'Not paid for'
                    : billing.status === 'PAST_DUE'
                      ? 'Payment overdue'
                      : 'Paid'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {trialing && billing.trialEndsAt
                  ? `Your trial ends on ${inrDate(billing.trialEndsAt)}. Then ${formatCurrency(billing.monthlyTotal)} a month.`
                  : lapsed
                    ? `Pay ${formatCurrency(billing.monthlyTotal)} to carry on. Nothing on your account was deleted.`
                    : billing.periodEndsAt
                      ? `Paid until ${inrDate(billing.periodEndsAt)} · ${formatCurrency(billing.monthlyTotal)} a month.`
                      : `${formatCurrency(billing.monthlyTotal)} a month.`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Autopay:{' '}
                {billing.autopay ? (
                  <Badge
                    size="sm"
                    variant={billing.autopay.status === 'ACTIVE' ? 'success' : autopayLive ? 'warning' : 'outline'}
                  >
                    {autopayAwaiting ? 'Waiting for approval' : humanizeEnum(billing.autopay.status)}
                  </Badge>
                ) : (
                  'not set up'
                )}
              </p>
            </div>

            {canManage ? (
              <div className="flex flex-wrap gap-2">
                {!lapsed && (!autopayLive || autopayAwaiting) ? (
                  <Button onClick={() => startAutopay.mutate()} disabled={working} loading={startAutopay.isPending}>
                    <RefreshCw className="mr-1 size-4" aria-hidden />
                    {autopayAwaiting ? 'Complete autopay setup' : 'Set up autopay'}
                  </Button>
                ) : null}
                {lapsed || billing.status === 'PAST_DUE' || (!autopayLive && !trialing) ? (
                  <Button
                    variant={lapsed ? 'default' : 'outline'}
                    onClick={() => payNow.mutate()}
                    disabled={working}
                    loading={payNow.isPending}
                  >
                    <CreditCard className="mr-1 size-4" aria-hidden />
                    Pay {formatCurrency(billing.monthlyTotal)} now
                  </Button>
                ) : null}
                {autopayLive ? (
                  <Button
                    variant="ghost"
                    onClick={() => cancelAutopay.mutate()}
                    disabled={cancelAutopay.isPending}
                  >
                    <X className="mr-1 size-4" aria-hidden />
                    Cancel autopay
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {billing.pendingPayments.length > 0 ? (
          <>
            {billing.billable ? <Separator /> : null}
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Waiting for payment</p>
              {billing.pendingPayments.map((pending) => (
                <div
                  key={pending.reference}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p>
                      {[
                        pending.topUps > 0 ? `${pending.topUps} extra vehicle${pending.topUps === 1 ? '' : 's'}` : null,
                        pending.trackers > 0 ? `${pending.trackers} tracker${pending.trackers === 1 ? '' : 's'}` : null,
                      ]
                        .filter(Boolean)
                        .join(' and ')}
                      {' · '}
                      <span className="tabular-nums">{formatCurrency(pending.amount)}</span>
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      Ordered {inrDate(pending.createdAt)} - added once paid.
                    </p>
                  </div>
                  {canManage ? (
                    <Button
                      size="sm"
                      onClick={() => resume.mutate(pending.reference)}
                      disabled={working}
                      loading={resume.isPending && resume.variables === pending.reference}
                    >
                      Pay now
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
