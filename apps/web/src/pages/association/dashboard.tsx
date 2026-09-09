import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, MapPin, ShieldCheck, Users } from 'lucide-react';
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
import { toSeriesPoints } from '@/components/common/mini-chart';
import { DataView } from '@/components/common/data-view';
import { type Column } from '@/components/common/data-table';
import {
  BentoGrid,
  BentoHero,
  BentoMetric,
  BentoMetrics,
  BentoPanel,
  BentoTile,
} from '@/components/common/bento';
import { EmptyState, UnauthorizedState } from '@/components/common/states';
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
 *
 * ## The arrangement
 *
 * Four tiles on the same bento the rest of the product uses. The two standing
 * banners this board used to carry — verification pending, alerts past their
 * window — are now the hero's status and its footer, because a banner that is
 * present every morning stops being read by the second week, and because the
 * desk's own state is the first thing the person opening it needs.
 *
 *   desk status (4)  ·  this desk (8)
 *   the figures (12)
 *   emergency queue (12)
 *
 * The queue is the one tile that brings its own surface — a data table already
 * draws a panel, and a second one around it gives every alert two edges.
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
  const unverified = profile !== undefined && profile.verificationStatus !== 'VERIFIED';

  /** A count as a share of everything still open in the coverage area. */
  const openShare = (count: number | undefined): number =>
    stats && stats.open > 0 ? ((count ?? 0) / stats.open) * 100 : 0;

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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Saarthi Safety"
        title={profile?.name ?? 'Association desk'}
        description={
          profile
            ? `${profile.district}, ${profile.state} · ${profile.coverageAreas.length} coverage area(s)${
                profile.memberTruckCount
                  ? ` · ${profile.memberTruckCount.toLocaleString('en-IN')} member trucks`
                  : ''
              }`
            : 'District emergency coordination.'
        }
      />

      <BentoGrid>
        {/* ---------------------------------------------------- row 1 --- */}

        {/*
          The desk's own state, which used to be a badge in the page header and
          two standing banners below it. Whether this desk is reachable at all
          is the first question, so it is the first tile.
        */}
        <BentoHero
          span={4}
          eyebrow="Desk status"
          title={
            unverified
              ? 'Verification pending'
              : profile?.acceptingAlerts === false
                ? 'Alerts paused'
                : 'Accepting alerts'
          }
          description={
            unverified
              ? 'Saarthi routes emergencies only to verified associations. Until this account is verified no alerts arrive here — deliberately: driver locations and contact numbers are not shared with unverified bodies.'
              : profile?.acceptingAlerts === false
                ? 'Nothing is being routed to this desk. Emergencies in your area are going to the next association instead.'
                : 'Emergencies inside your coverage area reach this desk the moment they are raised, and everyone signed in is notified.'
          }
          action={
            <>
              {unverified ? (
                <Button asChild>
                  <Link to="/verification">
                    <ShieldCheck className="size-4" />
                    Complete verification
                  </Link>
                </Button>
              ) : null}
              {can(Permission.NEARBY_READ) ? (
                <Button variant={unverified ? 'outline' : 'default'} asChild>
                  <Link to="/nearby">
                    <MapPin className="size-4" />
                    Nearby services
                  </Link>
                </Button>
              ) : null}
            </>
          }
          footer={
            stats && stats.overdue > 0 ? (
              <div className="flex items-start gap-2.5 rounded-xl bg-destructive/8 p-3 ring-1 ring-destructive/25">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0 text-xs">
                  <p className="font-medium text-destructive">
                    {stats.overdue} alert{stats.overdue === 1 ? '' : 's'} past the response window
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    A driver is waiting at the roadside. Acknowledge the alert to take the case and
                    see their contact number.
                  </p>
                </div>
              </div>
            ) : null
          }
        />

        {/*
          The record and the reach, in one column. They answer the same
          question from two sides — how well this desk responds, and to what —
          and neither was ever worth a panel of its own.
        */}
        {profile ? (
          <BentoPanel
            span={8}
            title="This desk"
            description="Measured from alert arrival to acknowledgement by a named member."
            bodyClassName="space-y-5"
          >
            {profile.stats.alertsReceived > 0 ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 xl:grid-cols-4">
                <div>
                  <dt className="section-label">Received</dt>
                  <dd className="tabular text-lg font-semibold">{profile.stats.alertsReceived}</dd>
                </div>
                <div>
                  <dt className="section-label">Acknowledged</dt>
                  <dd className="tabular text-lg font-semibold">
                    {profile.stats.alertsAcknowledged}
                  </dd>
                </div>
                <div>
                  <dt className="section-label">Resolved</dt>
                  <dd className="tabular text-lg font-semibold">{profile.stats.alertsResolved}</dd>
                </div>
                <div>
                  <dt className="section-label">Median response</dt>
                  <dd className="tabular text-lg font-semibold">
                    {profile.stats.avgResponseMinutes === null
                      ? '—'
                      : `${profile.stats.avgResponseMinutes} min`}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                No alert has reached this desk yet, so there is no response record to show.
              </p>
            )}

            <div className="space-y-2 border-t border-border/70 pt-4">
              <p className="section-label">Coverage</p>
              <p className="text-xs text-muted-foreground">
                Alerts are matched geographically. An incident outside every area below never
                reaches this desk.
              </p>
              <div className="flex flex-wrap gap-2 pt-0.5">
                {profile.coverageAreas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No coverage area is registered.</p>
                ) : (
                  profile.coverageAreas.map((area) => (
                    <Badge key={area.id} variant="secondary" className="gap-1.5">
                      <Users className="h-3 w-3" />
                      {area.district}
                      <span className="text-muted-foreground">· {area.radiusKm} km</span>
                    </Badge>
                  ))
                )}
              </div>
            </div>
          </BentoPanel>
        ) : null}

        {/* ---------------------------------------------------- row 2 --- */}

        {/*
          The figures across the full width. A metric cell carries a label, a
          figure and an 84px chart, so it wants around 240px — which two
          thirds of the board does not give it at a laptop width.
        */}
        <BentoMetrics span={12} columns={4}>
          <BentoMetric
            label="Open alerts"
            numericValue={stats?.open ?? 0}
            format={(value) => String(Math.round(value))}
            chart={{
              kind: 'bars',
              points: toSeriesPoints(stats?.trends.raised ?? []),
              format: (value) => `${value} raised`,
            }}
            tone={stats && stats.open > 0 ? 'warning' : 'default'}
            live
          />
          <BentoMetric
            label="Critical"
            numericValue={stats?.critical ?? 0}
            format={(value) => String(Math.round(value))}
            chart={{
              kind: 'gauge',
              percent: openShare(stats?.critical),
              caption: 'of the open alerts',
            }}
            tone={stats && stats.critical > 0 ? 'destructive' : 'default'}
            hint="Accident, security or medical"
          />
          <BentoMetric
            label="Awaiting acknowledgement"
            numericValue={stats?.unacknowledged ?? 0}
            format={(value) => String(Math.round(value))}
            chart={{
              kind: 'split',
              segments: [
                {
                  label: 'Awaiting acknowledgement',
                  value: stats?.unacknowledged ?? 0,
                  tone: 'warning',
                },
                { label: 'Responding', value: stats?.responding ?? 0, tone: 'info' },
              ],
            }}
            tone={stats && stats.overdue > 0 ? 'destructive' : 'default'}
            {...(stats && stats.overdue > 0
              ? { hint: `${stats.overdue} past the response window` }
              : {})}
          />
          <BentoMetric
            label="Resolved today"
            numericValue={stats?.resolvedToday ?? 0}
            format={(value) => String(Math.round(value))}
            chart={{
              kind: 'bars',
              points: toSeriesPoints(stats?.trends.resolved ?? []),
              format: (value) => `${value} resolved`,
            }}
            tone="success"
          />
        </BentoMetrics>

        {/* ---------------------------------------------------- row 3 --- */}

        {/*
          The queue is the one tile that brings its own surface: a data table
          already draws a panel, and wrapping it in a second one gives the row
          of alerts two edges and two shadows. The heading sits on the canvas
          above it instead, which is what the rest of the product does wherever
          a table is the whole of a section.
        */}
        <BentoTile span={12} plain className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 px-1">
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
            <DataView
              surface="association.alerts"
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
        </BentoTile>
      </BentoGrid>
    </div>
  );
}

export default AssociationDashboardPage;
