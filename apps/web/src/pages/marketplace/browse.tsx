import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Feature, Permission, formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';

export function BrowseMaterialsPage() {
  const { can } = useAuth();
  
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['/marketplace/materials', page],
    queryFn: () => api.get<any>('/marketplace/materials', { page, pageSize: 20, availableOnly: true }),
    enabled: can(Permission.MATERIALS_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.MATERIALS_READ)) return <UnauthorizedState />;
  

  const columns: Column<any>[] = [
    { key: 'material', header: 'Material', cell: (row) => (<div className="min-w-0"><p className="truncate font-medium">{row.name}</p><p className="truncate text-xs text-muted-foreground">{row.category ?? 'Uncategorised'}</p></div>) },
    { key: 'supplier', header: 'Supplier', hideOnMobile: true, cell: (row) => (<div className="min-w-0"><p className="truncate text-sm">{row.supplierName}</p>{row.supplierVerified ? <p className="text-xs text-success">Verified</p> : null}</div>) },
    { key: 'price', header: 'Price', numeric: true, cell: (row) => (<div><p className="font-medium">{formatCurrency(row.pricePerUnit)}</p><p className="text-xs text-muted-foreground">per {humanizeEnum(row.unit).toLowerCase()}</p></div>) },
    { key: 'available', header: 'Available', numeric: true, hideOnMobile: true, cell: (row) => <span className="text-sm">{formatNumber(row.availableQuantity)}</span> },
    { key: 'pickup', header: 'Pickup', hideOnMobile: true, cell: (row) => <span className="truncate text-sm text-muted-foreground">{row.pickupAddress ?? '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Find materials" description="Verified suppliers and what they have available right now." />
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

export default BrowseMaterialsPage;
