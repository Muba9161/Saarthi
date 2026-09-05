import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  Car,
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
  OrganizationType,
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
import type { BookingSummary } from '@/lib/mobility-types';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/features/i18n';
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
 * The operator's command centre — freight and passenger alike.
 *
 * Every figure is served by /analytics/dashboard, which aggregates real rows.
 * Live positions and trip progress arrive over the WebSocket, so the board
 * moves without a refresh.
 *
 * One screen serves both kinds of operator, because the questions barely
 * differ: what is out, who is driving it, what is late, what is due. Only the
 * commercial column changes — freight orders against passenger bookings — so
 * that column is chosen from the organization type and everything else is
 * shared. A second dashboard would have drifted from this one within a
 * release, and a mobility provider would have kept the worse copy.
 */
export function DashboardPage() {
  const { session, can, hasFeature } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const queryClient = useQueryClient();
  const organizationId = session?.organization?.id;
  // A taxi or tour operator sells seats, not tonnes. It holds the freight
  // permissions (it is an operating fleet), so the commercial half of this
  // board is chosen by what the organization *is*, not by what it may do.
  const isMobility = session?.organization?.type === OrganizationType.MOBILITY_PROVIDER;

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
    enabled:
      Boolean(organizationId) && can(Permission.TRACKING_READ) && hasFeature(Feature.TRACKING_LIVE),
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
    queryFn: () => api.get<Paginated<OrderSummary>>('/orders', { activeOnly: true, pageSize: 6 }),
    // Not fetched for a travel operator: it holds `orders.read` and would get
    // a valid, permanently empty page. An empty panel headed "Orders needing
    // action" reads as a broken feed, not as a business it does not run.
    enabled: Boolean(organizationId) && !isMobility && can(Permission.ORDERS_READ),
  });

  const openBookings = useQuery({
    queryKey: ['travel', 'bookings', 'provider', 'dashboard', organizationId],
    queryFn: () =>
      api.get<Paginated<BookingSummary>>('/travel/me/bookings', {
        activeOnly: true,
        pageSize: 6,
      }),
    enabled: Boolean(organizationId) && isMobility && can(Permission.BOOKINGS_READ),
  });

  const expiring = useQuery({
    queryKey: ['documents', 'expiring', organizationId],
    queryFn: () => api.get<DocumentSummary[]>('/documents/expiring', { withinDays: 30 }),
    enabled: Boolean(organizationId) && can(Permission.DOCUMENTS_READ),
  });

  // --- Live wiring ------------------------------------------------------
  const [livePositions, setLivePositions] = React.useState<Map<string, LiveTruckPosition>>(
    new Map(),
  );

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
        title={t('No organization selected')}
        description={t('Your account is not linked to an organization yet.')}
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

  type AttentionItem = {
    tone: 'destructive' | 'warning';
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    to: string;
  };
  const attentionCandidates: (AttentionItem | null)[] = data
    ? [
        data.safety.activeSosIncidents > 0
          ? {
              tone: 'destructive' as const,
              icon: LifeBuoy,
              label: `${data.safety.activeSosIncidents} active SOS incident${data.safety.activeSosIncidents > 1 ? 's' : ''}`,
              to: '/sos',
            }
          : null,
        data.compliance.documentsExpired > 0
          ? {
              tone: 'destructive' as const,
              icon: FileWarning,
              label: `${data.compliance.documentsExpired} expired document${data.compliance.documentsExpired > 1 ? 's' : ''}`,
              to: '/fleet/documents',
            }
          : null,
        data.compliance.maintenanceOverdue > 0
          ? {
              tone: 'warning' as const,
              icon: Wrench,
              label: `${data.compliance.maintenanceOverdue} maintenance job${data.compliance.maintenanceOverdue > 1 ? 's' : ''} overdue`,
              to: '/fleet/maintenance',
            }
          : null,
        // A booking request nobody has answered is a customer waiting on a
        // reply, which outranks a late trip: the trip is at least under way.
        data.travel && data.travel.awaitingConfirmation > 0
          ? {
              tone: 'warning' as const,
              icon: CalendarDays,
              label: `${data.travel.awaitingConfirmation} booking${data.travel.awaitingConfirmation > 1 ? 's' : ''} awaiting your confirmation`,
              to: '/travel/provider/bookings',
            }
          : null,
        data.trips.delayed > 0
          ? {
              tone: 'warning' as const,
              icon: AlertTriangle,
              label: `${data.trips.delayed} trip${data.trips.delayed > 1 ? 's' : ''} running late`,
              to: '/trips?activeOnly=true',
            }
          : null,
        data.compliance.documentsExpiringSoon > 0
          ? {
              tone: 'warning' as const,
              icon: FileWarning,
              label: `${data.compliance.documentsExpiringSoon} document${data.compliance.documentsExpiringSoon > 1 ? 's' : ''} expiring within 30 days`,
              to: '/fleet/documents?filter=expiring',
            }
          : null,
      ]
    : [];
  const attention = attentionCandidates.filter((entry): entry is AttentionItem => entry !== null);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('Live operational picture')}
        title={isMobility ? t('Travel command centre') : t('Fleet command centre')}
        description={
          session.organization?.name ??
          (isMobility ? t('Your operation at a glance') : t('Your fleet at a glance'))
        }
        actions={
          <>
            {/*
              The cross-category wizard when the account has it, and the
              freight-only form otherwise. The wizard is strictly the wider
              door — it still posts a transport requirement — so an account
              that can reach both should never be sent to the narrower one.
            */}
            {can(Permission.REQUIREMENTS_CREATE) ? (
              <Button variant="outline" onClick={() => navigate('/requirements/new')}>
                <Package className="size-4" />
                {t('New requirement')}
              </Button>
            ) : can(Permission.ORDERS_CREATE) ? (
              <Button variant="outline" onClick={() => navigate('/orders/new')}>
                <Package className="size-4" />
                {t('New requirement')}
              </Button>
            ) : null}
            {session.demoMode && can(Permission.TRUCKS_UPDATE) ? (
              <Button onClick={() => navigate('/simulator')}>
                <Gauge className="size-4" />
                {t('Run demo simulation')}
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
                label={isMobility ? t('Vehicles') : t('Fleet')}
                numericValue={data.fleet.totalTrucks}
                format={(value) => formatNumber(value)}
                icon={isMobility ? Car : Truck}
                hint={`${data.fleet.onTrip} on trip · ${data.fleet.available} available`}
                // A travel operator has no Trucks screen, so sending it there
                // would be a dead end inside its own command centre.
                onClick={() => navigate(isMobility ? '/fleet/vehicles' : '/fleet/trucks')}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('Utilisation')}
                numericValue={data.fleet.utilizationPercent}
                format={(value) => `${Math.round(value)}%`}
                icon={Gauge}
                tone={data.fleet.utilizationPercent >= 60 ? 'success' : 'warning'}
                hint={`${data.fleet.idle} idle · ${data.fleet.maintenance} in workshop`}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('Active trips')}
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
                label={t('Revenue this month')}
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
                label={t('Drivers')}
                numericValue={data.drivers.total}
                format={(value) => formatNumber(value)}
                icon={Users}
                hint={`${data.drivers.verified} verified · avg score ${data.drivers.averageScore ?? '—'}`}
                onClick={() => navigate('/fleet/drivers')}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('Distance this month')}
                numericValue={data.trips.totalDistanceThisMonthKm}
                format={formatDistanceKm}
                icon={RouteIcon}
                hint={`${data.trips.completedThisMonth} trips completed`}
              />
            </StaggerItem>
            <StaggerItem>
              {data.travel ? (
                <StatCard
                  label={t('Bookings to confirm')}
                  numericValue={data.travel.awaitingConfirmation}
                  format={(value) => formatNumber(value)}
                  icon={CalendarDays}
                  tone={data.travel.awaitingConfirmation > 0 ? 'warning' : 'default'}
                  hint={`${data.travel.upcoming} upcoming · ${data.travel.inProgress} under way`}
                  onClick={() => navigate('/travel/provider/bookings')}
                />
              ) : (
                <StatCard
                  label={t('Open orders')}
                  numericValue={data.orders.open}
                  format={(value) => formatNumber(value)}
                  icon={Package}
                  hint={`${data.orders.inTransit} in transit`}
                  onClick={() => navigate('/orders')}
                />
              )}
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('Safety events')}
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
                  {isMobility ? t('Live vehicle positions') : t('Live fleet positions')}
                  {mapTrucks.length > 0 ? <span className="live-dot" aria-hidden /> : null}
                </span>
              }
              description={
                positions.isLoading
                  ? 'Loading positions…'
                  : `${mapTrucks.length} ${isMobility ? 'vehicle' : 'truck'}${
                      mapTrucks.length === 1 ? '' : 's'
                    } reporting${session.demoMode ? ' · simulated GPS' : ''}`
              }
              actions={
                <Button variant="outline" size="sm" asChild>
                  <Link to="/tracking">
                    {t('Open live map')}
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
              onSelectTruck={(truckId) =>
                navigate(isMobility ? `/fleet/vehicles/${truckId}` : `/fleet/trucks/${truckId}`)
              }
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card variant="glass">
          <CardHeader className="pb-3">
            <SectionHeader
              title={t('Trips in progress')}
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/trips">View all</Link>
                </Button>
              }
            />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {activeTrips.isLoading ? (
              <LoadingState label={t('Loading trips…')} />
            ) : (activeTrips.data ?? []).length === 0 ? (
              <EmptyState
                icon={RouteIcon}
                title={t('No trips in progress')}
                description={
                  isMobility
                    ? t('Confirmed bookings will appear here once a vehicle is assigned.')
                    : t('Accepted orders will appear here once a trip is created.')
                }
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
          {/*
            The commercial column. A freight fleet works an order book; a
            travel operator works a booking sheet. Same position on the board,
            same shape of row — the operator's next decision, one click away.
          */}
          {isMobility ? (
            <Card variant="glass">
              <CardHeader className="pb-3">
                <SectionHeader
                  title={t('Bookings needing action')}
                  actions={
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/travel/provider/bookings">View all</Link>
                    </Button>
                  }
                />
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {openBookings.isLoading ? (
                  <LoadingState label={t('Loading bookings…')} />
                ) : (openBookings.data?.items ?? []).length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t('No bookings need attention right now.')}
                  </p>
                ) : (
                  (openBookings.data?.items ?? []).map((booking) => (
                    <Link
                      key={booking.id}
                      to={`/travel/bookings/${booking.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {booking.packageTitle}{' '}
                          <span className="text-muted-foreground">
                            · {formatNumber(booking.passengers)}{' '}
                            {booking.passengers === 1 ? 'passenger' : 'passengers'}
                          </span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {booking.reference} · {booking.contactName} ·{' '}
                          {relativeTimeFrom(booking.startDate)}
                        </p>
                      </div>
                      <StatusBadge status={booking.status} size="sm" />
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          ) : (
            <Card variant="glass">
              <CardHeader className="pb-3">
                <SectionHeader
                  title={t('Orders needing action')}
                  actions={
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/orders">View all</Link>
                    </Button>
                  }
                />
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {openOrders.isLoading ? (
                  <LoadingState label={t('Loading orders…')} />
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
                            · {formatNumber(order.quantity)}{' '}
                            {humanizeEnum(order.unit).toLowerCase()}
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
          )}

          {(expiring.data ?? []).length > 0 ? (
            <Card variant="glass">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileWarning className="size-4 text-warning" />
                  {t('Documents needing attention')}
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
                  <p className="text-sm font-medium">{t('Ask the Fleet Copilot')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('“What needs my attention today?” — answered from your own records.')}
                  </p>
                </div>
                <Button size="sm" asChild>
                  <Link to="/copilot">{t('Open')}</Link>
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
