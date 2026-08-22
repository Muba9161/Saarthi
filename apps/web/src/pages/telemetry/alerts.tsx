import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, ShieldCheck, Wrench } from 'lucide-react';
import { Feature, Permission, RealtimeEvent, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { MaintenanceRecommendation, TelemetryAlertSummary } from '@/lib/mobility-types';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, FeatureLockedState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Telemetry alerts and the maintenance recommendations they add up to.
 *
 * Every alert stores the value observed and the threshold it crossed, so the
 * table can show *why* it fired rather than only that it did. That is what makes
 * a driver-score deduction defensible when the driver disputes it.
 */

export function TelemetryAlertsPage() {
  const { can, hasFeature } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<'open' | 'all'>('open');
  const [page, setPage] = React.useState(1);

  const canRead = can(Permission.TELEMETRY_ALERTS_READ);
  const canManage = can(Permission.TELEMETRY_ALERTS_MANAGE);

  const alerts = useQuery({
    queryKey: ['telemetry', 'alerts', filter, page],
    queryFn: () =>
      api.get<Paginated<TelemetryAlertSummary>>('/telemetry/alerts', {
        page,
        pageSize: 20,
        ...(filter === 'open' ? { openOnly: true } : {}),
      }),
    enabled: canRead,
  });

  const recommendations = useQuery({
    queryKey: ['telemetry', 'maintenance'],
    queryFn: () => api.get<MaintenanceRecommendation[]>('/telemetry/maintenance'),
    enabled: can(Permission.MAINTENANCE_READ) && hasFeature(Feature.TELEMETRY_HISTORY),
  });

  useRealtimeEvent(RealtimeEvent.TELEMETRY_ALERT_CREATED, () => void alerts.refetch());

  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/telemetry/alerts/${id}`, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['telemetry'] }),
  });

  const accept = useMutation({
    mutationFn: ({ vehicleId, code }: { vehicleId: string; code: string }) =>
      api.post('/telemetry/maintenance/accept', { vehicleId, code }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['telemetry'] }),
  });

  if (!canRead) return <UnauthorizedState />;
  if (!hasFeature(Feature.TELEMETRY_LIVE)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Telemetry alerts" />
        <FeatureLockedState feature="Hardware telemetry" requiredPlan="Pro" />
      </div>
    );
  }

  const columns: Column<TelemetryAlertSummary>[] = [
    {
      key: 'alert',
      header: 'Alert',
      cell: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{humanizeEnum(row.type)}</p>
            <Badge
              variant={
                row.severity === 'CRITICAL'
                  ? 'destructive'
                  : row.severity === 'WARNING'
                    ? 'warning'
                    : 'info'
              }
              size="sm"
            >
              {row.severity.toLowerCase()}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">{row.message}</p>
        </div>
      ),
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      cell: (row) => (
        <Link
          to={`/fleet/vehicles/${row.vehicleId}/telemetry`}
          className="text-sm hover:text-foreground"
        >
          {row.vehicleRegistration}
        </Link>
      ),
    },
    {
      key: 'driver',
      header: 'Driver',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.driverName ?? '—'}
          {row.scoreEventId ? (
            <Badge variant="outline" size="sm" className="ml-1.5">
              scored
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'measured',
      header: 'Measured',
      numeric: true,
      cell: (row) =>
        row.observedValue === null ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <div>
            <p className="text-sm font-medium tabular-nums">
              {row.observedValue}
              {row.unit ? ` ${row.unit}` : ''}
            </p>
            {row.threshold !== null ? (
              <p className="text-2xs text-muted-foreground">
                limit {row.threshold}
                {row.unit ? ` ${row.unit}` : ''}
              </p>
            ) : null}
          </div>
        ),
    },
    {
      key: 'when',
      header: 'When',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.occurredAt).toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      key: 'action',
      header: '',
      cell: (row) =>
        canManage && row.status === 'OPEN' ? (
          <Button
            variant="ghost"
            size="sm"
            loading={update.isPending}
            onClick={() => update.mutate({ id: row.id, status: 'RESOLVED' })}
          >
            Resolve
          </Button>
        ) : (
          <Badge variant={row.status === 'OPEN' ? 'warning' : 'success'} size="sm">
            {humanizeEnum(row.status)}
          </Badge>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Saarthi Connect"
        title="Telemetry alerts"
        description="Raised from connected hardware. Each one records what was measured and the limit it crossed."
      />

      {(recommendations.data?.length ?? 0) > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <SectionHeader
              title="Maintenance recommendations"
              description="Threshold rules over recent alerts — not predictions. Saarthi will not claim to predict a failure until it has the fleet history to do so honestly."
            />
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 pt-0 sm:grid-cols-2">
            {recommendations.data!.map((entry) => (
              <div
                key={`${entry.vehicleId}-${entry.code}`}
                className="space-y-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{entry.label}</p>
                    <p className="text-xs text-muted-foreground">{entry.vehicleRegistration}</p>
                  </div>
                  <Badge
                    variant={entry.severity === 'CRITICAL' ? 'destructive' : 'warning'}
                    size="sm"
                  >
                    {entry.occurrences}× in {entry.windowDays}d
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{entry.reason}</p>
                <p className="text-xs">{entry.recommendation}</p>
                {can(Permission.MAINTENANCE_MANAGE) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full gap-1.5"
                    loading={accept.isPending}
                    onClick={() =>
                      accept.mutate({ vehicleId: entry.vehicleId, code: entry.code })
                    }
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    Schedule this work
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-end">
        <Tabs
          value={filter}
          onValueChange={(value) => {
            setFilter(value as 'open' | 'all');
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {alerts.data && alerts.data.items.length === 0 && filter === 'open' ? (
        <EmptyState
          icon={ShieldCheck}
          title="No open alerts"
          description="Nothing needs attention. Overspeed, harsh driving, temperature, voltage and diagnostic alerts appear here as they are raised."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={alerts.data?.items}
          rowKey={(row) => row.id}
          isLoading={alerts.isLoading}
          error={alerts.error}
          pagination={alerts.data?.pagination}
          onPageChange={setPage}
          emptyTitle="No alerts"
          emptyDescription="No telemetry alerts have been raised."
        />
      )}

      <Card>
        <CardContent className="flex items-start gap-2 py-3 text-xs text-muted-foreground">
          <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            A rule fires only when the vehicle actually reports the metric it needs. A vehicle whose
            device cannot read coolant temperature will never raise a temperature alert — it is not
            treated as running cool.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default TelemetryAlertsPage;
