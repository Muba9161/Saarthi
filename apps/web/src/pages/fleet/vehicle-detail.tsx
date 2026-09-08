import * as React from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Bus,
  Car,
  Cpu,
  Route as RouteIcon,
  ShieldAlert,
  TriangleAlert,
  Truck,
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
  VehicleType,
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
import { StatCard } from '@/components/common/stat-card';
import { VEHICLE_ART_ASPECT, VehicleArt } from '@/components/common/vehicle-art';
import { cn } from '@/lib/utils';
import { toSeriesPoints } from '@/components/common/mini-chart';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { DocumentPanel } from '@/features/documents/document-panel';
import { RcLookupPanel } from '@/features/vehicles/rc-lookup-panel';
import { SellVehiclePanel } from '@/features/resale/sell-vehicle-panel';
import { LoanPanel } from '@/features/loans/loan-panel';
import { ServiceTimelinePanel } from '@/features/service/service-timeline';
import { CameraGrid } from '@/features/cameras/camera-grid';
import { VehicleHardware } from '@/features/devices/vehicle-hardware';
import { VehicleFastagPanel } from '@/features/toll/fastag-panel';
import { SubjectQrPanel } from '@/features/qr/subject-qr-panel';
import { Badge } from '@/components/ui/badge';
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

/** The icon that matches what the vehicle actually is. */
function vehicleIcon(type: VehicleType): React.ComponentType<{ className?: string }> {
  if (type === VehicleType.BUS || type === VehicleType.TEMPO) return Bus;
  if (type === VehicleType.TRUCK || type === VehicleType.PICKUP) return Truck;
  return Car;
}

export function VehicleDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { can, hasFeature, session } = useAuth();
  const queryClient = useQueryClient();
  const [assignOpen, setAssignOpen] = React.useState(false);

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
  const TypeIcon = vehicleIcon(vehicle.vehicleType);

  const carriesFreight = vehicle.capabilities.includes(VehicleCapability.CARGO_CAPACITY);
  const carriesPassengers = vehicle.capabilities.includes(VehicleCapability.PASSENGER_CAPACITY);

  // Where "back" should go. The truck route can be reached with any vehicle —
  // the fleet map, a trip and a driver's profile all link to it knowing only an
  // id — so the list offered is the one that actually holds this vehicle: a
  // travel operator has no Trucks screen, and a taxi does not belong on it.
  const belongsOnTrucksList =
    carriesFreight && session?.organization?.type !== OrganizationType.MOBILITY_PROVIDER;
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

  const makeAndModel = [vehicle.manufacturer, vehicle.model, vehicle.year]
    .filter(Boolean)
    .join(' · ');
  // The type always leads, so a car is never described by a truck body type.
  const description =
    [
      vehicle.typeLabel,
      makeAndModel,
      // Body type only means something for a goods vehicle.
      carriesFreight ? humanizeEnum(vehicle.truckType) : null,
      vehicle.colour,
    ]
      .filter(Boolean)
      .join(' · ') || definition.description;

  /** Capability-driven specification — never a field the type cannot have. */
  const specification: [string, React.ReactNode][] = [
    ['Vehicle type', vehicle.typeLabel],
    ...(carriesFreight
      ? ([['Body type', humanizeEnum(vehicle.truckType)]] as [string, React.ReactNode][])
      : []),
    ['Make & model', [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || '—'],
    ['Year', vehicle.year ?? '—'],
    ['Colour', vehicle.colour ?? '—'],
    ['Fuel', humanizeEnum(vehicle.fuelType)],
    ...(carriesFreight
      ? ([
          ['Payload capacity', vehicle.capacityTons !== null ? `${vehicle.capacityTons} t` : '—'],
        ] as [string, React.ReactNode][])
      : []),
    ...(carriesPassengers
      ? ([
          [
            'Passenger seats',
            vehicle.passengerCapacity !== null ? formatNumber(vehicle.passengerCapacity) : '—',
          ],
          [
            'Air conditioning',
            vehicle.airConditioned === null ? '—' : vehicle.airConditioned ? 'Yes' : 'No',
          ],
        ] as [string, React.ReactNode][])
      : []),
    [
      'Rated consumption',
      vehicle.fuelEfficiency !== null ? `${vehicle.fuelEfficiency} L/100 km` : '—',
    ],
    ['Odometer', `${formatNumber(Math.round(vehicle.odometerKm))} km`],
    ['Location sharing', vehicle.shareLocation ? 'On' : 'Off'],
    ['On platform since', new Date(vehicle.createdAt).toLocaleDateString('en-IN')],
  ];

  return (
    <div className="space-y-6">
      {/*
        The identity band.

        Laid out as the reference vehicle page is: the plate and everything
        that identifies this one vehicle on the left, the vehicle itself given
        real size on the right, and the actions directly under the name they
        act on. The picture is the largest thing on the screen on purpose —
        it is how someone confirms they opened the right record before they
        press Assign driver.
      */}
      <Card variant="glass" className="overflow-hidden rounded-3xl">
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-8 lg:p-8">
          <div className="min-w-0 space-y-5">
            <Button
              variant="ghost"
              size="sm"
              shape="pill"
              className="-ml-2 text-muted-foreground"
              onClick={() => navigate(backTo)}
            >
              <ArrowLeft className="size-4" />
              {backLabel}
            </Button>

            <div className="space-y-3">
              <p className="section-label inline-flex items-center gap-1.5">
                <TypeIcon className="size-3.5" />
                {vehicle.typeLabel}
              </p>

              <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                {formatRegistrationNumber(vehicle.registrationNumber)}
              </h1>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={vehicle.status} />
                {vehicle.verificationStatus === 'VERIFIED' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                    <BadgeCheck className="size-4" />
                    Verified
                  </span>
                ) : (
                  <StatusBadge status={vehicle.verificationStatus} size="sm" />
                )}
              </div>

              <p className="text-sm text-muted-foreground">{description}</p>
            </div>

            <div className="flex flex-wrap gap-2">
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
            </div>
          </div>

          <VehicleArt
            type={vehicle.vehicleType}
            registrationNumber={vehicle.registrationNumber}
            className={cn('w-full rounded-2xl', VEHICLE_ART_ASPECT)}
            padding="p-4 sm:p-6"
          />
        </div>
      </Card>

      {/*
        Capacity is reported per capability. A taxi has no payload and a truck
        has no seat count, and showing either as a plausible-looking 0 would be
        worse than not showing it at all.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {carriesFreight ? (
          <StatCard
            label="Payload"
            value={vehicle.capacityTons !== null ? `${vehicle.capacityTons} t` : '—'}
            icon={Weight}
            hint={humanizeEnum(vehicle.truckType)}
          />
        ) : null}

        {carriesPassengers ? (
          <StatCard
            label="Seats"
            value={
              vehicle.passengerCapacity !== null ? formatNumber(vehicle.passengerCapacity) : '—'
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

        <StatCard
          label="Odometer"
          value={`${formatNumber(Math.round(vehicle.odometerKm))} km`}
          chart={{ kind: 'area', points: toSeriesPoints(odometerCurve), format: formatDistanceKm }}
          hint={
            lifetime ? `${formatDistanceKm(lifetime.totalDistanceKm)} on Saarthi trips` : undefined
          }
        />
        <StatCard
          label="Lifetime revenue"
          value={lifetime ? formatCompactCurrency(lifetime.revenue) : '—'}
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
        <StatCard
          label="Running cost"
          value={lifetime?.costPerKm ? `${formatCurrency(lifetime.costPerKm)}/km` : '—'}
          chart={{ kind: 'bars', points: toSeriesPoints(fuelSpend), format: formatCurrency }}
          hint={
            lifetime?.fuelEfficiencyL100Km
              ? `${lifetime.fuelEfficiencyL100Km} L/100 km`
              : 'No fuel records yet'
          }
        />
      </div>

      {/*
        Who and what is attached to this vehicle right now.

        Separate tiles rather than one wrapped row: each of these is a link to
        somewhere else, and in a single row they ran together into a strip of
        text where only some words were clickable. As tiles the target of each
        is the whole card, which is what the reference layout does with the
        small panels under its hero.
      */}
      {vehicle.currentDriver || vehicle.device || vehicle.openTelemetryAlerts > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

          {vehicle.device ? (
            <Card variant="glass" className="rounded-2xl">
              <div className="flex items-center gap-3 p-5">
                <span className="shrink-0 rounded-2xl bg-info/10 p-3 text-info ring-1 ring-info/15">
                  <Cpu className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="section-label block">Hardware</span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">
                      {vehicle.device.deviceIdentifier}
                    </span>
                    <Badge
                      variant={vehicle.device.status === 'ACTIVE' ? 'success' : 'warning'}
                      size="sm"
                    >
                      {humanizeEnum(vehicle.device.status)}
                    </Badge>
                  </span>
                </span>
              </div>
            </Card>
          ) : null}

          {vehicle.openTelemetryAlerts > 0 ? (
            <Card variant="glass" className="rounded-2xl">
              <div className="flex items-center gap-3 p-5">
                <span className="shrink-0 rounded-2xl bg-warning/12 p-3 text-warning ring-1 ring-warning/20">
                  <TriangleAlert className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="section-label block">Open alerts</span>
                  <span className="tabular mt-0.5 block text-sm font-semibold text-warning">
                    {formatNumber(vehicle.openTelemetryAlerts)}
                  </span>
                </span>
              </div>
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

      <Tabs defaultValue="overview">
        <TabsList variant="merged">
          <TabsTrigger value="overview">Overview</TabsTrigger>
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
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader title="Vehicle details" description={definition.description} />
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 pt-0 text-sm">
                {specification.map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="tabular font-medium">{value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {passport.isLoading ? (
              <LoadingState />
            ) : passport.data ? (
              <>
                <Card>
                  <CardHeader className="pb-3">
                    <SectionHeader
                      title="Lifetime record"
                      description="Every figure from stored data."
                    />
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-4 pt-0 text-sm">
                    {[
                      ['Completed trips', formatNumber(passport.data.lifetime.completedTrips)],
                      ['Orders carried', formatNumber(passport.data.lifetime.totalOrders)],
                      ['Distance', formatDistanceKm(passport.data.lifetime.totalDistanceKm)],
                      [
                        'Services completed',
                        formatNumber(passport.data.lifetime.servicesCompleted),
                      ],
                      ['Fuel cost', formatCompactCurrency(passport.data.lifetime.fuelCost)],
                      [
                        'Maintenance cost',
                        formatCompactCurrency(passport.data.lifetime.maintenanceCost),
                      ],
                      ['Incidents', formatNumber(passport.data.lifetime.incidents)],
                      [
                        'On platform since',
                        new Date(passport.data.truck.createdAt).toLocaleDateString('en-IN'),
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="tabular font-medium">{value}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <SectionHeader title="Recent activity" />
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    {passport.data.events.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No recorded events yet.
                      </p>
                    ) : (
                      passport.data.events.slice(0, 10).map((event) => (
                        <div key={event.id} className="flex gap-3 text-sm">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate">
                              {event.description ?? humanizeEnum(event.type)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {relativeTimeFrom(event.createdAt)}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </>
            ) : null}
          </div>

          {vehicle.notes ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader title="Notes" />
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground">
                {vehicle.notes}
              </CardContent>
            </Card>
          ) : null}
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
                          {entry.serviceProvider ?? '—'}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {formatCurrency(entry.cost)}
                        </TableCell>
                        <TableCell className="hidden text-right text-sm text-muted-foreground md:table-cell">
                          {entry.completedAt
                            ? new Date(entry.completedAt).toLocaleDateString('en-IN')
                            : '—'}
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
