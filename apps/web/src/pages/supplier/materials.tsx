import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Feature, Permission, formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';

export function SupplierMaterialsPage() {
  const { can } = useAuth();
  
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['/marketplace/my-materials', page],
    queryFn: () => api.get<any>('/marketplace/my-materials', { page, pageSize: 20 }),
    enabled: can(Permission.MATERIALS_MANAGE),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.MATERIALS_MANAGE)) return <UnauthorizedState />;
  

  const columns: Column<any>[] = [
    { key: 'material', header: 'Material', cell: (row) => (<div className="min-w-0"><p className="truncate font-medium">{row.name}</p><p className="truncate text-xs text-muted-foreground">{row.category ?? 'Uncategorised'}</p></div>) },
    { key: 'price', header: 'Price', numeric: true, cell: (row) => formatCurrency(row.pricePerUnit) },
    { key: 'available', header: 'Available', numeric: true, cell: (row) => <span className="text-sm">{formatNumber(row.availableQuantity)} {humanizeEnum(row.unit).toLowerCase()}</span> },
    { key: 'minimum', header: 'Minimum order', numeric: true, hideOnMobile: true, cell: (row) => formatNumber(row.minimumOrderQty) },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="My materials" description="Your catalogue: pricing, availability and pickup points." />
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

export default SupplierMaterialsPage;
