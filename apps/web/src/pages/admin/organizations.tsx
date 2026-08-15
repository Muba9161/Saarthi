import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Feature, Permission, formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';

export function AdminOrganizationsPage() {
  const { can } = useAuth();
  
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['/admin/organizations', page],
    queryFn: () => api.get<any>('/admin/organizations', { page, pageSize: 20 }),
    enabled: can(Permission.ADMIN_ORGANIZATIONS),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.ADMIN_ORGANIZATIONS)) return <UnauthorizedState />;
  

  const columns: Column<any>[] = [
    { key: 'org', header: 'Organization', cell: (row) => (<div className="min-w-0"><p className="truncate font-medium">{row.name}</p><p className="truncate text-xs text-muted-foreground">{[row.city, row.state].filter(Boolean).join(', ') || '—'}</p></div>) },
    { key: 'type', header: 'Type', cell: (row) => <StatusBadge status={row.type} /> },
    { key: 'verification', header: 'Verification', cell: (row) => <StatusBadge status={row.verificationStatus} size="sm" /> },
    { key: 'members', header: 'Members', numeric: true, hideOnMobile: true, cell: (row) => row.memberCount },
    { key: 'trucks', header: 'Trucks', numeric: true, hideOnMobile: true, cell: (row) => row.truckCount },
    { key: 'code', header: 'Invite code', hideOnMobile: true, cell: (row) => <code className="text-xs">{row.inviteCode}</code> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Organizations" description="Fleets, suppliers and customers on the platform." />
      <DataTable
        columns={columns}
        rows={query.data?.items ?? (Array.isArray(query.data) ? query.data : undefined)}
        rowKey={(row) => row.id}
        isLoading={query.isLoading || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="Nothing here yet"
      />
      {void [formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom, StatusBadge, Feature]}
    </div>
  );
}

export default AdminOrganizationsPage;
