import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  CircleCheck,
  FileWarning,
  Gauge,
  LifeBuoy,
  Package,
  Route as RouteIcon,
  Truck,
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
import { api, errorMessage } from '@/lib/api-client';
import type {
  DashboardMetrics,
  DocumentSummary,
  LiveTruckPosition,
  OrderSummary,
  Paginated,
  TripSummary,
  TruckSummary,
} from '@/lib/api-types';
import type { BookingSummary } from '@/lib/mobility-types';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/features/i18n';
import { useChannels, useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import {
  BentoGrid,
  BentoHero,
  BentoMetric,
  BentoMetrics,
  BentoPanel,
  BentoRow,
  BentoTile,
} from '@/components/common/bento';
import { toSeriesPoints } from '@/components/common/mini-chart';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { FleetMap, type MapTruck } from '@/features/maps/fleet-map';
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
 *
 * ## The arrangement
 *
 * This used to be a stack: two rows of four metric cards, a brief card, a row
 * of alert chips, then five panels. Fifteen floating surfaces, each drawing
 * its own edge, which is a list rather than a hierarchy — nothing on it is
 * bigger than anything else, so the eye has nowhere to land.
 *
 * It is now five tiles on a twelve-column bento, and every row closes at
 * twelve:
 *
 *   hero (4)   ·  needs you now (8)
 *   the figures, 4 x 2 (12)
 *   trips (4)  ·  live map (8)
 *   commercial (12)
 *
 * The eight metric cards became eight hairline-divided cells of one band. That
 * band spans the full width on purpose: a cell carries a label, a figure and
 * an 84px sparkline, so below roughly 240px the label wraps to three lines and
 * the figure breaks mid-number — which is exactly what happens if the same
 * eight cells are squeezed into two thirds of the board.
 *
 * The alert chips, the expiring-document list and the counted morning brief
 * became one "needs you now" column, and the Copilot strip folded into the
 * hero. Nothing was dropped: every figure, link and live subscription that was
 * on the old board is still on this one.
 */

/** A record the hero's reference field found. */
interface LookupHit {
  key: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'default' | 'info' | 'accent';
  title: string;
  subtitle: string;
  status: string;
}

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

  // --- The hero's reference field ---------------------------------------
  //
  // One field over the three books this account actually keeps, rather than
  // three search boxes on three screens. Each source is asked only when the
  // account may read it, so nothing here can 403; a single hit navigates
  // straight to the record, because typing a full reference is already an
  // unambiguous instruction and a one-row result list would just be a second
  // click.
  const [lookupValue, setLookupValue] = React.useState('');
  const [lookupTerm, setLookupTerm] = React.useState('');
  const [lookupHits, setLookupHits] = React.useState<LookupHit[] | null>(null);

  const lookup = useMutation({
    mutationFn: async (term: string): Promise<LookupHit[]> => {
      const sources: Promise<LookupHit[]>[] = [];

      if (can(Permission.TRIPS_READ)) {
        sources.push(
          api.get<Paginated<TripSummary>>('/trips', { search: term, pageSize: 4 }).then((page) =>
            page.items.map((trip) => ({
              key: `trip-${trip.id}`,
              to: `/trips/${trip.id}`,
              icon: RouteIcon,
              tone: 'default' as const,
              title: trip.reference,
              subtitle: `${trip.originAddress.split(',')[0]} → ${trip.destinationAddress.split(',')[0]}`,
              status: trip.status,
            })),
          ),
        );
      }

      if (isMobility && can(Permission.BOOKINGS_READ)) {
        sources.push(
          api
            .get<Paginated<BookingSummary>>('/travel/me/bookings', { search: term, pageSize: 4 })
            .then((page) =>
              page.items.map((booking) => ({
                key: `booking-${booking.id}`,
                to: `/travel/bookings/${booking.id}`,
                icon: CalendarDays,
                tone: 'accent' as const,
                title: booking.reference,
                subtitle: `${booking.packageTitle} · ${booking.contactName}`,
                status: booking.status,
              })),
            ),
        );
      } else if (can(Permission.ORDERS_READ)) {
        sources.push(
          api.get<Paginated<OrderSummary>>('/orders', { search: term, pageSize: 4 }).then((page) =>
            page.items.map((order) => ({
              key: `order-${order.id}`,
              to: `/orders/${order.id}`,
              icon: Package,
              tone: 'accent' as const,
              title: order.reference,
              subtitle: `${order.materialName} · ${order.customerName}`,
              status: order.status,
            })),
          ),
        );
      }

      if (can(Permission.TRUCKS_READ)) {
        sources.push(
          api.get<Paginated<TruckSummary>>('/trucks', { search: term, pageSize: 4 }).then((page) =>
            page.items.map((truck) => ({
              key: `truck-${truck.id}`,
              to: isMobility ? `/fleet/vehicles/${truck.id}` : `/fleet/trucks/${truck.id}`,
              icon: Truck,
              tone: 'info' as const,
              title: truck.registrationNumber,
              subtitle:
                [truck.manufacturer, truck.model].filter(Boolean).join(' ') || truck.truckType,
              status: truck.status,
            })),
          ),
        );
      }

      const groups = await Promise.all(sources);
      return groups.flat().slice(0, 6);
    },
    onSuccess: (hits) => {
      const only = hits.length === 1 ? hits[0] : undefined;
      if (only) {
        setLookupValue('');
        setLookupHits(null);
        navigate(only.to);
        return;
      }
      setLookupHits(hits);
    },
    onError: (error) =>
      toast.error(t('Could not run that search'), { description: errorMessage(error) }),
  });

  const runLookup = () => {
    const term = lookupValue.trim();
    if (term.length === 0) return;
    setLookupTerm(term);
    lookup.mutate(term);
  };

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

  /**
   * The fortnight each tile draws beside its figure.
   *
   * Empty arrays when the API has not sent trends — an older build, or a
   * response still in cache from before this field existed. The tiles then
   * draw nothing rather than a shape standing in for missing history.
   */
  const trends = data?.trends ?? {
    days: [],
    fleetSize: [],
    utilizationPercent: [],
    tripsStarted: [],
    tripsCompleted: [],
    distanceKm: [],
    revenue: [],
    driverCount: [],
    ordersCreated: [],
    safetyEvents: [],
    bookingsCreated: null,
  };

  const revenueTrend =
    data && data.financial.revenuePreviousMonth > 0
      ? ((data.financial.revenueThisMonth - data.financial.revenuePreviousMonth) /
          data.financial.revenuePreviousMonth) *
        100
      : undefined;

  /**
   * What needs a human today, ranked by severity.
   *
   * These were pills floating above the board. As pills they were unreadable
   * at a glance — six of them wrapped to three lines of coloured text with no
   * order the eye could follow — and they occupied the position that should
   * belong to the most important tile. They are rows in a column now, in the
   * same order, each still a link to the screen that fixes it.
   */
  type AttentionItem = {
    tone: 'destructive' | 'warning';
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    detail: string;
    to: string;
  };
  const attentionCandidates: (AttentionItem | null)[] = data
    ? [
        data.safety.activeSosIncidents > 0
          ? {
              tone: 'destructive' as const,
              icon: LifeBuoy,
              title: `${data.safety.activeSosIncidents} active SOS incident${data.safety.activeSosIncidents > 1 ? 's' : ''}`,
              detail: t('Someone is waiting on a response right now'),
              to: '/sos',
            }
          : null,
        data.compliance.documentsExpired > 0
          ? {
              tone: 'destructive' as const,
              icon: FileWarning,
              title: `${data.compliance.documentsExpired} expired document${data.compliance.documentsExpired > 1 ? 's' : ''}`,
              detail: t('A vehicle on the road against a lapsed paper is a stopped vehicle'),
              to: '/fleet/documents',
            }
          : null,
        data.compliance.maintenanceOverdue > 0
          ? {
              tone: 'warning' as const,
              icon: Wrench,
              title: `${data.compliance.maintenanceOverdue} maintenance job${data.compliance.maintenanceOverdue > 1 ? 's' : ''} overdue`,
              detail: t('Past the due date on the service schedule'),
              to: '/fleet/maintenance',
            }
          : null,
        // A booking request nobody has answered is a customer waiting on a
        // reply, which outranks a late trip: the trip is at least under way.
        data.travel && data.travel.awaitingConfirmation > 0
          ? {
              tone: 'warning' as const,
              icon: CalendarDays,
              title: `${data.travel.awaitingConfirmation} booking${data.travel.awaitingConfirmation > 1 ? 's' : ''} awaiting confirmation`,
              detail: t('A customer has asked and not yet been answered'),
              to: '/travel/provider/bookings',
            }
          : null,
        data.trips.delayed > 0
          ? {
              tone: 'warning' as const,
              icon: AlertTriangle,
              title: `${data.trips.delayed} trip${data.trips.delayed > 1 ? 's' : ''} running late`,
              detail: t('Behind the planned arrival'),
              to: '/trips?activeOnly=true',
            }
          : null,
        data.compliance.documentsExpiringSoon > 0
          ? {
              tone: 'warning' as const,
              icon: FileWarning,
              title: `${data.compliance.documentsExpiringSoon} document${data.compliance.documentsExpiringSoon > 1 ? 's' : ''} expiring within 30 days`,
              detail: t('Renew before the vehicle is grounded'),
              to: '/fleet/documents?filter=expiring',
            }
          : null,
      ]
    : [];
  const attention = attentionCandidates.filter((entry): entry is AttentionItem => entry !== null);
  const expiringDocuments = expiring.data ?? [];

  const trips = activeTrips.data ?? [];
  const [featuredTrip, ...remainingTrips] = trips;

  const showMap = can(Permission.TRACKING_READ) && hasFeature(Feature.TRACKING_LIVE);
  /*
   * Without the live map, the trip list and the commercial column pair up to
   * close the row the map would have finished. Every row of this board sums to
   * twelve in both arrangements; a tile left half-alone is what makes a bento
   * look like it lost something.
   */
  const tripsSpan = showMap ? 4 : 6;
  const commercialSpan = showMap ? 12 : 6;

  const createRequirement = can(Permission.REQUIREMENTS_CREATE)
    ? '/requirements/new'
    : can(Permission.ORDERS_CREATE)
      ? '/orders/new'
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('Live operational picture')}
        title={isMobility ? t('Travel command centre') : t('Fleet command centre')}
        description={
          session.organization?.name ??
          (isMobility ? t('Your operation at a glance') : t('Your fleet at a glance'))
        }
      />

      <BentoGrid>
        {/* ---------------------------------------------------- row 1 --- */}

        <BentoHero
          span={4}
          eyebrow={t('Start here')}
          title={isMobility ? t('Find a booking or a vehicle') : t('Find a consignment')}
          description={t('Enter a reference or a vehicle number and Saarthi opens the record.')}
          lookup={{
            label: t('Search by reference or vehicle number'),
            placeholder: isMobility ? 'BKG-1042' : 'TRP-1042',
            value: lookupValue,
            onChange: (value) => {
              setLookupValue(value);
              // A result list under a field the operator has since retyped is
              // an answer to a question they are no longer asking.
              if (lookupHits !== null) setLookupHits(null);
            },
            onSubmit: runLookup,
            pending: lookup.isPending,
            results:
              lookupHits === null ? null : lookupHits.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  {t('Nothing matches')} “{lookupTerm}”.
                </p>
              ) : (
                <div className="space-y-0.5 rounded-xl bg-card/70 p-1 ring-1 ring-border/70">
                  {lookupHits.map((hit) => (
                    <BentoRow
                      key={hit.key}
                      to={hit.to}
                      icon={hit.icon}
                      tone={hit.tone}
                      title={hit.title}
                      subtitle={hit.subtitle}
                      trailing={<StatusBadge status={hit.status} size="sm" />}
                    />
                  ))}
                </div>
              ),
          }}
          action={
            <>
              {/*
                The cross-category wizard when the account has it, and the
                freight-only form otherwise. The wizard is strictly the wider
                door — it still posts a transport requirement — so an account
                that can reach both should never be sent to the narrower one.
              */}
              {createRequirement ? (
                <Button asChild>
                  <Link to={createRequirement}>
                    <Package className="size-4" />
                    {t('New requirement')}
                  </Link>
                </Button>
              ) : null}
              {session.demoMode && can(Permission.TRUCKS_UPDATE) ? (
                <Button variant="outline" asChild>
                  <Link to="/simulator">
                    <Gauge className="size-4" />
                    {t('Run demo simulation')}
                  </Link>
                </Button>
              ) : null}
            </>
          }
          footer={
            hasFeature(Feature.AI_COPILOT) ? (
              <Link
                to="/copilot"
                className="group inline-flex items-center gap-2 text-xs font-medium text-primary"
              >
                <Bot className="size-3.5" />
                {t('Ask the Copilot what needs your attention')}
                <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ) : null
          }
        />

        {/*
          One column for everything that wants a person today, ranked. These
          were pills floating above the board: unreadable at a glance, six of
          them wrapping to three lines of coloured text, and occupying the
          position that should belong to the most important tile.
        */}
        {/*
          One column for everything that is wrong, ranked. The derived alerts
          come first because each is a count the operator can act on in one
          click; the individual expiring papers follow, because a name and a
          date is what turns "4 documents" into a morning's work.
        */}
        <BentoPanel
          span={8}
          title={t('Needs you now')}
          description={
            attention.length > 0
              ? `${attention.length} ${attention.length === 1 ? t('thing') : t('things')} ${t('ranked by severity')}`
              : t('Ranked by severity')
          }
          bodyClassName="max-h-[28rem] space-y-1"
        >
          {attention.length === 0 && expiringDocuments.length === 0 ? (
            <BentoRow
              icon={CircleCheck}
              tone="success"
              title={t('Nothing needs attention')}
              subtitle={t('No open incident, no lapsed paper, no overdue work.')}
            />
          ) : (
            <>
              {attention.map((item) => (
                <BentoRow
                  key={item.title}
                  to={item.to}
                  icon={item.icon}
                  tone={item.tone}
                  title={item.title}
                  subtitle={item.detail}
                  trailing={<ArrowRight className="size-3.5 text-muted-foreground" />}
                />
              ))}

              {expiringDocuments.length > 0 ? (
                <div className="space-y-1 pt-2">
                  <p className="section-label px-2.5 pt-1">{t('Papers coming due')}</p>
                  {expiringDocuments.slice(0, 5).map((document) => (
                    <BentoRow
                      key={document.id}
                      to="/fleet/documents"
                      icon={FileWarning}
                      tone="muted"
                      title={document.documentTypeLabel}
                      subtitle={document.title ?? document.fileName}
                      trailing={<StatusBadge status={document.validity} size="sm" />}
                    />
                  ))}
                </div>
              ) : null}
            </>
          )}

          {/*
            The counted brief, under the alerts this board derives for itself.
            They are the same morning's work — an expired document is in both —
            so they belong in one column: two panels a row apart, each asking
            for attention in its own voice, is how an operator learns to read
            neither.
          */}
          {can(Permission.ANALYTICS_READ) ? (
            <div className="space-y-1 border-t border-border/70 pt-3">
              <p className="section-label px-2.5">{t('Counted this morning')}</p>
              <DailyBriefCard bare />
            </div>
          ) : null}
        </BentoPanel>

        {/* ---------------------------------------------------- row 2 --- */}

        {/*
          The whole of the month in one band. Eight cells across the full
          content width rather than eight cards: at this width four fit per
          row with room for the label, the figure and its fortnight, which is
          exactly what eight separate panels could not do without either
          shrinking the figure or wrapping the label onto three lines.
        */}
        {metrics.isLoading ? (
          <BentoTile span={12}>
            <div
              className="-mb-px -mr-px grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
              role="status"
              aria-label={t('Loading')}
            >
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-3 border-b border-r border-border/60 p-5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </BentoTile>
        ) : metrics.error ? (
          <BentoTile span={12}>
            <div className="p-5">
              <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
            </div>
          </BentoTile>
        ) : data ? (
          <BentoMetrics span={12} columns={4}>
            <BentoMetric
              label={isMobility ? t('Vehicles') : t('Fleet')}
              numericValue={data.fleet.totalTrucks}
              format={(value) => formatNumber(value)}
              chart={{
                kind: 'area',
                points: toSeriesPoints(trends.fleetSize),
                format: (value) => formatNumber(value),
              }}
              hint={`${data.fleet.onTrip} on trip · ${data.fleet.available} available`}
              // A travel operator has no Trucks screen, so sending it there
              // would be a dead end inside its own command centre.
              onClick={() => navigate(isMobility ? '/fleet/vehicles' : '/fleet/trucks')}
            />
            <BentoMetric
              label={t('Utilisation')}
              numericValue={data.fleet.utilizationPercent}
              format={(value) => `${Math.round(value)}%`}
              chart={{
                kind: 'area',
                points: toSeriesPoints(trends.utilizationPercent),
                format: (value) => `${value}%`,
                domainMax: 100,
              }}
              tone={data.fleet.utilizationPercent >= 60 ? 'success' : 'warning'}
              hint={`${data.fleet.idle} idle · ${data.fleet.maintenance} in workshop`}
            />
            <BentoMetric
              label={t('Active trips')}
              numericValue={data.trips.active}
              format={(value) => formatNumber(value)}
              chart={{
                kind: 'bars',
                points: toSeriesPoints(trends.tripsStarted),
                format: (value) => `${formatNumber(value)} started`,
              }}
              tone={data.trips.delayed > 0 ? 'warning' : 'default'}
              live={data.trips.active > 0}
              hint={
                data.trips.onTimePercent === null
                  ? t('No completed trips yet this month')
                  : `${data.trips.onTimePercent}% on time this month`
              }
              onClick={() => navigate('/trips')}
            />
            <BentoMetric
              label={t('Revenue this month')}
              numericValue={data.financial.revenueThisMonth}
              format={formatCompactCurrency}
              chart={{
                kind: 'area',
                points: toSeriesPoints(trends.revenue),
                format: formatCompactCurrency,
              }}
              {...(revenueTrend !== undefined
                ? { trend: { value: revenueTrend, label: 'vs last month' } }
                : {})}
              hint={`Margin ${formatCompactCurrency(data.financial.grossMarginThisMonth)}`}
              onClick={() => navigate('/analytics')}
            />
            <BentoMetric
              label={t('Drivers')}
              numericValue={data.drivers.total}
              format={(value) => formatNumber(value)}
              chart={{
                kind: 'area',
                points: toSeriesPoints(trends.driverCount),
                format: (value) => formatNumber(value),
              }}
              hint={`${data.drivers.verified} verified · avg score ${data.drivers.averageScore ?? '—'}`}
              onClick={() => navigate('/fleet/drivers')}
            />
            <BentoMetric
              label={t('Distance this month')}
              numericValue={data.trips.totalDistanceThisMonthKm}
              format={formatDistanceKm}
              chart={{
                kind: 'bars',
                points: toSeriesPoints(trends.distanceKm),
                format: formatDistanceKm,
              }}
              hint={`${data.trips.completedThisMonth} trips completed`}
            />
            {data.travel ? (
              <BentoMetric
                label={t('Bookings to confirm')}
                numericValue={data.travel.awaitingConfirmation}
                format={(value) => formatNumber(value)}
                chart={{
                  kind: 'bars',
                  points: toSeriesPoints(trends.bookingsCreated ?? []),
                  format: (value) => `${formatNumber(value)} taken`,
                }}
                tone={data.travel.awaitingConfirmation > 0 ? 'warning' : 'default'}
                hint={`${data.travel.upcoming} upcoming · ${data.travel.inProgress} under way`}
                onClick={() => navigate('/travel/provider/bookings')}
              />
            ) : (
              <BentoMetric
                label={t('Open orders')}
                numericValue={data.orders.open}
                format={(value) => formatNumber(value)}
                chart={{
                  kind: 'bars',
                  points: toSeriesPoints(trends.ordersCreated),
                  format: (value) => `${formatNumber(value)} raised`,
                }}
                hint={`${data.orders.inTransit} in transit`}
                onClick={() => navigate('/orders')}
              />
            )}
            <BentoMetric
              label={t('Safety events')}
              numericValue={data.safety.safetyEventsThisMonth}
              format={(value) => formatNumber(value)}
              chart={{
                kind: 'bars',
                points: toSeriesPoints(trends.safetyEvents),
                format: (value) => `${formatNumber(value)} events`,
              }}
              tone={data.safety.activeSosIncidents > 0 ? 'destructive' : 'default'}
              hint={`${data.safety.sosThisMonth} SOS this month`}
              onClick={() => navigate('/sos')}
            />
          </BentoMetrics>
        ) : null}

        {/* ---------------------------------------------------- row 3 --- */}

        {/*
          Trips in progress, with the first one opened out.

          A list of five equal rows makes the operator read all five to find
          the one that matters; the leading trip is the one a dispatcher is
          most often asked about, so it shows its route, its position along
          that route and who is driving it, and the rest stay as one line each.
        */}
        <BentoPanel
          span={tripsSpan}
          title={t('Trips in progress')}
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/trips">{t('View all')}</Link>
            </Button>
          }
          bodyClassName="max-h-[28rem] space-y-1"
        >
          {activeTrips.isLoading ? (
            <LoadingState label={t('Loading trips…')} />
          ) : !featuredTrip ? (
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
            <>
              <Link
                to={`/trips/${featuredTrip.id}`}
                className="block rounded-xl bg-muted/40 p-3.5 transition-colors hover:bg-muted/70"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold">{featuredTrip.reference}</span>
                  <StatusBadge status={featuredTrip.status} size="sm" />
                </div>

                {/*
                  Pickup over drop, not pickup beside drop. This column is
                  about 220px on a laptop, and a two-ended strip splits that
                  into two 50px halves — enough for "Pun…" and "Mum…". Stacked,
                  each end gets the full width, and the run of the connector
                  still carries the order they happen in.
                */}
                <div className="relative mt-3 space-y-2.5 pl-5">
                  <span
                    className="absolute left-[5px] top-2 h-[calc(100%-1rem)] w-px bg-gradient-to-b from-success via-border to-destructive"
                    aria-hidden
                  />
                  <div className="relative">
                    <span className="absolute -left-5 top-1 size-2.5 rounded-full bg-success ring-2 ring-card" />
                    <p className="section-label">{t('Pickup')}</p>
                    <p className="truncate text-xs font-medium">
                      {featuredTrip.originAddress.split(',')[0]}
                    </p>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-5 top-1 size-2.5 rounded-full bg-destructive ring-2 ring-card" />
                    <p className="section-label">{t('Drop')}</p>
                    <p className="truncate text-xs font-medium">
                      {featuredTrip.destinationAddress.split(',')[0]}
                    </p>
                  </div>
                </div>

                <Progress value={featuredTrip.progressPercent} className="mt-3 h-1.5" />

                <div className="mt-3 flex items-end justify-between gap-3 border-t border-border/70 pt-2.5">
                  <div className="min-w-0">
                    <p className="section-label">{t('Vehicle & driver')}</p>
                    <p className="truncate text-xs font-medium">
                      {featuredTrip.truck?.registrationNumber ?? t('Unassigned')} ·{' '}
                      {featuredTrip.driver?.name ?? t('No driver')}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-sm font-semibold">{featuredTrip.progressPercent}%</p>
                    {featuredTrip.delayMinutes > 0 ? (
                      <p className="text-xs text-warning">
                        +{featuredTrip.delayMinutes} {t('min late')}
                      </p>
                    ) : featuredTrip.etaAt ? (
                      <p className="text-xs text-muted-foreground">
                        ETA {relativeTimeFrom(featuredTrip.etaAt)}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Link>

              {remainingTrips.slice(0, 4).map((trip) => (
                <BentoRow
                  key={trip.id}
                  to={`/trips/${trip.id}`}
                  icon={RouteIcon}
                  tone={trip.delayMinutes > 0 ? 'warning' : 'default'}
                  title={trip.reference}
                  subtitle={`${trip.originAddress.split(',')[0]} → ${trip.destinationAddress.split(',')[0]}`}
                  trailing={
                    <span className="tabular text-xs font-semibold">{trip.progressPercent}%</span>
                  }
                />
              ))}
            </>
          )}
        </BentoPanel>

        {showMap ? (
          <BentoTile span={8}>
            <div className="shrink-0 px-5 pb-3 pt-5">
              <SectionHeader
                title={
                  <span className="flex items-center gap-2">
                    {isMobility ? t('Live vehicle positions') : t('Live fleet positions')}
                    {mapTrucks.length > 0 ? <span className="live-dot" aria-hidden /> : null}
                  </span>
                }
                description={
                  positions.isLoading
                    ? t('Loading positions…')
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
            </div>
            <div className="min-h-0 flex-1">
              <FleetMap
                trucks={mapTrucks}
                allow3D={hasFeature(Feature.MAPS_3D)}
                height="clamp(320px, 44vh, 470px)"
                className="rounded-none border-0 border-t"
                onSelectTruck={(truckId) =>
                  navigate(isMobility ? `/fleet/vehicles/${truckId}` : `/fleet/trucks/${truckId}`)
                }
              />
            </div>
          </BentoTile>
        ) : null}

        {/* ---------------------------------------------------- row 4 --- */}

        {/*
          The commercial column. A freight fleet works an order book; a travel
          operator works a booking sheet. Same position on the board, same
          shape of row — the operator's next decision, one click away.
        */}
        {isMobility ? (
          <BentoPanel
            span={commercialSpan}
            title={t('Bookings needing action')}
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/travel/provider/bookings">{t('View all')}</Link>
              </Button>
            }
            bodyClassName="max-h-[28rem] space-y-1"
          >
            {openBookings.isLoading ? (
              <LoadingState label={t('Loading bookings…')} />
            ) : (openBookings.data?.items ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t('No bookings need attention right now.')}
              </p>
            ) : (
              (openBookings.data?.items ?? []).map((booking) => (
                <BentoRow
                  key={booking.id}
                  to={`/travel/bookings/${booking.id}`}
                  icon={CalendarDays}
                  tone="accent"
                  title={`${booking.packageTitle} · ${formatNumber(booking.passengers)} ${
                    booking.passengers === 1 ? t('passenger') : t('passengers')
                  }`}
                  subtitle={`${booking.reference} · ${booking.contactName} · ${relativeTimeFrom(booking.startDate)}`}
                  trailing={<StatusBadge status={booking.status} size="sm" />}
                />
              ))
            )}
          </BentoPanel>
        ) : (
          <BentoPanel
            span={commercialSpan}
            title={t('Orders needing action')}
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/orders">{t('View all')}</Link>
              </Button>
            }
            bodyClassName="max-h-[28rem] space-y-1"
          >
            {openOrders.isLoading ? (
              <LoadingState label={t('Loading orders…')} />
            ) : (openOrders.data?.items ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t('No open orders right now.')}
              </p>
            ) : (
              (openOrders.data?.items ?? []).map((order) => (
                <BentoRow
                  key={order.id}
                  to={`/orders/${order.id}`}
                  icon={Package}
                  tone="accent"
                  title={`${order.materialName} · ${formatNumber(order.quantity)} ${humanizeEnum(order.unit).toLowerCase()}`}
                  subtitle={`${order.reference} · ${order.customerName}`}
                  trailing={<StatusBadge status={order.status} size="sm" />}
                />
              ))
            )}
          </BentoPanel>
        )}
      </BentoGrid>
    </div>
  );
}

export default DashboardPage;
