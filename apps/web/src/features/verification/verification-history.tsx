import { useQuery } from '@tanstack/react-query';
import {
  VERIFICATION_CHECK_LABELS,
  formatCurrency,
  formatDate,
  stepStateForCharge,
  type VerificationChargeView,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { DataTable, type Column } from '@/components/common/data-table';
import { StepStateBadge } from './verification-step-panel';

/**
 * Verification history — what was checked, how it ended, when, and what was
 * paid. The customer's view only: what a check cost Saarthi is internal and
 * never reaches this endpoint.
 */

const columns: Column<VerificationChargeView>[] = [
  {
    key: 'type',
    header: 'Verification',
    cell: (row) => (
      <div className="min-w-0">
        <p className="font-medium">{VERIFICATION_CHECK_LABELS[row.checkType]}</p>
        {row.maskedNumber ? (
          <p className="truncate font-mono text-xs text-muted-foreground">{row.maskedNumber}</p>
        ) : null}
      </div>
    ),
  },
  { key: 'status', header: 'Status', cell: (row) => <StepStateBadge state={stepStateForCharge(row.status)} /> },
  {
    key: 'date',
    header: 'Date',
    cell: (row) => <span className="text-sm text-muted-foreground">{formatDate(row.completedAt ?? row.createdAt)}</span>,
  },
  {
    key: 'amount',
    header: 'Amount paid',
    numeric: true,
    cell: (row) => (row.paidAt ? formatCurrency(row.amount, row.currency) : '—'),
  },
];

export function VerificationHistory() {
  const history = useQuery({
    queryKey: ['verification-center', 'history'],
    queryFn: () => api.get<VerificationChargeView[]>('/verification-center/history'),
  });

  return (
    <DataTable
      columns={columns}
      rows={history.data}
      rowKey={(row) => row.id}
      isLoading={history.isLoading}
      error={history.error}
      onRetry={() => void history.refetch()}
      emptyTitle="No paid verifications yet"
      emptyDescription="Checks you pay for appear here with their outcome and amount."
    />
  );
}
