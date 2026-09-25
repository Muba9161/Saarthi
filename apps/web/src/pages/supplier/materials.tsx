import * as React from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Permission, formatCurrency, formatNumber, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { MaterialSummary, Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Button } from '@/components/ui/button';

/**
 * A Seller's own catalogue. One account sells across as many categories as it
 * likes — the category belongs to each product, not to the account.
 */
export function SupplierMaterialsPage() {
  const { can } = useAuth();
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['/marketplace/my-materials', page],
    queryFn: () =>
      api.get<Paginated<MaterialSummary>>('/marketplace/my-materials', { page, pageSize: 20 }),
    enabled: can(Permission.MATERIALS_MANAGE),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.MATERIALS_MANAGE)) return <UnauthorizedState />;

  const columns: Column<MaterialSummary>[] = [
    {
      key: 'product',
      header: 'Product',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.commerceCategory?.path.map((node) => node.name).join(' › ') ??
              row.category ??
              'Uncategorised'}
          </p>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      numeric: true,
      cell: (row) => formatCurrency(row.pricePerUnit),
    },
    {
      key: 'available',
      header: 'Available',
      numeric: true,
      cell: (row) => (
        <span className="text-sm">
          {formatNumber(row.availableQuantity)} {humanizeEnum(row.unit).toLowerCase()}
        </span>
      ),
    },
    {
      key: 'minimum',
      header: 'Minimum order',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => formatNumber(row.minimumOrderQty),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="My products"
        description="Everything you sell, in any category: pricing, stock and pickup points."
        actions={
          <Button asChild>
            <Link to="/supplier/materials/new">
              <Plus className="size-4" />
              Add product
            </Link>
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(row) => row.id}
        isLoading={query.isLoading || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="No products yet"
      />
    </div>
  );
}

export default SupplierMaterialsPage;
