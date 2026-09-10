import * as React from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Permission, formatDate, humanizeEnum } from '@saarthi/shared';
import type { Paginated } from '@/lib/api-types';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useSalesProfile } from '@/features/sales/use-sales-profile';
import { SalesStandingNotice } from '@/features/sales/standing-notice';
import type { SalesCustomerView } from '@/features/sales/types';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * My customers.
 *
 * Deliberately thin, and the thinness is the access-control decision rather
 * than an unfinished screen. It answers "did the sale land, and is the customer
 * actually using it" — a name, a subscription state, how many vehicles, how
 * many are live. It carries no driver names, no positions, no trips, no
 * documents and no contact details beyond what the salesperson recorded on
 * their own lead.
 *
 * That is why the SALESMAN role holds none of the fleet read permissions: a
 * salesperson who closed a deal last quarter has no business watching that
 * customer's vehicles move, and if this screen needed those grants to work, the
 * grants would be the leak.
 */
export function SalesCustomersPage(): React.ReactElement {
  const { can } = useAuth();
  const { profile, godWebVerificationAvailable } = useSalesProfile();
  const [page, setPage] = React.useState(1);

  const customers = useQuery({
    queryKey: ['/sales/customers', page],
    queryFn: () =>
      api.get<Paginated<SalesCustomerView>>('/sales/customers', { page, pageSize: 20 }),
    enabled: can(Permission.SALES_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.SALES_READ)) return <UnauthorizedState />;

  const columns: Column<SalesCustomerView>[] = [
    {
      key: 'name',
      header: 'Customer',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.city ?? 'City not recorded'} · {humanizeEnum(row.source)}
          </p>
        </div>
      ),
    },
    {
      key: 'subscription',
      header: 'Subscription',
      cell: (row) =>
        row.subscription.status ? (
          <div className="flex items-center gap-2">
            <StatusBadge status={row.subscription.status} />
            {row.subscription.planTier ? (
              <Badge variant="outline" className="text-[10px]">
                {humanizeEnum(row.subscription.planTier)}
              </Badge>
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">No plan</span>
        ),
    },
    {
      key: 'vehicles',
      header: 'Vehicles',
      numeric: true,
      cell: (row) => <span className="tabular-nums text-sm">{row.vehicles}</span>,
    },
    {
      key: 'trackers',
      header: 'Trackers',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => <span className="tabular-nums text-sm">{row.trackers}</span>,
    },
    {
      key: 'live',
      header: 'Live',
      numeric: true,
      cell: (row) => (
        <span
          className={
            row.vehicles > 0 && row.live === 0
              ? 'tabular-nums text-sm font-medium text-warning'
              : 'tabular-nums text-sm'
          }
        >
          {row.live} / {row.vehicles}
        </span>
      ),
    },
    {
      key: 'onboarding',
      header: 'First vehicle',
      hideOnMobile: true,
      cell: (row) =>
        row.onboardingCompletedAt ? (
          <span className="text-sm text-muted-foreground">
            {formatDate(row.onboardingCompletedAt)}
          </span>
        ) : row.leadId ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/sales/leads/${row.leadId}`}>Set up</Link>
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sales"
        title="My customers"
        description="Businesses credited to you. Enough to see the sale landed — no more."
      />

      <SalesStandingNotice
        profile={profile}
        godWebVerificationAvailable={godWebVerificationAvailable}
      />

      {/*
        Said plainly rather than left as an absence, so nobody spends a
        fortnight looking for a live map that was never theirs to see.
      */}
      <Alert>
        <AlertDescription className="text-xs">
          You can see whether a customer’s vehicles are reporting, not where they are. Live
          tracking, drivers, trips and documents belong to the customer.
        </AlertDescription>
      </Alert>

      <DataTable
        columns={columns}
        rows={customers.data?.items}
        rowKey={(row) => row.organizationId}
        isLoading={customers.isLoading}
        error={customers.error}
        onRetry={() => void customers.refetch()}
        {...(customers.data?.pagination ? { pagination: customers.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="No customers yet"
        emptyDescription="A lead becomes a customer here once they register and subscribe."
      />
    </div>
  );
}

export default SalesCustomersPage;
