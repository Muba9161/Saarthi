import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { Feature, Permission, formatCurrency, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { MaintenanceRisk, MaintenanceSummary, Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { FeatureLockedState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export function MaintenancePage() {
  const { can, hasFeature } = useAuth();
  const [page, setPage] = React.useState(1);

  const jobs = useQuery({
    queryKey: ['maintenance', page],
    queryFn: () => api.get<Paginated<MaintenanceSummary>>('/maintenance', { page, pageSize: 20 }),
    enabled: can(Permission.MAINTENANCE_READ) && hasFeature(Feature.MAINTENANCE_BASIC),
  });

  const risk = useQuery({
    queryKey: ['maintenance', 'risk'],
    queryFn: () => api.get<MaintenanceRisk[]>('/maintenance/risk'),
    enabled: can(Permission.MAINTENANCE_READ) && hasFeature(Feature.MAINTENANCE_BASIC),
  });

  if (!can(Permission.MAINTENANCE_READ)) return <UnauthorizedState />;
  if (!hasFeature(Feature.MAINTENANCE_BASIC)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Maintenance" />
        <FeatureLockedState feature="Maintenance tracking" requiredPlan="Pro" />
      </div>
    );
  }

  const columns: Column<MaintenanceSummary>[] = [
    { key: 'job', header: 'Job', cell: (row) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.title}</p>
        <p className="text-xs text-muted-foreground">{row.registrationNumber} · {humanizeEnum(row.type)}</p>
      </div>
    ) },
    { key: 'status', header: 'Status', cell: (row) => (
      <div className="flex items-center gap-2">
        <StatusBadge status={row.status} />
        {row.overdue ? <Badge variant="destructive" size="sm">Overdue</Badge> : null}
      </div>
    ) },
    { key: 'provider', header: 'Provider', hideOnMobile: true, cell: (row) => <span className="text-sm text-muted-foreground">{row.serviceProvider ?? '—'}</span> },
    { key: 'scheduled', header: 'Scheduled', hideOnMobile: true, cell: (row) => <span className="text-sm">{row.scheduledAt ? new Date(row.scheduledAt).toLocaleDateString('en-IN') : '—'}</span> },
    { key: 'cost', header: 'Cost', numeric: true, cell: (row) => formatCurrency(row.cost) },
  ];

  const atRisk = (risk.data ?? []).filter((entry) => entry.level !== 'LOW');

  return (
    <div className="space-y-5">
      <PageHeader title="Maintenance" description="Scheduled work, service history and rule-based risk." />

      {atRisk.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <SectionHeader title="Vehicles needing attention" description="Risk is calculated from mileage, service intervals and recent repairs — not predicted." />
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 pt-0 sm:grid-cols-2">
            {atRisk.slice(0, 6).map((entry) => (
              <div key={entry.truckId} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{entry.registrationNumber}</p>
                  <Badge variant={entry.level === 'HIGH' ? 'destructive' : 'warning'} size="sm">{entry.riskScore}/100</Badge>
                </div>
                <Progress value={entry.riskScore} className="mt-2 h-1.5" indicatorClassName={entry.level === 'HIGH' ? 'bg-destructive' : 'bg-warning'} />
                <ul className="mt-2 space-y-0.5">
                  {entry.reasons.map((reason) => (
                    <li key={reason} className="text-xs text-muted-foreground">• {reason}</li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={jobs.data?.items}
        rowKey={(row) => row.id}
        isLoading={jobs.isLoading}
        error={jobs.error}
        onRetry={() => void jobs.refetch()}
        {...(jobs.data?.pagination ? { pagination: jobs.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="No maintenance recorded"
        emptyDescription="Schedule preventive work or log a repair against a truck."
      />
      {void Wrench}
    </div>
  );
}

export default MaintenancePage;
