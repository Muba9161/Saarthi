import * as React from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate, formatPercent, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { Paginated } from '@/lib/api-types';
import { SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { MarketplaceCommissionView } from './types';

const COLUMNS: Column<MarketplaceCommissionView>[] = [
  {
    key: 'source',
    header: 'Transaction',
    cell: (row) => {
      const to = row.orderId ? `/orders/${row.orderId}` : row.bookingId ? `/travel/bookings/${row.bookingId}` : null;
      const label = humanizeEnum(row.kind);
      return (
        <div className="min-w-0">
          {to ? (
            <Link to={to} className="font-medium hover:underline">
              {label}
            </Link>
          ) : (
            <p className="font-medium">{label}</p>
          )}
          <p className="text-xs text-muted-foreground">{formatDate(row.calculatedAt)}</p>
        </div>
      );
    },
  },
  {
    key: 'profit',
    header: 'Profit',
    numeric: true,
    cell: (row) => (
      <div className="text-right">
        <p className="tabular-nums text-sm">{formatCurrency(row.profitBasis)}</p>
        <p className="text-xs text-muted-foreground">
          {formatCurrency(row.revenue)} − {formatCurrency(row.costBasis)}
        </p>
      </div>
    ),
  },
  {
    key: 'amount',
    header: 'Commission',
    numeric: true,
    cell: (row) => (
      <div className="text-right">
        <p className="tabular-nums text-sm font-semibold">{formatCurrency(row.amount)}</p>
        <p className="text-xs text-muted-foreground">{formatPercent(row.rate * 100)} of profit</p>
      </div>
    ),
  },
  { key: 'status', header: 'Status', hideOnMobile: true, cell: (row) => <StatusBadge status={row.status} /> },
];

/** Saarthi's commission on each of this business's settled transactions. */
export function CommissionHistory() {
  const [page, setPage] = React.useState(1);
  const commissions = useQuery({
    queryKey: ['finance', 'commissions', page],
    queryFn: () => api.get<Paginated<MarketplaceCommissionView>>('/finance/commissions', { page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionHeader
          title="Saarthi commission"
          description="2% of your profit on each completed order or trip — never of the customer's payment, and nothing on a loss."
        />
      </CardHeader>
      <CardContent className="pt-0">
        <DataTable
          columns={COLUMNS}
          rows={commissions.data?.items}
          rowKey={(row) => row.id}
          isLoading={commissions.isLoading}
          error={commissions.error}
          onRetry={() => void commissions.refetch()}
          {...(commissions.data?.pagination ? { pagination: commissions.data.pagination } : {})}
          onPageChange={setPage}
          emptyTitle="No commission yet"
          emptyDescription="Commission is worked out when a marketplace order or trip is finalized."
        />
      </CardContent>
    </Card>
  );
}
