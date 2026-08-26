import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Banknote, CalendarClock, Wallet } from 'lucide-react';
import {
  Feature,
  InstallmentStatus,
  Permission,
  formatCurrency,
  humanizeEnum,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type {
  FleetLoanSummary,
  LoanListTotals,
  LoanSummary,
  Paginated,
  UpcomingEmiResult,
} from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import {
  InstallmentStatusBadge,
  LoanStatusBadge,
  MaskedValue,
  SourceBadge,
  formatDueDate,
  relativeDueLabel,
} from '@/features/loans/loan-formatting';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataView, type Column } from '@/components/common/data-view';
import { StatCard } from '@/components/common/stat-card';
import { FeatureLockedState, UnauthorizedState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Fleet finance.
 *
 * The screen is ordered by urgency rather than by record: what is overdue,
 * what falls due next, then the book of loans. An operator opens this page
 * because a payment is coming, not to browse their liabilities.
 */

type ScopeFilter = 'all' | 'overdue' | 'active';

interface LoanListResponse {
  items: LoanSummary[];
  pagination: Paginated<LoanSummary>['pagination'];
}

export function FleetLoansPage(): React.ReactElement {
  const { can, hasFeature } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = React.useState(1);
  const [scope, setScope] = React.useState<ScopeFilter>('all');

  const enabled = can(Permission.LOANS_READ) && hasFeature(Feature.FINANCE_LOANS);

  const summary = useQuery({
    queryKey: ['loans', 'summary'],
    queryFn: () => api.get<FleetLoanSummary>('/fleet/loans/summary'),
    enabled,
  });

  const upcoming = useQuery({
    queryKey: ['loans', 'upcoming'],
    queryFn: () => api.get<UpcomingEmiResult>('/fleet/loans/upcoming', { days: 30 }),
    enabled,
  });

  const loans = useQuery({
    queryKey: ['loans', 'list', page, scope],
    queryFn: () =>
      api.get<LoanListResponse>('/fleet/loans', {
        page,
        pageSize: 20,
        ...(scope === 'overdue' ? { overdueOnly: true } : {}),
        ...(scope === 'active' ? { status: 'ACTIVE' } : {}),
      }),
    enabled,
  });

  if (!can(Permission.LOANS_READ)) {
    return (
      <UnauthorizedState message="Vehicle finance is restricted to the fleet owner. Ask them for access if you need to work EMIs." />
    );
  }

  if (!hasFeature(Feature.FINANCE_LOANS)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Loans & EMI" />
        <FeatureLockedState feature="Loan & EMI tracking" requiredPlan="Basic" />
      </div>
    );
  }

  const totals = (loans.data as unknown as { totals?: LoanListTotals })?.totals;
  const stats = summary.data;

  const columns: Column<LoanSummary>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.registrationNumber}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.lenderName} · {humanizeEnum(row.loanType)}
          </p>
        </div>
      ),
    },
    {
      key: 'loanNumber',
      header: 'Loan number',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm">
          <MaskedValue value={row.loanNumber} masked={row.loanNumberMasked} />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <LoanStatusBadge status={row.status} />
          {row.overdueInstallments > 0 ? (
            <Badge variant="destructive" size="sm">
              {row.overdueInstallments} overdue
            </Badge>
          ) : null}
          <SourceBadge source={row.source} verificationStatus={row.verificationStatus} />
        </div>
      ),
    },
    {
      key: 'emi',
      header: 'EMI',
      numeric: true,
      cell: (row) => <span className="tabular-nums">{formatCurrency(row.emiAmount)}</span>,
    },
    {
      key: 'next',
      header: 'Next due',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm">{row.nextDueDate ? formatDueDate(row.nextDueDate) : '—'}</span>
      ),
    },
    {
      key: 'outstanding',
      header: 'Outstanding',
      numeric: true,
      cell: (row) => (
        <div className="text-right">
          <p className="tabular-nums">{formatCurrency(row.totalOutstanding)}</p>
          <Progress value={row.completionPercent} className="mt-1 h-1" />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Loans & EMI"
        description="What each financed vehicle owes, when the next installment falls due, and what has already been repaid."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Monthly obligation"
          value={formatCurrency(stats?.monthlyObligation ?? totals?.monthlyObligation ?? 0)}
          icon={Wallet}
          hint={`${stats?.activeLoans ?? 0} active loan${(stats?.activeLoans ?? 0) === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Due this month"
          value={formatCurrency(stats?.dueThisMonth ?? 0)}
          icon={CalendarClock}
          hint={
            stats?.nextDueDate ? `Next on ${formatDueDate(stats.nextDueDate)}` : 'Nothing scheduled'
          }
        />
        <StatCard
          label="Overdue"
          value={formatCurrency(stats?.overdueAmount ?? 0)}
          icon={AlertTriangle}
          tone={(stats?.overdueInstallments ?? 0) > 0 ? 'destructive' : 'default'}
          hint={`${stats?.overdueInstallments ?? 0} installment${(stats?.overdueInstallments ?? 0) === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Total outstanding"
          value={formatCurrency(stats?.totalOutstanding ?? 0)}
          icon={Banknote}
          hint={`${stats?.financedVehicles ?? 0} financed vehicle${(stats?.financedVehicles ?? 0) === 1 ? '' : 's'}`}
        />
      </div>

      {(stats?.unknownInstallments ?? 0) > 0 ? (
        <Card className="border-warning/40">
          <CardContent className="flex items-start gap-2 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {stats?.unknownInstallments} installment
                {stats?.unknownInstallments === 1 ? '' : 's'} could not be confirmed
              </span>{' '}
              as paid or unpaid, so {stats?.unknownInstallments === 1 ? 'it is' : 'they are'} left
              out of every figure above. The totals are therefore a floor, not a complete picture.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {(upcoming.data?.items.length ?? 0) > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <SectionHeader
              title="Next 30 days"
              description="Overdue first, then what falls due. Amounts are what remains on each installment."
            />
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {(upcoming.data?.items ?? []).slice(0, 8).map((emi) => (
              <Link
                key={emi.installmentId}
                to={`/fleet/loans/${emi.loanId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {emi.registrationNumber}
                    <span className="ml-2 font-normal text-muted-foreground">
                      #{emi.number} · {emi.lenderName}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDueDate(emi.dueDate)} · {relativeDueLabel(emi.daysUntilDue)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <InstallmentStatusBadge status={emi.status} />
                  <span className="text-sm font-semibold tabular-nums">
                    {formatCurrency(emi.outstanding)}
                  </span>
                </div>
              </Link>
            ))}
            {(upcoming.data?.items.length ?? 0) > 8 ? (
              <p className="pt-1 text-xs text-muted-foreground">
                and {(upcoming.data?.items.length ?? 0) - 8} more in the next 30 days.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={scope}
          onValueChange={(value) => {
            setScope(value as ScopeFilter);
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="overdue">Overdue</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button asChild variant="outline" size="sm">
          <Link to="/fleet/vehicles">Add a loan from a vehicle</Link>
        </Button>
      </div>

      <DataView
        surface="fleet.loans"
        columns={columns}
        rows={loans.data?.items}
        rowKey={(row) => row.id}
        isLoading={loans.isLoading}
        error={loans.error}
        onRetry={() => void loans.refetch()}
        onRowClick={(row) => navigate(`/fleet/loans/${row.id}`)}
        pagination={loans.data?.pagination}
        onPageChange={setPage}
        emptyTitle="No loans recorded"
        emptyDescription="Open a vehicle and add its loan to track EMIs and get reminders before each due date."
      />
    </div>
  );
}

export default FleetLoansPage;

export { InstallmentStatus };
