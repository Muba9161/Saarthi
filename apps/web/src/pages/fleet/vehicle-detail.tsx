import * as React from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Car,
  MoreHorizontal,
  Route as RouteIcon,
  ShieldAlert,
  UserPlus,
  UserMinus,
  Users,
  Weight,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Feature,
  OrganizationType,
  Permission,
  VehicleCapability,
  formatCompactCurrency,
  formatCurrency,
  formatDistanceKm,
  formatNumber,
  formatRegistrationNumber,
  humanizeEnum,
  relativeTimeFrom,
  vehicleTypeDefinition,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { DriverSummary, Paginated, TruckPassport } from '@/lib/api-types';
import type { VehicleSummary } from '@/lib/mobility-types';
import { useAuth } from '@/features/auth/auth-context';
import { SectionHeader } from '@/components/common/page-header';
import { VerifyButton } from '@/features/verification/verify-button';
import { BentoGrid, BentoMetric, BentoMetrics } from '@/components/common/bento';
import { toSeriesPoints } from '@/components/common/mini-chart';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { DocumentPanel } from '@/features/documents/document-panel';
import { RcLookupPanel } from '@/features/vehicles/rc-lookup-panel';
import { EditVehicleDialog } from '@/features/vehicles/vehicle-dialog';
import { VehicleHero } from '@/features/vehicles/detail/vehicle-hero';
import { VehicleAiCard } from '@/features/vehicles/detail/vehicle-ai-card';
import { VehicleInsights } from '@/features/vehicles/detail/vehicle-insights';
import { VehiclePhotosPanel } from '@/features/vehicles/detail/vehicle-photos';
import { SpecSheet, type SpecGroup } from '@/features/vehicles/detail/spec-sheet';
import { SellVehiclePanel } from '@/features/resale/sell-vehicle-panel';
import { LoanPanel } from '@/features/loans/loan-panel';
import { ServiceTimelinePanel } from '@/features/service/service-timeline';
import { CameraGrid } from '@/features/cameras/camera-grid';
import { VehicleHardware } from '@/features/devices/vehicle-hardware';
import { VehicleFastagPanel } from '@/features/toll/fastag-panel';
import { SubjectQrPanel } from '@/features/qr/subject-qr-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Digital vehicle passport — one vehicle's whole life in one place, assembled
 * entirely from stored records.
 *
 * This screen serves **every** vehicle type, because a taxi and a truck are the
 * same row in the same table (see `apps/api/src/modules/vehicles`). What differs
 * is what the type can actually do, so the page asks the capability model rather
 * than branching on the type name: a taxi shows seats and air conditioning, a
 * truck shows payload tonnes and body type, a van shows both, and nothing shows
 * a figure its own type cannot possess. A car opened here reads as a car — never
 * as a truck with a nought-tonne payload.
 *
 * `/fleet/vehicles/:id` and `/fleet/trucks/:id` both render this component, so
 * the goods-vehicle route keeps behaving exactly as it did while any entry point
 * that knows only a vehicle id still lands on the right presentation.
 */

export function VehicleDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { can, hasFeature, session } = useAuth();
  const queryClient = useQueryClient();
  const [assignOpen, setAssignOpen] = React.useState(false);
  /*
   * The open tab, held here rather than left to Radix's own default.
   *
   * The header's overflow menu offers the sections that are not primary
   * actions — the QR sticker, the paperwork, the fitted hardware — and a menu
   * item can only open one of those if something above the tab list owns which
   * tab is showing. Kept in state rather than in the URL so that existing
   * links to this page, and the browser's back button, behave exactly as they
   * did before.
   */
  const [tab, setTab] = React.useState('overview');
  /** The tab strip, so opening a section from the header scrolls to it. */
  const tabsRef = React.useRef<HTMLDivElement | null>(null);

  // The generalized endpoint serves both routes: it returns the same row as
  // `/trucks/:id` plus the type, capabilities, hardware and alert roll-up the
  // truck-shaped summary has no concept of. It is behind the same permission
  // grant, so nothing that could open the old screen is turned away here.
  const vehicleQuery = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => api.get<VehicleSummary>(`/fleet/vehicles/${id}`),
    enabled: Boolean(id),
  });

  const passport = useQuery({
    queryKey: ['vehicle', id, 'passport'],
    queryFn: () => api.get<TruckPassport>(`/analytics/trucks/${id}/passport`),
    enabled: Boolean(id),
  });

  const unassign = useMutation({
    mutationFn: () => api.post(`/trucks/${id}/unassign-driver`),
    onSuccess: () => {
      toast.success('Driver unassigned');
      void queryClient.invalidateQueries({ queryKey: ['vehicle', id] });
      void queryClient.invalidateQueries({ queryKey: ['truck', id] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['trucks'] });
    },
    onError: (error) => toast.error('Could not unassign', { description: errorMessage(error) }),
  });

  /*
   * The two derived series stay above the early returns below, and must.
   *
   * A hook after a conditional `return` runs on some renders and not others:
   * this screen bails out while the vehicle is loading, so React counted six
   * hooks on the first render and eight on the next, and threw "Rendered more
   * hooks than during the previous render" instead of drawing the page. Both
   * read `passport.data` defensively, so computing them before the vehicle is
   * known costs an empty array and nothing else.
   */

  /**
   * The odometer as the vehicle's own fuel records recorded it.
   *
   * A fill-up is the one moment a real reading is taken off the dash, so the
   * passport's fuel rows are the only honest history of this dial. Records
   * that carried no reading are skipped rather than interpolated, and the
   * points are ordered by date so the line climbs the way the odometer did.
   */
  const odometerCurve = React.useMemo(
    () =>
      (passport.data?.fuel ?? [])
        .filter((record) => record.odometerKm !== null)
        .map((record) => ({ date: record.recordedAt.slice(0, 10), value: record.odometerKm ?? 0 }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [passport.data],
  );

  /** What this vehicle spent on fuel, per day it was filled. */
  const fuelSpend = React.useMemo(() => {
    const buckets = new Map<string, number>();
    for (const record of passport.data?.fuel ?? []) {
      const date = record.recordedAt.slice(0, 10);
      buckets.set(date, (buckets.get(date) ?? 0) + record.totalCost);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value: Number(value.toFixed(2)) }));
  }, [passport.data]);

  if (vehicleQuery.isLoading) return <LoadingState label="Loading vehicle…" />;
  if (vehicleQuery.error) {
    return <ErrorState error={vehicleQuery.error} onRetry={() => void vehicleQuery.refetch()} />;
  }
  if (!vehicleQuery.data) return <EmptyState icon={Car} title="Vehicle not found" />;

  const vehicle = vehicleQuery.data;
  const lifetime = passport.data?.lifetime;
  const definition = vehicleTypeDefinition(vehicle.vehicleType);

  const carriesFreight = vehicle.capabilities.includes(VehicleCapability.CARGO_CAPACITY);
  const carriesPassengers = vehicle.capabilities.includes(VehicleCapability.PASSENGER_CAPACITY);

  // Where "back" should go. The truck route can be reached with any vehicle —
  // the fleet map, a trip and a driver's profile all link to it knowing only an
  // id — so the list offered is the one that actually holds this vehicle: a
  // travel operator has no Trucks screen, and a taxi does not belong on it.
  // A Personal account is the same case for a different reason: it runs its own
  // vehicles rather than a freight fleet, so Vehicles is the only list it is
  // offered and "All trucks" would send it somewhere its menu does not go.
  const belongsOnTrucksList =
    carriesFreight &&
    session?.organization?.type !== OrganizationType.MOBILITY_PROVIDER &&
    !session?.organization?.isPersonalSeat;
  const backToTrucks = location.pathname.startsWith('/fleet/vehicles')
    ? false
    : belongsOnTrucksList;
  const backTo = backToTrucks ? '/fleet/trucks' : '/fleet/vehicles';
  const backLabel = backToTrucks ? 'All trucks' : 'All vehicles';

  // The RC tab is hidden rather than shown-and-refused; the API enforces both
  // the permission and that the vehicle belongs to this fleet regardless.
  const canLookupRegistration = can(Permission.VEHICLE_LOOKUP);
  // Resale is deferred: the entitlement decides, so one server-side switch
  // hides the tab everywhere rather than each screen keeping its own opinion.
  const canSell = can(Permission.RESALE_MANAGE) && hasFeature(Feature.RESALE_PUBLISH);
  // Finance is owner-level: the tab is not rendered at all for a caller who
  // cannot read it, because the existence of a loan is itself private.
  const canSeeFinance = can(Permission.LOANS_READ) && hasFeature(Feature.FINANCE_LOANS);
  const canSeeCameras = can(Permission.TELEMETRY_READ) && hasFeature(Feature.HARDWARE_CONNECTIVITY);
  // Hardware is a `devices.read` question rather than a telemetry one: what is
  // fitted to a vehicle is an inventory fact, and somebody may legitimately
  // need to see it without being entitled to read what it reports.
  const canSeeHardware = can(Permission.DEVICES_READ) && hasFeature(Feature.HARDWARE_CONNECTIVITY);
  const canSeeToll = can(Permission.TOLL_READ) && hasFeature(Feature.TOLL_FASTAG);
  const canSeeQr = can(Permission.QR_READ) && hasFeature(Feature.QR_IDENTITY);
  // Offered on the strength of a fitted device rather than the type's declared
  // capability: if a unit is reporting, its readings are worth reading.
  const canSeeTelemetry = Boolean(vehicle.device) && can(Permission.TELEMETRY_READ);
  // The same pair the Copilot screen checks. When either is missing the
  // assistant card renders nothing, and the hero takes the full width.
  const canUseAi = can(Permission.AI_USE) && hasFeature(Feature.AI_COPILOT);

  /**
   * The sections reachable from the header's overflow menu.
   *
   * Every one is an existing tab behind its existing gate — the menu is a
   * second way in, never a second permission check. Building the list here
   * keeps it impossible for the menu to offer a tab the strip below does not
   * render.
   */
  const moreSections: { value: string; label: string }[] = [
    { value: 'photos', label: 'Photos' },
    { value: 'documents', label: 'Documents' },
    ...(canSeeQr ? [{ value: 'qr', label: 'QR code' }] : []),
    ...(canLookupRegistration ? [{ value: 'registration', label: 'Registration' }] : []),
    { value: 'maintenance', label: 'Maintenance' },
    ...(canSeeFinance ? [{ value: 'finance', label: 'Loan & finance' }] : []),
    ...(canSeeToll ? [{ value: 'fastag', label: 'FASTag' }] : []),
    ...(canSeeHardware ? [{ value: 'hardware', label: 'Hardware' }] : []),
    ...(canSeeCameras ? [{ value: 'cameras', label: 'Cameras' }] : []),
    { value: 'drivers', label: 'Driver history' },
    ...(canSell ? [{ value: 'sell', label: 'Sell this vehicle' }] : []),
  ];

  /** Open a section and bring it into view — a menu that silently changed a
      tab three screens down would read as having done nothing. */
  const openSection = (value: string): void => {
    setTab(value);
    requestAnimationFrame(() => {
      tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  /**
   * Capability-driven specification — never a field the type cannot have.
   *
   * Grouped rather than listed. Twelve equally-weighted pairs in one rectangle
   * had to be scanned; under three headings, "what is it", "what can it carry"
   * and "what is on record" are three questions a reader can go straight to.
   */
  const specGroups: SpecGroup[] = [
    {
      title: 'Identity',
      rows: [
        { label: 'Vehicle type', value: vehicle.typeLabel },
        // Body type only means something for a goods vehicle.
        ...(carriesFreight
          ? [{ label: 'Body type', value: humanizeEnum(vehicle.truckType) }]
          : []),
        { label: 'Make', value: vehicle.manufacturer ?? '-' },
        { label: 'Model', value: vehicle.model ?? '-' },
        { label: 'Year', value: vehicle.year ?? '-' },
        { label: 'Colour', value: vehicle.colour ?? '-' },
      ],
    },
    {
      title: 'Capacity & fuel',
      rows: [
        ...(carriesFreight
          ? [
              {
                label: 'Payload capacity',
                value: vehicle.capacityTons !== null ? `${vehicle.capacityTons} t` : '-',
              },
            ]
          : []),
        ...(carriesPassengers
          ? [
              {
                label: 'Passenger seats',
                value:
                  vehicle.passengerCapacity !== null
                    ? formatNumber(vehicle.passengerCapacity)
                    : '-',
              },
              {
                label: 'Air conditioning',
                value:
                  vehicle.airConditioned === null
                    ? '-'
                    : vehicle.airConditioned
                      ? 'Yes'
                      : 'No',
              },
            ]
          : []),
        { label: 'Fuel', value: humanizeEnum(vehicle.fuelType) },
        {
          label: 'Rated consumption',
          value:
            vehicle.fuelEfficiency !== null ? `${vehicle.fuelEfficiency} L/100 km` : '-',
        },
      ],
    },
    {
      title: 'On record',
      rows: [
        { label: 'Odometer', value: `${formatNumber(Math.round(vehicle.odometerKm))} km` },
        { label: 'Location sharing', value: vehicle.shareLocation ? 'On' : 'Off' },
        {
          label: 'On platform since',
          value: new Date(vehicle.createdAt).toLocaleDateString('en-IN'),
        },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {/*
        The identity band, with the assistant beside it.

        Laid out as the reference vehicle page is: the plate and everything that
        identifies this one vehicle on the left, the vehicle itself given real
        size beside it, and the actions directly under the name they act on.

        On a wide screen the assistant takes the third column. Without the AI
        entitlement it renders nothing at all and the hero spans the full width,
        so there is never an empty column where a panel should be.
      */}
      <div className={canUseAi ? 'grid gap-4 xl:grid-cols-3' : 'grid gap-4'}>
        <VehicleHero
          vehicle={vehicle}
          backTo={backTo}
          backLabel={backLabel}
          carriesFreight={carriesFreight}
          className={canUseAi ? 'xl:col-span-2' : ''}
          actions={
            <>
              {/*
                Assigning a driver is the one action here that changes what the
                vehicle can do next, so it is the only primary button. Verify
                and Telemetry are outlines, and Verify hides itself once the
                registry has confirmed the plate.
              */}
              {can(Permission.TRUCKS_ASSIGN) ? (
                vehicle.currentDriver ? (
                  <Button
                    variant="outline"
                    onClick={() => unassign.mutate()}
                    loading={unassign.isPending}
                  >
                    <UserMinus className="size-4" />
                    Unassign driver
                  </Button>
                ) : (
                  <Button onClick={() => setAssignOpen(true)}>
                    <UserPlus className="size-4" />
                    Assign driver
                  </Button>
                )
              ) : null}

              <VerifyButton
                subjectType="truck"
                subjectId={vehicle.id}
                subjectLabel={formatRegistrationNumber(vehicle.registrationNumber)}
                verified={vehicle.verificationStatus === 'VERIFIED'}
                invalidateKeys={[
                  ['vehicle', vehicle.id],
                  ['truck', vehicle.id],
                  ['vehicles'],
                  ['trucks'],
                ]}
              />

              {canSeeTelemetry ? (
                <Button variant="outline" asChild>
                  <Link to={`/fleet/vehicles/${vehicle.id}/telemetry`}>
                    <Activity className="size-4" />
                    Telemetry
                  </Link>
                </Button>
              ) : null}

              {/*
                Renders nothing without `vehicles.update` — the same dialog the
                fleet grid uses, opened on this vehicle.
              */}
              <EditVehicleDialog
                vehicle={vehicle}
                label="Edit details"
                variant="outline"
                size="default"
              />

              {moreSections.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="More sections">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    <DropdownMenuLabel>Go to</DropdownMenuLabel>
                    {moreSections.map((section) => (
                      <DropdownMenuItem
                        key={section.value}
                        onSelect={() => openSection(section.value)}
                      >
                        {section.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          }
        />

        <VehicleAiCard vehicle={vehicle} canSeeFinance={canSeeFinance} />
      </div>

      {/*
        The figures, as one panel divided by hairlines rather than five cards
        floating apart.

        `BentoMetrics` is the dashboard strip the boards already use, so a
        figure reads identically here and there — same animation, same series,
        same tones — and a ragged final row leaves a clean empty cell instead
        of a stripe of border colour.

        Capacity is still reported per capability. A taxi has no payload and a
        truck has no seat count, and showing either as a plausible-looking 0
        would be worse than not showing it at all, so the strip is four cells
        wide for most vehicles and five for a van that does both.
      */}
      <BentoGrid>
        <BentoMetrics columns={4}>
          {carriesFreight ? (
            <BentoMetric
              label="Payload"
              value={vehicle.capacityTons !== null ? `${vehicle.capacityTons} t` : '-'}
              icon={Weight}
              hint={humanizeEnum(vehicle.truckType)}
            />
          ) : null}

          {carriesPassengers ? (
            <BentoMetric
              label="Seats"
              value={
                vehicle.passengerCapacity !== null ? formatNumber(vehicle.passengerCapacity) : '-'
              }
              icon={Users}
              hint={
                vehicle.airConditioned === null
                  ? undefined
                  : vehicle.airConditioned
                    ? 'Air conditioned'
                    : 'Non air-conditioned'
              }
            />
          ) : null}

          <BentoMetric
            label="Odometer"
            value={`${formatNumber(Math.round(vehicle.odometerKm))} km`}
            chart={{ kind: 'area', points: toSeriesPoints(odometerCurve), format: formatDistanceKm }}
            hint={
              lifetime ? `${formatDistanceKm(lifetime.totalDistanceKm)} on Saarthi trips` : undefined
            }
          />
          <BentoMetric
            label="Lifetime revenue"
            value={lifetime ? formatCompactCurrency(lifetime.revenue) : '-'}
            chart={{
              // Where the revenue went, not where it came from. The three
              // segments are the lifetime figures themselves — profit is what is
              // left after fuel and workshop — so the bar is the money the tile
              // above it names, split the way the owner has to think about it.
              kind: 'split',
              segments: [
                { label: 'Profit', value: Math.max(0, lifetime?.profit ?? 0), tone: 'success' },
                { label: 'Fuel', value: lifetime?.fuelCost ?? 0, tone: 'warning' },
                { label: 'Workshop', value: lifetime?.maintenanceCost ?? 0, tone: 'destructive' },
              ],
            }}
            tone={lifetime && lifetime.profit > 0 ? 'success' : 'default'}
            hint={lifetime ? `Profit ${formatCompactCurrency(lifetime.profit)}` : undefined}
          />
          <BentoMetric
            label="Running cost"
            value={lifetime?.costPerKm ? `${formatCurrency(lifetime.costPerKm)}/km` : '-'}
            chart={{ kind: 'bars', points: toSeriesPoints(fuelSpend), format: formatCurrency }}
            hint={
              lifetime?.fuelEfficiencyL100Km
                ? `${lifetime.fuelEfficiencyL100Km} L/100 km`
                : 'No fuel records yet'
            }
          />
        </BentoMetrics>
      </BentoGrid>

      {/*
        Who is on this vehicle, and whether it is out.

        Trimmed to the two tiles that are links. The hardware and alert tiles
        that used to sit here said less than the Operational card below now
        does — which adds when the unit was last seen and how the paperwork
        stands — and stating the same two facts twice on one screen was clutter
        rather than emphasis.
      */}
      {vehicle.currentDriver || vehicle.currentTripId ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {vehicle.currentDriver ? (
            <Card variant="glass" interactive className="rounded-2xl">
              <Link
                to={`/fleet/drivers/${vehicle.currentDriver.id}`}
                className="flex items-center gap-3 p-5"
              >
                <span className="shrink-0 rounded-2xl bg-primary/10 p-3 text-primary ring-1 ring-primary/15">
                  <UserPlus className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="section-label block">Current driver</span>
                  <span className="mt-0.5 block truncate text-sm font-semibold">
                    {vehicle.currentDriver.name}
                  </span>
                </span>
              </Link>
            </Card>
          ) : null}

          {vehicle.currentTripId ? (
            <Card variant="glass" interactive className="rounded-2xl">
              <Link to={`/trips/${vehicle.currentTripId}`} className="flex items-center gap-3 p-5">
                <span className="shrink-0 rounded-2xl bg-success/12 p-3 text-success ring-1 ring-success/20">
                  <Activity className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="section-label block">Trip in progress</span>
                  <span className="mt-0.5 block truncate text-sm font-semibold">
                    View active trip
                  </span>
                </span>
              </Link>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/*
        Location, usage and operational condition — assembled from the vehicle
        row and the passport this page has already fetched, so the three cards
        cost no further request and contain no figure the API does not report.
      */}
      <VehicleInsights
        vehicle={vehicle}
        passport={passport.data}
        isLoading={passport.isLoading}
      />

      {/* Anchored, so the overflow menu can scroll a section into view. */}
      <div ref={tabsRef} className="scroll-mt-24" aria-hidden />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="merged">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="photos">Photos</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {canSeeQr ? <TabsTrigger value="qr">QR code</TabsTrigger> : null}
          {canLookupRegistration ? (
            <TabsTrigger value="registration">Registration</TabsTrigger>
          ) : null}
          <TabsTrigger value="trips">Trips</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          {canSeeFinance ? <TabsTrigger value="finance">Loan &amp; finance</TabsTrigger> : null}
          {canSeeToll ? <TabsTrigger value="fastag">FASTag</TabsTrigger> : null}
          {canSeeHardware ? <TabsTrigger value="hardware">Hardware</TabsTrigger> : null}
          {canSeeCameras ? <TabsTrigger value="cameras">Cameras</TabsTrigger> : null}
          <TabsTrigger value="drivers">Driver history</TabsTrigger>
          {canSell ? <TabsTrigger value="sell">Sell</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <SectionHeader title="Specification" description={definition.description} />
              </CardHeader>
              <CardContent className="pt-0">
                <SpecSheet groups={specGroups} />
              </CardContent>
            </Card>

            {/*
              Cost and earnings — the money view.

              This card used to be "Lifetime record" and repeated the distance,
              trip, order and service counts that the Usage panel above now
              shows. Stating the same four figures twice on one screen made the
              page longer without making it say more, so what is left here is
              the part Usage does not cover.
            */}
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <SectionHeader
                  title="Cost & earnings"
                  description="Every figure from stored records."
                />
              </CardHeader>
              <CardContent className="pt-0">
                {passport.isLoading ? (
                  <LoadingState />
                ) : lifetime ? (
                  <SpecSheet
                    groups={[
                      {
                        title: 'Lifetime',
                        rows: [
                          { label: 'Revenue', value: formatCurrency(lifetime.revenue) },
                          { label: 'Fuel', value: formatCurrency(lifetime.fuelCost) },
                          { label: 'Workshop', value: formatCurrency(lifetime.maintenanceCost) },
                          {
                            label: 'Profit',
                            value: formatCurrency(lifetime.profit),
                            // Coloured only when it is actually a loss: a green
                            // figure on every vehicle stops meaning anything.
                            ...(lifetime.profit < 0 ? { tone: 'destructive' as const } : {}),
                          },
                        ],
                      },
                      {
                        title: 'Per kilometre',
                        rows: [
                          {
                            label: 'Running cost',
                            value: lifetime.costPerKm
                              ? `${formatCurrency(lifetime.costPerKm)}/km`
                              : '-',
                          },
                          {
                            label: 'Fuel efficiency',
                            value: lifetime.fuelEfficiencyL100Km
                              ? `${lifetime.fuelEfficiencyL100Km} L/100 km`
                              : 'No fuel records yet',
                          },
                        ],
                      },
                    ]}
                  />
                ) : (
                  <p className="py-4 text-sm text-muted-foreground">
                    No costs or earnings recorded for this vehicle yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/*
            The activity trail.

            A connecting rule down the left rather than loose dots: these are
            events in sequence, and a reader should be able to see that without
            being told.
          */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <SectionHeader title="Recent activity" />
            </CardHeader>
            <CardContent className="pt-0">
              {passport.isLoading ? (
                <LoadingState />
              ) : (passport.data?.events ?? []).length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No recorded events yet.</p>
              ) : (
                <ol className="relative space-y-4 border-l border-border/70 pl-5">
                  {(passport.data?.events ?? []).slice(0, 10).map((event) => (
                    <li key={event.id} className="relative">
                      <span
                        className="absolute -left-[1.4rem] top-1.5 size-2 rounded-full bg-border ring-4 ring-card"
                        aria-hidden
                      />
                      <p className="text-sm">{event.description ?? humanizeEnum(event.type)}</p>
                      <p className="text-xs text-muted-foreground">
                        {relativeTimeFrom(event.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {vehicle.notes ? (
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <SectionHeader title="Notes" />
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground">
                {vehicle.notes}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {/*
          Photographs, in front of the paperwork rather than inside it.

          They were a `TRUCK_PHOTO` document until this tab existed, which put
          every picture of a vehicle into a verification queue and then showed it
          as a file name. Nothing here is verified, and every photo is shown as a
          photo.
        */}
        <TabsContent value="photos">
          <VehiclePhotosPanel vehicleId={id} registrationNumber={vehicle.registrationNumber} />
        </TabsContent>

        {/*
          Documents are stored against the vehicle row, whose owner type is
          TRUCK for every vehicle on the platform. The label carries the plate so
          the panel reads correctly for a taxi as well as a lorry.
        */}
        <TabsContent value="documents">
          <DocumentPanel ownerType="TRUCK" ownerId={id} ownerLabel={vehicle.registrationNumber} />
        </TabsContent>

        {/*
          The vehicle's code, on the vehicle. It used to live only on a fleet-
          wide QR screen, which meant finding one truck's sticker started by
          matching a registration number against a list.
        */}
        {canSeeQr ? (
          <TabsContent value="qr">
            <SubjectQrPanel subjectType="VEHICLE" subjectId={id} />
          </TabsContent>
        ) : null}

        {/*
          The plate is already known here, so the panel opens ready to go —
          the operator presses one button instead of retyping a number that is
          on the screen above them.
        */}
        {canLookupRegistration ? (
          <TabsContent value="registration" className="space-y-4">
            <SectionHeader
              title="Registration certificate"
              description="The RTO record for this vehicle, with the downloadable RC certificate."
            />
            <RcLookupPanel registrationNumber={vehicle.registrationNumber} />
          </TabsContent>
        ) : null}

        <TabsContent value="trips">
          {(passport.data?.recentTrips ?? []).length === 0 ? (
            <EmptyState icon={RouteIcon} title="No trips recorded yet" />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trip</TableHead>
                    <TableHead className="hidden md:table-cell">Route</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Distance</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(passport.data?.recentTrips ?? []).map((trip) => (
                    <TableRow
                      key={trip.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/trips/${trip.id}`)}
                    >
                      <TableCell className="font-medium">{trip.reference}</TableCell>
                      <TableCell className="hidden max-w-72 truncate text-sm text-muted-foreground md:table-cell">
                        {trip.originAddress.split(',')[0]} → {trip.destinationAddress.split(',')[0]}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={trip.status} size="sm" />
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatDistanceKm(trip.actualDistanceKm)}
                      </TableCell>
                      <TableCell className="tabular hidden text-right md:table-cell">
                        {formatCurrency(trip.price)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/*
          Service history first, scheduled work below it. What has been done to
          the vehicle is the question people open this tab to answer; what is
          booked next is a smaller, separate one.
        */}
        <TabsContent value="maintenance" className="space-y-4">
          <ServiceTimelinePanel vehicleId={vehicle.id} />

          <SectionHeader title="Scheduled work" description="Jobs booked but not yet completed." />
          {(passport.data?.maintenance ?? []).length === 0 ? (
            <EmptyState icon={Wrench} title="No maintenance recorded" />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Provider</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(passport.data?.maintenance ?? []).map((record) => {
                    const entry = record as {
                      id: string;
                      title: string;
                      type: string;
                      status: string;
                      serviceProvider: string | null;
                      cost: number | null;
                      completedAt: string | null;
                    };
                    return (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <p className="font-medium">{entry.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {humanizeEnum(entry.type)}
                          </p>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={entry.status} size="sm" />
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                          {entry.serviceProvider ?? '-'}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {formatCurrency(entry.cost)}
                        </TableCell>
                        <TableCell className="hidden text-right text-sm text-muted-foreground md:table-cell">
                          {entry.completedAt
                            ? new Date(entry.completedAt).toLocaleDateString('en-IN')
                            : '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/*
          Loan & finance. The panel loads its own data so the vehicle screen
          does not fetch finance for a caller who will never be shown it.
        */}
        {canSeeFinance ? (
          <TabsContent value="finance" className="space-y-4">
            <SectionHeader
              title="Loan &amp; finance"
              description="What is owed on this vehicle, when the next installment falls due, and the repayment history. VorldX Saarthi keeps the record and sends reminders; it does not move money."
            />
            <LoanPanel vehicleId={vehicle.id} registrationNumber={vehicle.registrationNumber} />
          </TabsContent>
        ) : null}

        {canSeeToll ? (
          <TabsContent value="fastag" className="space-y-4">
            <SectionHeader
              title="FASTag"
              description="The tag fitted to this vehicle, what it can still pay, and what it spends at the barrier."
            />
            <VehicleFastagPanel vehicleId={vehicle.id} />
          </TabsContent>
        ) : null}

        {canSeeHardware ? (
          <TabsContent value="hardware" className="space-y-4">
            <VehicleHardware
              vehicleId={vehicle.id}
              registrationNumber={vehicle.registrationNumber}
            />
          </TabsContent>
        ) : null}

        {canSeeCameras ? (
          <TabsContent value="cameras" className="space-y-4">
            <SectionHeader
              title="Cameras"
              description="Channels on the recorder currently fitted to this vehicle. Opening a live view is recorded against your account."
            />
            <CameraGrid vehicleId={vehicle.id} registrationNumber={vehicle.registrationNumber} />
          </TabsContent>
        ) : null}

        <TabsContent value="drivers">
          {(passport.data?.driverHistory ?? []).length === 0 ? (
            <EmptyState icon={ShieldAlert} title="No driver assignments yet" />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">From</TableHead>
                    <TableHead className="hidden md:table-cell">Until</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(passport.data?.driverHistory ?? []).map((assignment) => (
                    <TableRow key={`${assignment.driverId}-${assignment.assignedAt}`}>
                      <TableCell>
                        <Link
                          to={`/fleet/drivers/${assignment.driverId}`}
                          className="font-medium hover:underline"
                        >
                          {assignment.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={assignment.status} size="sm" />
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {new Date(assignment.assignedAt).toLocaleDateString('en-IN')}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {assignment.unassignedAt
                          ? new Date(assignment.unassignedAt).toLocaleDateString('en-IN')
                          : 'Current'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/*
          Selling starts from the vehicle rather than from a blank marketplace
          form, so the odometer, make, model and year are the ones VorldX Saarthi has
          been recording — not numbers the seller retypes from memory.
        */}
        {canSell ? (
          <TabsContent value="sell" className="space-y-4">
            <SectionHeader
              title="Sell this vehicle"
              description="List it on the VorldX Saarthi resale marketplace. Photos and a price are all that stand between a draft and a live advert."
            />
            <SellVehiclePanel
              vehicleId={vehicle.id}
              registrationNumber={vehicle.registrationNumber}
              manufacturer={vehicle.manufacturer}
              model={vehicle.model}
              year={vehicle.year}
              odometerKm={vehicle.odometerKm}
            />
          </TabsContent>
        ) : null}
      </Tabs>

      <AssignDriverDialog
        vehicleId={id}
        vehicleLabel={vehicle.typeLabel.toLowerCase()}
        open={assignOpen}
        onOpenChange={setAssignOpen}
      />
    </div>
  );
}

function AssignDriverDialog({
  vehicleId,
  vehicleLabel,
  open,
  onOpenChange,
}: {
  vehicleId: string;
  /** What the vehicle is, so the copy reads right for a taxi as for a truck. */
  vehicleLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [driverId, setDriverId] = React.useState('');

  const drivers = useQuery({
    queryKey: ['drivers', 'assignable'],
    queryFn: () =>
      api.get<Paginated<DriverSummary>>('/drivers', {
        assigned: 'false',
        verificationStatus: 'VERIFIED',
        pageSize: 100,
      }),
    enabled: open,
  });

  const assign = useMutation({
    mutationFn: () => api.post(`/trucks/${vehicleId}/assign-driver`, { driverId }),
    onSuccess: () => {
      toast.success('Driver assigned');
      void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['truck', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['trucks'] });
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      onOpenChange(false);
      setDriverId('');
    },
    onError: (error) =>
      toast.error('Could not assign driver', { description: errorMessage(error) }),
  });

  const available = drivers.data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a driver</DialogTitle>
          <DialogDescription>
            Only verified drivers who are not already on another vehicle can be assigned to this{' '}
            {vehicleLabel}.
          </DialogDescription>
        </DialogHeader>

        {drivers.isLoading ? (
          <LoadingState label="Loading drivers…" />
        ) : available.length === 0 ? (
          <EmptyState
            title="No available verified drivers"
            description="Add a driver and complete their verification before assigning a vehicle."
            className="min-h-32"
          />
        ) : (
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a driver" />
            </SelectTrigger>
            <SelectContent>
              {available.map((driver) => (
                <SelectItem key={driver.id} value={driver.id}>
                  {driver.fullName}
                  {driver.overallScore !== null ? ` · score ${driver.overallScore}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!driverId} loading={assign.isPending} onClick={() => assign.mutate()}>
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default VehicleDetailPage;
