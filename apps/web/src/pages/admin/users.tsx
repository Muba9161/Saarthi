import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Feature, Permission, formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';

export function AdminUsersPage() {
  const { can } = useAuth();
  
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['/admin/users', page],
    queryFn: () => api.get<any>('/admin/users', { page, pageSize: 20 }),
    enabled: can(Permission.ADMIN_USERS),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.ADMIN_USERS)) return <UnauthorizedState />;
  

  const columns: Column<any>[] = [
    { key: 'user', header: 'User', cell: (row) => (<div className="min-w-0"><p className="truncate font-medium">{row.firstName} {row.lastName}</p><p className="truncate text-xs text-muted-foreground">{row.email}</p></div>) },
    { key: 'roles', header: 'Roles', hideOnMobile: true, cell: (row) => <span className="text-sm">{row.roles.map(humanizeEnum).join(', ')}</span> },
    { key: 'orgs', header: 'Organizations', hideOnMobile: true, cell: (row) => <span className="truncate text-sm text-muted-foreground">{row.organizations.map((entry: any) => entry.name).join(', ') || '—'}</span> },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    { key: 'seen', header: 'Last seen', hideOnMobile: true, cell: (row) => <span className="text-sm text-muted-foreground">{row.lastLoginAt ? relativeTimeFrom(row.lastLoginAt) : 'Never'}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Users" description="Every VorldX Saarthi account and the organizations it belongs to." />
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

export default AdminUsersPage;
