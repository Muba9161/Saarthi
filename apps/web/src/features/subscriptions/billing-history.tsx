import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CircleDot, CreditCard, ReceiptText } from 'lucide-react';
import {
  BILLING_HISTORY_CATEGORY_LABELS,
  BillingHistoryCategory,
  formatCurrency,
  type BillingHistoryEntry,
  type BillingHistoryView,
  type BillingPaymentStatus,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { SectionHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Payment history — every payment to Saarthi and every plan event, newest
 * first, with what happens next at the top. The server builds it from the
 * payment records and the audit trail; this only lays it out.
 */

type Filter = 'ALL' | BillingHistoryCategory;

const FILTERS: Filter[] = ['ALL', ...Object.values(BillingHistoryCategory)];

const STATUS_BADGE: Record<BillingPaymentStatus, { label: string; variant: 'success' | 'destructive' | 'warning' | 'muted' }> = {
  PAID: { label: 'Paid', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  PENDING: { label: 'Pending', variant: 'warning' },
  REFUNDED: { label: 'Refunded', variant: 'muted' },
};

function when(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function time(value: string): string {
  return new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function EntryRow({ entry, last }: { entry: BillingHistoryEntry; last: boolean }) {
  const isPayment = entry.kind === 'PAYMENT';
  const Icon = isPayment ? CreditCard : CircleDot;
  const badge = entry.status ? STATUS_BADGE[entry.status] : null;

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* The timeline's spine, running down to the next entry. */}
      {!last ? <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-border" /> : null}
      <span
        aria-hidden
        className={cn(
          'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border',
          isPayment ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground',
          entry.status === 'FAILED' && 'border-destructive/30 bg-destructive/10 text-destructive',
        )}
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <p className="text-sm font-medium">{entry.title}</p>
            <p className="text-2xs text-muted-foreground">
              {when(entry.at)} · {time(entry.at)} · {BILLING_HISTORY_CATEGORY_LABELS[entry.category]}
            </p>
          </div>
          {entry.amount !== null || badge ? (
            <div className="flex items-center gap-2">
              {entry.amount !== null ? (
                <span className={cn('text-sm font-semibold tabular-nums', entry.status === 'FAILED' && 'text-muted-foreground line-through')}>
                  {formatCurrency(entry.amount)}
                </span>
              ) : null}
              {badge ? (
                <Badge size="sm" variant={badge.variant}>
                  {badge.label}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
        {entry.detail ? <p className="mt-1 text-xs text-muted-foreground">{entry.detail}</p> : null}
        {entry.reference ? (
          <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground/80">Ref {entry.reference}</p>
        ) : null}
      </div>
    </li>
  );
}

export function BillingHistory({ enabled }: { enabled: boolean }) {
  const [filter, setFilter] = React.useState<Filter>('ALL');
  const history = useQuery({
    queryKey: ['subscription', 'billing', 'history'],
    queryFn: () => api.get<BillingHistoryView>('/subscriptions/billing/history'),
    enabled,
  });

  const entries = (history.data?.entries ?? []).filter((entry) => filter === 'ALL' || entry.category === filter);
  const upcoming = history.data?.upcoming ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionHeader
          title="Payment history"
          description="Every payment to Saarthi and every change to your plan, newest first."
        />
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        {upcoming.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Coming up</p>
            {upcoming.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/[0.04] p-3"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {entry.title} · {when(entry.at)}
                    </p>
                    {entry.detail ? <p className="text-xs text-muted-foreground">{entry.detail}</p> : null}
                  </div>
                </div>
                {entry.amount !== null ? (
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(entry.amount)}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div role="tablist" aria-label="Filter payment history" className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={filter === option}
              onClick={() => setFilter(option)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === option
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {option === 'ALL' ? 'All' : BILLING_HISTORY_CATEGORY_LABELS[option]}
            </button>
          ))}
        </div>

        {history.isLoading ? (
          <LoadingState label="Loading your payment history…" className="min-h-24" />
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="Nothing here yet"
            description={filter === 'ALL' ? 'Payments and plan changes appear here.' : 'Nothing in this category yet.'}
            className="min-h-32"
          />
        ) : (
          <ol aria-label="Payment history">
            {entries.map((entry, index) => (
              <EntryRow key={entry.id} entry={entry} last={index === entries.length - 1} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
