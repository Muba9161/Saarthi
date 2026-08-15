import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Feature, Permission, formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';

export function AdminAuditPage() {
  const { can } = useAuth();
  
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['/admin/audit', page],
    queryFn: () => api.get<any>('/admin/audit', { page, pageSize: 20 }),
    enabled: can(Permission.ADMIN_AUDIT),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.ADMIN_AUDIT)) return <UnauthorizedState />;
  

  const columns: Column<any>[] = [
    { key: 'action', header: 'Action', cell: (row) => (<div className="min-w-0"><p className="truncate font-medium">{row.action}</p><p className="truncate text-xs text-muted-foreground">{row.entityType}{row.entityId ? ` · ${String(row.entityId).slice(0, 8)}` : ''}</p></div>) },
    { key: 'actor', header: 'Actor', hideOnMobile: true, cell: (row) => (<div className="min-w-0 text-sm"><p className="truncate">{row.actor?.name ?? 'System'}</p><p className="truncate text-xs text-muted-foreground">{row.actor?.email ?? ''}</p></div>) },
    { key: 'org', header: 'Organization', hideOnMobile: true, cell: (row) => <span className="truncate text-sm text-muted-foreground">{row.organization?.name ?? '—'}</span> },
    { key: 'ip', header: 'IP', hideOnMobile: true, cell: (row) => <code className="text-xs text-muted-foreground">{row.ipAddress ?? '—'}</code> },
    { key: 'when', header: 'When', cell: (row) => <span className="text-sm text-muted-foreground">{relativeTimeFrom(row.createdAt)}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Audit log" description="Every consequential action taken on the platform." />
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

export default AdminAuditPage;
