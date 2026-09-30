import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import {
  Permission,
  VERIFICATION_CHECK_LABELS,
  VerificationSubjectType,
  formatCurrency,
  formatDate,
  stepStateForCharge,
  type VerificationChargeView,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { DataTable, type Column } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { StepStateBadge } from './verification-step-panel';
import { isStepFor, useVerificationCenterView, type VerificationStepTarget } from './verification-wizard';

/**
 * Verification history — what was checked, how it ended, when, and what was
 * paid. The customer's view only: what a check cost Saarthi is internal and
 * never reaches this endpoint.
 *
 * An attempt whose fee was kept offers its free retry from here. The retry
 * itself is the step's own form (the number has to be entered again, since it
 * is not kept once a check has run), so the button only takes the customer to
 * it: on this page when the step is here, or to the driver's page when the
 * fleet paid for one of its drivers.
 */

const baseColumns: Column<VerificationChargeView>[] = [
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

export function VerificationHistory({
  onRetry,
}: {
  /** Opens the step for a kept fee that is on this page. */
  onRetry?: (target: VerificationStepTarget) => void;
}) {
  const { can } = useAuth();
  const history = useQuery({
    queryKey: ['verification-center', 'history'],
    queryFn: () => api.get<VerificationChargeView[]>('/verification-center/history'),
  });
  // Shares the wizard's cached view, so this costs no extra request.
  const view = useVerificationCenterView();
  const steps = view.data?.steps ?? [];
  const canOpenDrivers = can(Permission.DRIVERS_READ);

  const retryAction = (row: VerificationChargeView) => {
    if (!row.freeRetryAvailable) return null;
    const label = `Retry ${VERIFICATION_CHECK_LABELS[row.checkType]} verification free`;

    if (onRetry && steps.some((step) => isStepFor(step, row))) {
      return (
        <Button type="button" size="sm" variant="outline" aria-label={label} onClick={() => onRetry(row)}>
          <RotateCcw className="size-4" />
          Retry
        </Button>
      );
    }
    if (row.subjectType === VerificationSubjectType.DRIVER && canOpenDrivers) {
      return (
        <Button asChild size="sm" variant="outline">
          <Link to={`/fleet/drivers/${row.subjectId}?tab=documents`} aria-label={label}>
            <RotateCcw className="size-4" />
            Retry
          </Link>
        </Button>
      );
    }
    return null;
  };

  const hasRetry = (history.data ?? []).some((row) => row.freeRetryAvailable);
  const columns: Column<VerificationChargeView>[] = hasRetry
    ? [...baseColumns, { key: 'action', header: '', className: 'text-right', cell: retryAction }]
    : baseColumns;

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
