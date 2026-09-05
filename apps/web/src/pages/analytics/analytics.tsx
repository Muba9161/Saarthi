import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Fuel, IndianRupee, Route as RouteIcon, TrendingUp } from 'lucide-react';
import {
  Feature,
  OrganizationType,
  Permission,
  formatCompactCurrency,
  formatCurrency,
  formatDistanceKm,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type {
  DriverPerformance,
  RoutePerformance,
  TimeSeriesPoint,
  TruckPerformance,
} from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatCard } from '@/components/common/stat-card';
import { FeatureLockedState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScoreBadge } from '@/components/common/status-badge';
import { Stagger, StaggerItem } from '@/components/motion';

/**
 * Fleet analytics.
 *
 * Every series and table below is aggregated by the API from trips, fuel
 * records and maintenance rows. Nothing is smoothed, sampled or invented for
 * the sake of a nicer chart — a flat line means a quiet month.
 */

const chartTooltip = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 10,
  fontSize: 12,
  boxShadow: '0 8px 24px -8px hsl(var(--foreground) / 0.18)',
};

export function AnalyticsPage() {
  const { can, hasFeature, session } = useAuth();
  const enabled = can(Permission.ANALYTICS_READ) && hasFeature(Feature.FLEET_ANALYTICS);
  // Same rows, same maths, same table — a travel operator's profit per car is
  // computed exactly as a haulier's profit per lorry. Only the word differs.
  const isMobility = session?.organization?.type === OrganizationType.MOBILITY_PROVIDER;
  const noun = isMobility ? 'vehicle' : 'truck';

  const series = useQuery({
    queryKey: ['analytics', 'performance'],
    queryFn: () => api.get<TimeSeriesPoint[]>('/analytics/performance'),
    enabled,
  });
  const trucks = useQuery({
    queryKey: ['analytics', 'trucks'],
    queryFn: () => api.get<TruckPerformance[]>('/analytics/trucks'),
    enabled,
  });
  const drivers = useQuery({
    queryKey: ['analytics', 'drivers'],
    queryFn: () => api.get<DriverPerformance[]>('/analytics/drivers'),
    enabled,
  });
  const routes = useQuery({
    queryKey: ['analytics', 'routes'],
    queryFn: () => api.get<RoutePerformance[]>('/analytics/routes'),
    enabled: can(Permission.ANALYTICS_READ) && hasFeature(Feature.REPORTS_ADVANCED),
  });

  if (!can(Permission.ANALYTICS_READ)) return <UnauthorizedState />;
  if (!hasFeature(Feature.FLEET_ANALYTICS)) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Intelligence" title="Analytics" />
        <FeatureLockedState feature="Fleet analytics" requiredPlan="Pro" />
      </div>
    );
  }

  // Period totals, summed from the same series the chart draws.
  const points = series.data ?? [];
  const totals = points.reduce(
    (accumulator, point) => ({
      trips: accumulator.trips + point.trips,
      distanceKm: accumulator.distanceKm + point.distanceKm,
      revenue: accumulator.revenue + point.revenue,
      fuelCost: accumulator.fuelCost + point.fuelCost,
    }),
    { trips: 0, distanceKm: 0, revenue: 0, fuelCost: 0 },
  );
  const costPerKm = totals.distanceKm > 0 ? totals.fuelCost / totals.distanceKm : 0;

  const truckColumns: Column<TruckPerformance>[] = [
    {
      key: 'truck',
      header: isMobility ? 'Vehicle' : 'Truck',
      cell: (row) => <span className="font-medium">{row.registrationNumber}</span>,
    },
    { key: 'trips', header: 'Trips', numeric: true, cell: (row) => row.trips },
    {
      key: 'distance',
      header: 'Distance',
      numeric: true,
      cell: (row) => formatDistanceKm(row.distanceKm),
    },
    {
      key: 'revenue',
      header: 'Revenue',
      numeric: true,
      cell: (row) => formatCurrency(row.revenue),
    },
    {
      key: 'costs',
      header: 'Fuel + service',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => formatCurrency(row.fuelCost + row.maintenanceCost),
    },
    {
      key: 'profit',
      header: 'Profit',
      numeric: true,
      cell: (row) => (
        <span className={row.profit >= 0 ? 'font-medium text-success' : 'font-medium text-destructive'}>
          {formatCurrency(row.profit)}
        </span>
      ),
    },
    {
      key: 'utilisation',
      header: 'Utilisation',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => `${row.utilizationPercent}%`,
    },
  ];

  const driverColumns: Column<DriverPerformance>[] = [
    { key: 'driver', header: 'Driver', cell: (row) => <span className="font-medium">{row.name}</span> },
    {
      key: 'score',
      header: 'Score',
      numeric: true,
      cell: (row) => <ScoreBadge score={row.overallScore} />,
    },
    { key: 'trips', header: 'Trips', numeric: true, cell: (row) => row.trips },
    {
      key: 'ontime',
      header: 'On time',
      numeric: true,
      cell: (row) => (row.onTimePercent === null ? '—' : `${row.onTimePercent}%`),
    },
    {
      key: 'distance',
      header: 'Distance',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => formatDistanceKm(row.distanceKm),
    },
    {
      key: 'safety',
      header: 'Safety events',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => row.safetyEvents,
    },
    {
      key: 'rating',
      header: 'Rating',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => (row.averageRating ? `★ ${row.averageRating}` : '—'),
    },
  ];

  const routeColumns: Column<RoutePerformance>[] = [
    { key: 'route', header: 'Route', cell: (row) => <span className="font-medium">{row.route}</span> },
    { key: 'trips', header: 'Trips', numeric: true, cell: (row) => row.trips },
    {
      key: 'distance',
      header: 'Avg distance',
      numeric: true,
      cell: (row) => formatDistanceKm(row.averageDistanceKm),
    },
    {
      key: 'duration',
      header: 'Avg duration',
      numeric: true,
      hideOnMobile: true,
      cell: (row) =>
        row.averageDurationMin ? `${Math.round(row.averageDurationMin / 60)} h` : '—',
    },
    {
      key: 'revenue',
      header: 'Avg revenue',
      numeric: true,
      cell: (row) => formatCurrency(row.averageRevenue),
    },
    {
      key: 'ontime',
      header: 'On time',
      numeric: true,
      cell: (row) => (row.onTimePercent === null ? '—' : `${row.onTimePercent}%`),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Intelligence"
        title="Analytics"
        description="Calculated from your operational records — never estimated for display."
      />

      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem>
          <StatCard
            label="Trips completed"
            numericValue={totals.trips}
            format={(value) => String(Math.round(value))}
            icon={RouteIcon}
            hint="Last 30 days"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Revenue"
            numericValue={totals.revenue}
            format={formatCompactCurrency}
            icon={IndianRupee}
            hint={`${formatDistanceKm(totals.distanceKm)} driven`}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Fuel spend"
            numericValue={totals.fuelCost}
            format={formatCompactCurrency}
            icon={Fuel}
            tone="warning"
            hint={costPerKm > 0 ? `${formatCurrency(costPerKm)} per km` : 'No distance recorded'}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Gross margin"
            numericValue={totals.revenue - totals.fuelCost}
            format={formatCompactCurrency}
            icon={TrendingUp}
            tone={totals.revenue - totals.fuelCost >= 0 ? 'success' : 'destructive'}
            hint={
              totals.revenue > 0
                ? `${Math.round(((totals.revenue - totals.fuelCost) / totals.revenue) * 100)}% of revenue`
                : 'No revenue in this period'
            }
          />
        </StaggerItem>
      </Stagger>

      <Card variant="glass">
        <CardHeader className="pb-2">
          <SectionHeader title="Trips, revenue and fuel cost" description="Last 30 days" />
        </CardHeader>
        <CardContent className="pt-0">
          {series.isLoading ? (
            <LoadingState />
          ) : points.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No completed trips in this period yet.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fill-revenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fill-fuel" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--warning))" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="hsl(var(--warning))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(value) => formatCompactCurrency(Number(value))}
                />
                <ChartTooltip
                  contentStyle={chartTooltip}
                  formatter={(value, name) =>
                    name === 'Trips' ? String(value) : formatCurrency(Number(value))
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="hsl(var(--success))"
                  strokeWidth={2}
                  fill="url(#fill-revenue)"
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="fuelCost"
                  name="Fuel"
                  stroke="hsl(var(--warning))"
                  strokeWidth={2}
                  fill="url(#fill-fuel)"
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="trips"
                  name="Trips"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="transparent"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="trucks">
        <TabsList>
          <TabsTrigger value="trucks">By {noun}</TabsTrigger>
          <TabsTrigger value="drivers">By driver</TabsTrigger>
          <TabsTrigger value="routes">By route</TabsTrigger>
        </TabsList>

        <TabsContent value="trucks" className="space-y-4">
          {(trucks.data ?? []).length > 0 ? (
            <Card variant="glass">
              <CardHeader className="pb-2">
                <SectionHeader
                  title={`Profit by ${noun}`}
                  description="Revenue less fuel and maintenance, per vehicle."
                />
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={(trucks.data ?? []).slice(0, 10)}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="registrationNumber"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      width={56}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => formatCompactCurrency(Number(value))}
                    />
                    <ChartTooltip
                      cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
                      contentStyle={chartTooltip}
                      formatter={(value) => formatCurrency(Number(value))}
                    />
                    <Bar dataKey="profit" name="Profit" radius={[6, 6, 0, 0]}>
                      {/* A loss-making truck should not be the same colour as a profitable one. */}
                      {(trucks.data ?? []).slice(0, 10).map((row) => (
                        <Cell
                          key={row.truckId}
                          fill={row.profit >= 0 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ) : null}
          <DataTable
            columns={truckColumns}
            rows={trucks.data}
            rowKey={(row) => row.truckId}
            isLoading={trucks.isLoading}
            error={trucks.error}
            onRetry={() => void trucks.refetch()}
            emptyTitle={`No ${noun} performance yet`}
            emptyDescription="Complete a trip and the numbers appear here."
          />
        </TabsContent>

        <TabsContent value="drivers">
          <DataTable
            columns={driverColumns}
            rows={drivers.data}
            rowKey={(row) => row.driverId}
            isLoading={drivers.isLoading}
            error={drivers.error}
            onRetry={() => void drivers.refetch()}
            emptyTitle="No driver performance yet"
          />
        </TabsContent>

        <TabsContent value="routes">
          {!hasFeature(Feature.REPORTS_ADVANCED) ? (
            <FeatureLockedState feature="Route analytics" requiredPlan="Pro" />
          ) : (
            <DataTable
              columns={routeColumns}
              rows={routes.data}
              rowKey={(row) => row.route}
              isLoading={routes.isLoading}
              error={routes.error}
              onRetry={() => void routes.refetch()}
              emptyTitle="No completed routes yet"
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AnalyticsPage;
