import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  FileWarning,
  Gauge,
  LifeBuoy,
  Package,
  Route as RouteIcon,
  Truck,
  Users,
  Wrench,
} from 'lucide-react';
import {
  Feature,
  Permission,
  RealtimeChannel,
  RealtimeEvent,
  formatCompactCurrency,
  formatDistanceKm,
  formatNumber,
  humanizeEnum,
  relativeTimeFrom,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type {
  DashboardMetrics,
  DocumentSummary,
  LiveTruckPosition,
  OrderSummary,
  Paginated,
  TripSummary,
} from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useChannels, useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { StatCardsSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { FleetMap, type MapTruck } from '@/features/maps/fleet-map';
import { Stagger, StaggerItem } from '@/components/motion';
import { DailyBriefCard } from '@/features/ai/daily-brief-card';

/**
 * Fleet command centre.
 *
 * Every figure is served by /analytics/dashboard, which aggregates real rows.
 * Live positions and trip progress arrive over the WebSocket, so the board
 * moves without a refresh.
 */
export function DashboardPage() {
  const { session, can, hasFeature } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const organizationId = session?.organization?.id;

  useChannels(organizationId ? [RealtimeChannel.fleet(organizationId)] : []);

  const metrics = useQuery({
    queryKey: ['analytics', 'dashboard', organizationId],
    queryFn: () => api.get<DashboardMetrics>('/analytics/dashboard'),
    enabled: Boolean(organizationId) && can(Permission.ANALYTICS_READ),
    refetchInterval: 60_000,
  });

  const positions = useQuery({
    queryKey: ['tracking', 'fleet', organizationId],
    queryFn: () => api.get<LiveTruckPosition[]>('/tracking/fleet'),
    enabled: Boolean(organizationId) && can(Permission.TRACKING_READ) && hasFeature(Feature.TRACKING_LIVE),
    refetchInterval: 30_000,
  });

  const activeTrips = useQuery({
    queryKey: ['trips', 'active', organizationId],
    queryFn: () => api.get<TripSummary[]>('/trips/active'),
    enabled: Boolean(organizationId) && can(Permission.TRIPS_READ),
    refetchInterval: 45_000,
  });

  const openOrders = useQuery({
    queryKey: ['orders', 'recent', organizationId],
    queryFn: () =>
      api.get<Paginated<OrderSummary>>('/orders', { activeOnly: true, pageSize: 6 }),
    enabled: Boolean(organizationId) && can(Permission.ORDERS_READ),
  });

  const expiring = useQuery({
    queryKey: ['documents', 'expiring', organizationId],
    queryFn: () => api.get<DocumentSummary[]>('/documents/expiring', { withinDays: 30 }),
    enabled: Boolean(organizationId) && can(Permission.DOCUMENTS_READ),
  });

  // --- Live wiring ------------------------------------------------------
  const [livePositions, setLivePositions] = React.useState<Map<string, LiveTruckPosition>>(new Map());

  React.useEffect(() => {
    if (!positions.data) return;
    setLivePositions(new Map(positions.data.map((entry) => [entry.truckId, entry])));
  }, [positions.data]);

  useRealtimeEvent(RealtimeEvent.TRUCK_LOCATION, (message) => {
    setLivePositions((previous) => {
      const existing = previous.get(message.payload.truckId);
      if (!existing) return previous;
      const next = new Map(previous);
      next.set(message.payload.truckId, {
        ...existing,
        latitude: message.payload.latitude,
        longitude: message.payload.longitude,
        speedKph: message.payload.speedKph,
        heading: message.payload.heading,
        recordedAt: message.payload.recordedAt,
        stale: false,
      });
      return next;
    });
  });

  useRealtimeEvent(RealtimeEvent.TRUCK_STATUS, () => {
    void queryClient.invalidateQueries({ queryKey: ['tracking', 'fleet'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics', 'dashboard'] });
  });

  useRealtimeEvent(RealtimeEvent.TRIP_UPDATED, () => {
    void queryClient.invalidateQueries({ queryKey: ['trips'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics', 'dashboard'] });
  });

  const mapTrucks: MapTruck[] = React.useMemo(
    () =>
      [...livePositions.values()].map((position) => ({
        id: position.truckId,
        registrationNumber: position.registrationNumber,
        latitude: position.latitude,
        longitude: position.longitude,
        heading: position.heading,
        speedKph: position.speedKph,
        status: position.status,
        driverName: position.driver?.name ?? null,
        tripReference: position.trip?.reference ?? null,
        stale: position.stale,
        simulated: session?.demoMode ?? false,
      })),
    [livePositions, session?.demoMode],
  );

  if (!organizationId) {
    return (
      <EmptyState
        title="No organization selected"
        description="Your account is not linked to an organization yet."
      />
    );
  }

  const data = metrics.data;
  const revenueTrend =
    data && data.financial.revenuePreviousMonth > 0
      ? ((data.financial.revenueThisMonth - data.financial.revenuePreviousMonth) /
          data.financial.revenuePreviousMonth) *
        100
      : undefined;

  type AttentionItem = { tone: 'destructive' | 'warning'; icon: React.ComponentType<{ className?: string }>; label: string; to: string };
  const attentionCandidates: (AttentionItem | null)[] = data
    ? [
        data.safety.activeSosIncidents > 0 ? {
          tone: 'destructive' as const,
          icon: LifeBuoy,
          label: `${data.safety.activeSosIncidents} active SOS incident${data.safety.activeSosIncidents > 1 ? 's' : ''}`,
          to: '/sos',
        } : null,
        data.compliance.documentsExpired > 0 ? {
          tone: 'destructive' as const,
          icon: FileWarning,
          label: `${data.compliance.documentsExpired} expired document${data.compliance.documentsExpired > 1 ? 's' : ''}`,
          to: '/fleet/documents',
        } : null,
        data.compliance.maintenanceOverdue > 0 ? {
          tone: 'warning' as const,
          icon: Wrench,
          label: `${data.compliance.maintenanceOverdue} maintenance job${data.compliance.maintenanceOverdue > 1 ? 's' : ''} overdue`,
          to: '/fleet/maintenance',
        } : null,
        data.trips.delayed > 0 ? {
          tone: 'warning' as const,
          icon: AlertTriangle,
          label: `${data.trips.delayed} trip${data.trips.delayed > 1 ? 's' : ''} running late`,
          to: '/trips?activeOnly=true',
        } : null,
        data.compliance.documentsExpiringSoon > 0 ? {
          tone: 'warning' as const,
          icon: FileWarning,
          label: `${data.compliance.documentsExpiringSoon} document${data.compliance.documentsExpiringSoon > 1 ? 's' : ''} expiring within 30 days`,
          to: '/fleet/documents?filter=expiring',
        } : null,
      ]
    : [];
  const attention = attentionCandidates.filter((entry): entry is AttentionItem => entry !== null);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Live operational picture"
        title="Fleet command centre"
        description={session.organization?.name ?? 'Your fleet at a glance'}
        actions={
          <>
            {can(Permission.ORDERS_CREATE) ? (
              <Button variant="outline" onClick={() => navigate('/orders/new')}>
                <Package className="size-4" />
                New requirement
              </Button>
            ) : null}
            {session.demoMode && can(Permission.TRUCKS_UPDATE) ? (
              <Button onClick={() => navigate('/simulator')}>
                <Gauge className="size-4" />
                Run demo simulation
              </Button>
            ) : null}
          </>
        }
      />

      {/* What needs a human today, ranked by severity, each a link to the fix. */}
      {attention.length > 0 ? (
        <Stagger className="flex flex-wrap gap-2" delay={0.05}>
          {attention.map((item) => (
            <StaggerItem key={item.label}>
              <Link
                to={item.to}
                className={`group inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur-sm transition-all hover:-translate-y-0.5 ${
                  item.tone === 'destructive'
                    ? 'border-destructive/30 bg-destructive/8 text-destructive hover:bg-destructive/12 hover:shadow-glow-danger'
                    : 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15'
                }`}
              >
                <item.icon className="size-3.5" />
                {item.label}
                <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      ) : null}

      {/*
        The morning brief sits above the metrics: an operator opening this page
        wants to know what is wrong before they see how the month is going.
      */}
      <DailyBriefCard />

      {metrics.isLoading ? (
        <StatCardsSkeleton />
      ) : metrics.error ? (
        <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : data ? (
        <>
          <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StaggerItem>
              <StatCard
                label="Fleet"
                numericValue={data.fleet.totalTrucks}
                format={(value) => formatNumber(value)}
                icon={Truck}
                hint={`${data.fleet.onTrip} on trip · ${data.fleet.available} available`}
                onClick={() => navigate('/fleet/trucks')}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label="Utilisation"
                numericValue={data.fleet.utilizationPercent}
                format={(value) => `${Math.round(value)}%`}
                icon={Gauge}
                tone={data.fleet.utilizationPercent >= 60 ? 'success' : 'warning'}
                hint={`${data.fleet.idle} idle · ${data.fleet.maintenance} in workshop`}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label="Active trips"
                numericValue={data.trips.active}
                format={(value) => formatNumber(value)}
                icon={RouteIcon}
                tone={data.trips.delayed > 0 ? 'warning' : 'default'}
                live={data.trips.active > 0}
                hint={
                  data.trips.onTimePercent === null
                    ? 'No completed trips yet this month'
                    : `${data.trips.onTimePercent}% on time this month`
                }
                onClick={() => navigate('/trips')}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label="Revenue this month"
                numericValue={data.financial.revenueThisMonth}
                format={formatCompactCurrency}
                icon={Package}
                {...(revenueTrend !== undefined
                  ? { trend: { value: revenueTrend, label: 'vs last month' } }
                  : {})}
                hint={`Margin ${formatCompactCurrency(data.financial.grossMarginThisMonth)}`}
                onClick={() => navigate('/analytics')}
              />
            </StaggerItem>
          </Stagger>

          <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" delay={0.08}>
            <StaggerItem>
              <StatCard
                label="Drivers"
                numericValue={data.drivers.total}
                format={(value) => formatNumber(value)}
                icon={Users}
                hint={`${data.drivers.verified} verified · avg score ${data.drivers.averageScore ?? '—'}`}
                onClick={() => navigate('/fleet/drivers')}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label="Distance this month"
                numericValue={data.trips.totalDistanceThisMonthKm}
                format={formatDistanceKm}
                icon={RouteIcon}
                hint={`${data.trips.completedThisMonth} trips completed`}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label="Open orders"
                numericValue={data.orders.open}
                format={(value) => formatNumber(value)}
                icon={Package}
                hint={`${data.orders.inTransit} in transit`}
                onClick={() => navigate('/orders')}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label="Safety events"
                numericValue={data.safety.safetyEventsThisMonth}
                format={(value) => formatNumber(value)}
                icon={LifeBuoy}
                tone={data.safety.activeSosIncidents > 0 ? 'destructive' : 'default'}
                hint={`${data.safety.sosThisMonth} SOS this month`}
                onClick={() => navigate('/sos')}
              />
            </StaggerItem>
          </Stagger>
        </>
      ) : null}

      {can(Permission.TRACKING_READ) && hasFeature(Feature.TRACKING_LIVE) ? (
        <Card variant="glass" className="overflow-hidden">
          <CardHeader className="pb-3">
            <SectionHeader
              title={
                <span className="flex items-center gap-2">
                  Live fleet positions
                  {mapTrucks.length > 0 ? <span className="live-dot" aria-hidden /> : null}
                </span>
              }
              description={
                positions.isLoading
                  ? 'Loading positions…'
                  : `${mapTrucks.length} truck${mapTrucks.length === 1 ? '' : 's'} reporting${
                      session.demoMode ? ' · simulated GPS' : ''
                    }`
              }
              actions={
                <Button variant="outline" size="sm" asChild>
                  <Link to="/tracking">
                    Open live map
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              }
            />
          </CardHeader>
          <CardContent className="p-0">
            <FleetMap
              trucks={mapTrucks}
              allow3D={hasFeature(Feature.MAPS_3D)}
              height="clamp(320px, 42vh, 460px)"
              className="rounded-none border-0 border-t"
              onSelectTruck={(truckId) => navigate(`/fleet/trucks/${truckId}`)}
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card variant="glass">
          <CardHeader className="pb-3">
            <SectionHeader
              title="Trips in progress"
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/trips">View all</Link>
                </Button>
              }
            />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {activeTrips.isLoading ? (
              <LoadingState label="Loading trips…" />
            ) : (activeTrips.data ?? []).length === 0 ? (
              <EmptyState
                icon={RouteIcon}
                title="No trips in progress"
                description="Accepted orders will appear here once a trip is created."
                className="min-h-32 border-0 p-6"
              />
            ) : (
              (activeTrips.data ?? []).slice(0, 5).map((trip) => (
                <Link
                  key={trip.id}
                  to={`/trips/${trip.id}`}
                  className="block rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{trip.reference}</span>
                        <StatusBadge status={trip.status} size="sm" />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {trip.truck?.registrationNumber} · {trip.driver?.name ?? 'No driver'}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {trip.originAddress.split(',')[0]} → {trip.destinationAddress.split(',')[0]}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-sm font-semibold">{trip.progressPercent}%</p>
                      {trip.delayMinutes > 0 ? (
                        <p className="text-xs text-warning">+{trip.delayMinutes} min late</p>
                      ) : trip.etaAt ? (
                        <p className="text-xs text-muted-foreground">
                          ETA {relativeTimeFrom(trip.etaAt)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <Progress value={trip.progressPercent} className="mt-2.5 h-1.5" />
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card variant="glass">
            <CardHeader className="pb-3">
              <SectionHeader
                title="Orders needing action"
                actions={
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/orders">View all</Link>
                  </Button>
                }
              />
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {openOrders.isLoading ? (
                <LoadingState label="Loading orders…" />
              ) : (openOrders.data?.items ?? []).length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No open orders right now.
                </p>
              ) : (
                (openOrders.data?.items ?? []).map((order) => (
                  <Link
                    key={order.id}
                    to={`/orders/${order.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {order.materialName}{' '}
                        <span className="text-muted-foreground">
                          · {formatNumber(order.quantity)} {humanizeEnum(order.unit).toLowerCase()}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {order.reference} · {order.customerName}
                      </p>
                    </div>
                    <StatusBadge status={order.status} size="sm" />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          {(expiring.data ?? []).length > 0 ? (
            <Card variant="glass">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileWarning className="size-4 text-warning" />
                  Documents needing attention
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {(expiring.data ?? []).slice(0, 5).map((document) => (
                  <Link
                    key={document.id}
                    to="/fleet/documents"
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{document.documentTypeLabel}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {document.title ?? document.fileName}
                      </p>
                    </div>
                    <StatusBadge status={document.validity} size="sm" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {hasFeature(Feature.AI_COPILOT) ? (
            <Card className="border-primary/20 bg-primary/[0.03]">
              <CardContent className="flex items-center gap-4 p-5">
                <span className="rounded-lg bg-primary/10 p-2.5">
                  <Bot className="size-5 text-primary" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Ask the Fleet Copilot</p>
                  <p className="text-xs text-muted-foreground">
                    &ldquo;What needs my attention today?&rdquo; — answered from your own records.
                  </p>
                </div>
                <Button size="sm" asChild>
                  <Link to="/copilot">Open</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
