import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Feature, Permission, formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';

export function DriverTripsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['/trips', page],
    queryFn: () => api.get<any>('/trips', { page, pageSize: 20 }),
    enabled: can(Permission.TRIPS_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.TRIPS_READ)) return <UnauthorizedState />;
  

  const columns: Column<any>[] = [
    { key: 'reference', header: 'Trip', cell: (row) => (<div className="min-w-0"><p className="font-medium">{row.reference}</p><p className="truncate text-xs text-muted-foreground">{row.truck?.registrationNumber ?? ''}</p></div>) },
    { key: 'route', header: 'Route', cell: (row) => (<div className="min-w-0 max-w-64"><p className="truncate text-sm">{row.originAddress.split(',')[0]}</p><p className="truncate text-xs text-muted-foreground">→ {row.destinationAddress.split(',')[0]}</p></div>) },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    { key: 'distance', header: 'Distance', numeric: true, hideOnMobile: true, cell: (row) => <span className="text-sm">{row.actualDistanceKm} km</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="My trips" description="Every trip you have driven on Saarthi." />
      <DataTable
        columns={columns}
        rows={query.data?.items ?? (Array.isArray(query.data) ? query.data : undefined)}
        rowKey={(row) => row.id}
        isLoading={query.isLoading || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(row) => navigate(`/driver/trips/${row.id}`)}
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="Nothing here yet"
      />
      {void [formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom, StatusBadge, Feature]}
    </div>
  );
}

export default DriverTripsPage;
