import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, LifeBuoy, ShieldCheck, Siren, Users } from 'lucide-react';
import { Permission, RealtimeEvent, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type {
  AssociationAlertSummary,
  AssociationOverview,
  AssociationSummary,
} from '@/lib/mobility-types';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Truck association dashboard — the district emergency desk.
 *
 * Deliberately narrow. An association coordinates roadside assistance, so this
 * screen shows the alert queue, its urgency and its outcomes, and nothing about
 * the fleets, customers, cargo or finances behind those alerts. The API enforces
 * that; this screen simply has nothing else to show.
 */

const SEVERITY_TONE = {
  CRITICAL: 'destructive',
  WARNING: 'warning',
  INFO: 'info',
} as const;

function severityBadge(severity: keyof typeof SEVERITY_TONE) {
  return (
    <Badge variant={SEVERITY_TONE[severity]} size="sm">
      {severity.toLowerCase()}
    </Badge>
  );
}

/** "4 min", "2 h 10 m" — how long an alert has been waiting. */
function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder > 0 ? `${hours} h ${remainder} m` : `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function AssociationDashboardPage() {
  const { can } = useAuth();
  const [filter, setFilter] = React.useState<'open' | 'all'>('open');
  const [page, setPage] = React.useState(1);

  const canRead = can(Permission.ASSOCIATION_ALERTS_READ);

  const association = useQuery({
    queryKey: ['association', 'me'],
    queryFn: () => api.get<AssociationSummary>('/associations/me'),
    enabled: can(Permission.ASSOCIATION_READ),
  });

  const overview = useQuery({
    queryKey: ['association', 'overview'],
    queryFn: () => api.get<AssociationOverview>('/associations/alerts/overview'),
    enabled: canRead,
  });

  const alerts = useQuery({
    queryKey: ['association', 'alerts', filter, page],
    queryFn: () =>
      api.get<Paginated<AssociationAlertSummary>>('/associations/alerts', {
        page,
        pageSize: 20,
        ...(filter === 'open' ? { openOnly: true } : {}),
      }),
    enabled: canRead,
  });

  // A new emergency must appear without anyone refreshing — that is the whole
  // point of an emergency desk.
  useRealtimeEvent(RealtimeEvent.ASSOCIATION_ALERT_CREATED, () => {
    void overview.refetch();
    void alerts.refetch();
  });
  useRealtimeEvent(RealtimeEvent.ASSOCIATION_ALERT_UPDATED, () => {
    void overview.refetch();
    void alerts.refetch();
  });

  if (!canRead) return <UnauthorizedState />;

  const profile = association.data;
  const stats = overview.data;

  const columns: Column<AssociationAlertSummary>[] = [
    {
      key: 'alert',
      header: 'Alert',
      cell: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{humanizeEnum(row.incidentType)}</p>
            {severityBadge(row.severity)}
            {row.overdue ? (
              <Badge variant="destructive" size="sm">
                overdue
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {row.reference}
            {row.vehicleRegistration ? ` · ${row.vehicleRegistration}` : ''}
            {row.district ? ` · ${row.district}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge
          variant={
            row.status === 'RESOLVED' || row.status === 'CLOSED'
              ? 'success'
              : row.status === 'ESCALATED'
                ? 'destructive'
                : row.status === 'NOTIFIED'
                  ? 'warning'
                  : 'info'
          }
          size="sm"
        >
          {humanizeEnum(row.status)}
        </Badge>
      ),
    },
    {
      key: 'distance',
      header: 'Distance',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm">{row.distanceKm === null ? '—' : `${row.distanceKm} km`}</span>
      ),
    },
    {
      key: 'waiting',
      header: 'Waiting',
      numeric: true,
      cell: (row) => (
        <span className={row.overdue ? 'text-sm font-medium text-destructive' : 'text-sm'}>
          {formatAge(row.ageMinutes)}
        </span>
      ),
    },
    {
      key: 'responders',
      header: 'Responders',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => <span className="text-sm">{row.responderCount || '—'}</span>,
    },
    {
      key: 'action',
      header: '',
      cell: (row) => (
        <Button asChild variant="ghost" size="sm">
          <Link to={`/association/alerts/${row.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Saarthi Safety"
        title={profile?.name ?? 'Association desk'}
        description={
          profile
            ? `${profile.district}, ${profile.state} · ${profile.coverageAreas.length} coverage area(s)${
                profile.memberTruckCount ? ` · ${profile.memberTruckCount.toLocaleString('en-IN')} member trucks` : ''
              }`
            : 'District emergency coordination.'
        }
        actions={
          profile ? (
            <Badge variant={profile.acceptingAlerts ? 'success' : 'warning'}>
              {profile.acceptingAlerts ? 'Accepting alerts' : 'Alerts paused'}
            </Badge>
          ) : null
        }
      />

      {profile && profile.verificationStatus !== 'VERIFIED' ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">Verification pending</p>
              <p className="text-muted-foreground">
                Saarthi routes emergencies only to verified associations. Until this account is
                verified, no alerts will arrive here — which is deliberate: driver locations and
                contact details are not shared with unverified bodies.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Open alerts"
          numericValue={stats?.open ?? 0}
          format={(value) => String(Math.round(value))}
          icon={LifeBuoy}
          tone={stats && stats.open > 0 ? 'warning' : 'default'}
          live
        />
        <StatCard
          label="Critical"
          numericValue={stats?.critical ?? 0}
          format={(value) => String(Math.round(value))}
          icon={Siren}
          tone={stats && stats.critical > 0 ? 'destructive' : 'default'}
          hint="Accident, security or medical"
        />
        <StatCard
          label="Awaiting acknowledgement"
          numericValue={stats?.unacknowledged ?? 0}
          format={(value) => String(Math.round(value))}
          icon={Clock}
          tone={stats && stats.overdue > 0 ? 'destructive' : 'default'}
          hint={stats && stats.overdue > 0 ? `${stats.overdue} past the response window` : undefined}
        />
        <StatCard
          label="Resolved today"
          numericValue={stats?.resolvedToday ?? 0}
          format={(value) => String(Math.round(value))}
          icon={ShieldCheck}
          tone="success"
        />
      </div>

      {stats && stats.overdue > 0 ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                {stats.overdue} alert{stats.overdue === 1 ? '' : 's'} past the response window
              </p>
              <p className="text-muted-foreground">
                A driver is waiting at the roadside. Acknowledge the alert to take the case and see
                their contact number.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {profile && profile.stats.alertsReceived > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <SectionHeader
              title="Response record"
              description="Measured from alert arrival to acknowledgement by a named member of this association."
            />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 pt-0 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Received</p>
              <p className="text-lg font-semibold">{profile.stats.alertsReceived}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Acknowledged</p>
              <p className="text-lg font-semibold">{profile.stats.alertsAcknowledged}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Resolved</p>
              <p className="text-lg font-semibold">{profile.stats.alertsResolved}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Median response
              </p>
              <p className="text-lg font-semibold">
                {profile.stats.avgResponseMinutes === null
                  ? '—'
                  : `${profile.stats.avgResponseMinutes} min`}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionHeader
            title="Emergency queue"
            description="Ordered by severity, then by how long the driver has been waiting."
          />
          <Tabs
            value={filter}
            onValueChange={(value) => {
              setFilter(value as 'open' | 'all');
              setPage(1);
            }}
          >
            <TabsList>
              <TabsTrigger value="open">Needs action</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {alerts.data && alerts.data.items.length === 0 && filter === 'open' ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing open right now"
            description="Emergencies in your coverage area will appear here the moment they are raised, and everyone on the desk is notified."
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
            emptyTitle="No alerts yet"
            emptyDescription="This association has not received an emergency alert."
          />
        )}
      </div>

      {profile ? (
        <Card>
          <CardHeader className="pb-3">
            <SectionHeader
              title="Coverage"
              description="Alerts are matched geographically. An incident outside every area below never reaches this desk."
            />
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {profile.coverageAreas.map((area) => (
              <Badge key={area.id} variant="secondary" className="gap-1.5">
                <Users className="h-3 w-3" />
                {area.district}
                <span className="text-muted-foreground">· {area.radiusKm} km</span>
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default AssociationDashboardPage;
