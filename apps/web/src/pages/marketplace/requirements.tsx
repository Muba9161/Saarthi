import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Feature, Permission, formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { FeatureLockedState, UnauthorizedState } from '@/components/common/states';

export function MarketplaceRequirementsPage() {
  const { can, hasFeature } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['/orders/marketplace', page],
    queryFn: () => api.get<any>('/orders/marketplace', { page, pageSize: 20, radiusKm: 500 }),
    enabled: can(Permission.ORDERS_QUOTE) && hasFeature(Feature.ORDERS_MARKETPLACE),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.ORDERS_QUOTE)) return <UnauthorizedState />;
  if (!hasFeature(Feature.ORDERS_MARKETPLACE)) return (<div className="space-y-5"><PageHeader title="Open requirements" /><FeatureLockedState feature="Open requirements" /></div>);

  const columns: Column<any>[] = [
    { key: 'material', header: 'Load', cell: (row) => (<div className="min-w-0"><p className="truncate font-medium">{row.materialName}</p><p className="tabular text-xs text-muted-foreground">{formatNumber(row.quantity)} {humanizeEnum(row.unit).toLowerCase()} · needs {row.requiredCapacityTons}T</p></div>) },
    { key: 'route', header: 'Route', hideOnMobile: true, cell: (row) => (<div className="min-w-0 max-w-64"><p className="truncate text-sm">{row.originAddress.split(',')[0]}</p><p className="truncate text-xs text-muted-foreground">→ {row.destinationAddress.split(',')[0]}</p></div>) },
    { key: 'distance', header: 'From you', numeric: true, cell: (row) => <span className="text-sm">{row.distanceToPickupKm !== null ? `${row.distanceToPickupKm} km` : '—'}</span> },
    { key: 'budget', header: 'Budget', numeric: true, hideOnMobile: true, cell: (row) => formatCurrency(row.budget) },
    { key: 'quoted', header: '', cell: (row) => (row.hasQuoted ? <StatusBadge status="QUOTED" size="sm" /> : null) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Open requirements" description="Loads posted by customers that your fleet can quote for." />
      <DataTable
        columns={columns}
        rows={query.data?.items ?? (Array.isArray(query.data) ? query.data : undefined)}
        rowKey={(row) => row.id}
        isLoading={query.isLoading || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(row) => navigate(`/orders/${row.id}`)}
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="Nothing here yet"
      />
      {void [formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom, StatusBadge, Feature]}
    </div>
  );
}

export default MarketplaceRequirementsPage;
