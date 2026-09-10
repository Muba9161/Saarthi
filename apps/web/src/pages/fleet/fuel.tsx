import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Permission, formatCurrency, formatNumber } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatCard } from '@/components/common/stat-card';
import { toSeriesPoints } from '@/components/common/mini-chart';
import { UnauthorizedState } from '@/components/common/states';

interface FuelRow {
  id: string;
  registrationNumber: string;
  quantityLitres: number;
  pricePerUnit: number;
  totalCost: number;
  odometerKm: number | null;
  stationName: string | null;
  recordedAt: string;
}

export function FuelPage() {
  const { can } = useAuth();
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['fuel', page],
    queryFn: () =>
      api.get<{
        items: FuelRow[];
        pagination: any;
        totals: { litres: number; cost: number; averagePricePerLitre: number };
        trends: {
          days: string[];
          litres: { date: string; value: number }[];
          cost: { date: string; value: number }[];
          ratePerLitre: { date: string; value: number }[];
        };
      }>('/fuel', { page, pageSize: 20 }),
    enabled: can(Permission.FUEL_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.FUEL_READ)) return <UnauthorizedState />;

  const totals = query.data?.totals;
  /**
   * The fortnight beside each total, read under the same filter as the table.
   * Empty until the first page lands, so a tile never draws a shape from a
   * request that has not returned.
   */
  const trends = query.data?.trends;

  const columns: Column<FuelRow>[] = [
    { key: 'truck', header: 'Truck', cell: (row) => <span className="font-medium">{row.registrationNumber}</span> },
    { key: 'station', header: 'Station', hideOnMobile: true, cell: (row) => <span className="text-sm text-muted-foreground">{row.stationName ?? '-'}</span> },
    { key: 'litres', header: 'Litres', numeric: true, cell: (row) => formatNumber(row.quantityLitres, 1) },
    { key: 'rate', header: 'Rate', numeric: true, hideOnMobile: true, cell: (row) => formatCurrency(row.pricePerUnit) },
    { key: 'cost', header: 'Cost', numeric: true, cell: (row) => <span className="font-medium">{formatCurrency(row.totalCost)}</span> },
    { key: 'odometer', header: 'Odometer', numeric: true, hideOnMobile: true, cell: (row) => (row.odometerKm ? `${formatNumber(row.odometerKm)} km` : '-') },
    { key: 'when', header: 'Recorded', hideOnMobile: true, cell: (row) => new Date(row.recordedAt).toLocaleDateString('en-IN') },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Fuel" description="Every fill-up, with cost and consumption." />
      {totals ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Total litres"
            value={formatNumber(totals.litres, 0)}
            chart={{
              kind: 'bars',
              points: toSeriesPoints(trends?.litres ?? []),
              format: (value) => `${formatNumber(value, 1)} L`,
            }}
            hint="Last 14 days charted"
          />
          <StatCard
            label="Total spend"
            value={formatCurrency(totals.cost)}
            chart={{
              kind: 'bars',
              points: toSeriesPoints(trends?.cost ?? []),
              format: formatCurrency,
            }}
            hint="Last 14 days charted"
          />
          <StatCard
            label="Average rate"
            value={formatCurrency(totals.averagePricePerLitre)}
            chart={{
              kind: 'area',
              points: toSeriesPoints(trends?.ratePerLitre ?? []),
              format: (value) => `${formatCurrency(value)}/L`,
            }}
            hint="per litre"
          />
        </div>
      ) : null}
      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(row) => row.id}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="No fuel records yet"
        emptyDescription="Drivers and managers can record fill-ups against a truck."
      />
    </div>
  );
}

export default FuelPage;
