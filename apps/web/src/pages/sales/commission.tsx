import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Info, Lock } from 'lucide-react';
import { Permission, formatCurrency, formatDate, formatNumber, humanizeEnum } from '@saarthi/shared';
import type { Paginated } from '@/lib/api-types';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useSalesProfile } from '@/features/sales/use-sales-profile';
import { SalesStandingNotice } from '@/features/sales/standing-notice';
import type { CommissionTotals, CommissionView } from '@/features/sales/types';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatCard } from '@/components/common/stat-card';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * My commission.
 *
 * Read-only, and that is a rule rather than an omission: the salesperson's role
 * holds `commission.read` and not `commission.manage`, so the person a
 * commission is owed to cannot approve, reprice or pay it. Every figure was
 * computed server-side from a real payment and a rule an administrator
 * authored.
 *
 * The unpriced case is the interesting one. A sale that qualified while no
 * commission rule covered it has a **null** amount, not zero. It is shown as
 * "awaiting a rule" and excluded from every total, because folding it in as
 * zero would show somebody less than they are owed with nothing on the screen
 * to explain the difference.
 */
export function SalesCommissionPage(): React.ReactElement {
  const { can } = useAuth();
  const { profile, godWebVerificationAvailable } = useSalesProfile();
  const [page, setPage] = React.useState(1);

  const totals = useQuery({
    queryKey: ['/sales/commission/summary'],
    queryFn: () => api.get<CommissionTotals>('/sales/commission/summary'),
    enabled: can(Permission.COMMISSION_READ),
  });

  const rows = useQuery({
    queryKey: ['/sales/commission', page],
    queryFn: () =>
      api.get<Paginated<CommissionView>>('/sales/commission', { page, pageSize: 20 }),
    enabled: can(Permission.COMMISSION_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.COMMISSION_READ)) return <UnauthorizedState />;

  const summary = totals.data;

  const columns: Column<CommissionView>[] = [
    {
      key: 'customer',
      header: 'Customer',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.organizationName ?? 'Customer'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {humanizeEnum(row.trigger)}
            {row.planTier ? ` · ${humanizeEnum(row.planTier)}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Commission',
      numeric: true,
      cell: (row) =>
        row.commissionAmount === null ? (
          /*
           * Never rendered as ₹0. The figure genuinely does not exist yet, and
           * a zero would read as a settled debt of nothing.
           */
          <span className="text-sm text-muted-foreground">Awaiting a rule</span>
        ) : (
          <div className="text-right">
            <p className="tabular-nums text-sm font-semibold">
              {formatCurrency(row.commissionAmount, row.currency)}
            </p>
            {row.commissionRate !== null ? (
              <p className="text-xs text-muted-foreground">
                {row.commissionRate}% of {formatCurrency(row.baseAmount, row.currency)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                on {formatCurrency(row.baseAmount, row.currency)}
              </p>
            )}
          </div>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'eligible',
      header: 'Payable from',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.eligibleAt)}</span>
      ),
    },
    {
      key: 'paid',
      header: 'Paid',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.paidAt ? formatDate(row.paidAt) : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="My commission"
        description="Calculated by Saarthi from real payments. You cannot change these figures — and nor can anyone in the field."
      />

      <SalesStandingNotice
        profile={profile}
        godWebVerificationAvailable={godWebVerificationAvailable}
      />

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Pending"
            numericValue={summary.pending}
            format={(value) => formatCurrency(value, summary.currency)}
            tone="warning"
            hint="Inside the qualification period"
          />
          <StatCard
            label="Approved"
            numericValue={summary.approved}
            format={(value) => formatCurrency(value, summary.currency)}
            tone="accent"
            hint="Confirmed, awaiting payout"
          />
          <StatCard
            label="Paid"
            numericValue={summary.paid}
            format={(value) => formatCurrency(value, summary.currency)}
            tone="success"
          />
        </div>
      ) : null}

      {summary && summary.awaitingRule > 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            {formatNumber(summary.awaitingRule)}{' '}
            {summary.awaitingRule === 1 ? 'sale is' : 'sales are'} not in any total above, because
            no commission rule covered {summary.awaitingRule === 1 ? 'it' : 'them'} when the
            payment came in. Saarthi operations sets the rule and the amount is filled in
            automatically — nothing is lost in the meantime.
          </AlertDescription>
        </Alert>
      ) : null}

      {summary && summary.reversed > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            {formatCurrency(summary.reversed, summary.currency)} has been reversed — a sale that
            was refunded or cancelled inside its qualification period. The reason is on the row.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-3">
        <SectionHeader
          title="Every sale"
          description="One row per qualifying payment. A repeated payment event never pays twice."
        />
        <DataTable
          columns={columns}
          rows={rows.data?.items}
          rowKey={(row) => row.id}
          isLoading={rows.isLoading}
          error={rows.error}
          onRetry={() => void rows.refetch()}
          {...(rows.data?.pagination ? { pagination: rows.data.pagination } : {})}
          onPageChange={setPage}
          emptyTitle="No commission yet"
          emptyDescription="A commission appears here when a customer you brought to Saarthi actually pays."
        />
      </section>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Commission is calculated on the server from the payment Saarthi received and the rate
        Saarthi operations agreed. Nothing on this screen can be edited, by you or by anyone
        selling.
      </p>
    </div>
  );
}

export default SalesCommissionPage;
