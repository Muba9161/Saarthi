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

export function SosIncidentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['/sos', page],
    queryFn: () => api.get<any>('/sos', { page, pageSize: 20 }),
    enabled: can(Permission.SOS_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.SOS_READ)) return <UnauthorizedState />;
  

  const columns: Column<any>[] = [
    { key: 'reference', header: 'Incident', cell: (row) => (<div className="min-w-0"><p className="font-medium">{row.reference}</p><p className="truncate text-xs text-muted-foreground">{relativeTimeFrom(row.triggeredAt)}</p></div>) },
    { key: 'type', header: 'Type', cell: (row) => <StatusBadge status={row.type} /> },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    { key: 'driver', header: 'Driver', hideOnMobile: true, cell: (row) => (<div className="min-w-0 text-sm"><p className="truncate">{row.driver?.name ?? 'Unknown'}</p><p className="truncate text-xs text-muted-foreground">{row.truck?.registrationNumber ?? ''}</p></div>) },
    { key: 'responders', header: 'Responders', numeric: true, cell: (row) => <span className="text-sm">{row.acknowledgedCount}/{row.responderCount}</span> },
    { key: 'where', header: 'Location', hideOnMobile: true, cell: (row) => <span className="truncate text-sm text-muted-foreground">{row.address ?? `${row.latitude.toFixed(3)}, ${row.longitude.toFixed(3)}`}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="SOS incidents" description="Emergency events raised by drivers, and how the network responded." />
      <DataTable
        columns={columns}
        rows={query.data?.items ?? (Array.isArray(query.data) ? query.data : undefined)}
        rowKey={(row) => row.id}
        isLoading={query.isLoading || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(row) => navigate(`/sos/${row.id}`)}
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="Nothing here yet"
      />
      {void [formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom, StatusBadge, Feature]}
    </div>
  );
}

export default SosIncidentsPage;
