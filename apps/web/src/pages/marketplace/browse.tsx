import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Permission, formatCurrency, formatNumber, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { MaterialSummary, Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { UnauthorizedState } from '@/components/common/states';

/**
 * Seller listings, for a fleet owner pricing a delivered bid.
 *
 * Fleet-only: the API refuses a customer, because the customer deals with the
 * fleet and never with the seller directly.
 */
export function BrowseMaterialsPage() {
  const { can } = useAuth();
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['/marketplace/materials', page],
    queryFn: () =>
      api.get<Paginated<MaterialSummary>>('/marketplace/materials', {
        page,
        pageSize: 20,
        availableOnly: true,
      }),
    enabled: can(Permission.MATERIALS_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.MATERIALS_READ)) return <UnauthorizedState />;

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
      key: 'seller',
      header: 'Seller',
      hideOnMobile: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.supplierName}</p>
          {row.supplierVerified ? <p className="text-xs text-success">Verified</p> : null}
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      numeric: true,
      cell: (row) => (
        <div>
          <p className="font-medium">{formatCurrency(row.pricePerUnit)}</p>
          <p className="text-xs text-muted-foreground">
            per {humanizeEnum(row.unit).toLowerCase()}
          </p>
        </div>
      ),
    },
    {
      key: 'available',
      header: 'Available',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => <span className="text-sm">{formatNumber(row.availableQuantity)}</span>,
    },
    {
      key: 'pickup',
      header: 'Pickup',
      hideOnMobile: true,
      cell: (row) => (
        <span className="truncate text-sm text-muted-foreground">{row.pickupAddress ?? '-'}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Find sellers"
        description="Seller listings you can source from when you bid on a customer's material requirement."
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
        emptyTitle="No listings yet"
      />
    </div>
  );
}

export default BrowseMaterialsPage;
