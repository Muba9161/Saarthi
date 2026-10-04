import * as React from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Car, MoreHorizontal, UserMinus, UserPlus } from 'lucide-react';
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
  vehicleTypeDefinition,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { TruckPassport } from '@/lib/api-types';
import type { VehicleSummary } from '@/lib/mobility-types';
import { useAuth } from '@/features/auth/auth-context';
import { VerifyButton } from '@/features/verification/verify-button';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { EditVehicleDialog } from '@/features/vehicles/vehicle-dialog';
import { AssignDriverDialog } from '@/features/vehicles/assign-driver-dialog';
import { HERO_ACTION_CLASS, VehicleHero } from '@/features/vehicles/detail/vehicle-hero';
import {
  VehicleFigureStrip,
  type VehicleFigure,
} from '@/features/vehicles/detail/vehicle-figure-strip';
import { VehicleAiCard } from '@/features/vehicles/detail/vehicle-ai-card';
import {
  VehicleConditionCard,
  VehicleLocationCard,
} from '@/features/vehicles/detail/vehicle-insights';
import { VehicleOverview } from '@/features/vehicles/detail/vehicle-overview';
import { VehicleDocuments } from '@/features/vehicles/detail/vehicle-documents';
import { VehicleHistory } from '@/features/vehicles/detail/vehicle-history';
import {
  VehicleFinance,
  VehicleHardwareTab,
} from '@/features/vehicles/detail/vehicle-money-hardware';
import {
  vehicleShortcuts,
  vehicleTabs,
  type VehicleDestination,
  type VehicleTab,
} from '@/features/vehicles/detail/vehicle-sections';
import type { SpecGroup } from '@/features/vehicles/detail/spec-sheet';
import { VirtualRc } from '@/features/vehicles/rc/virtual-rc';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import '@/features/vehicles/detail/vehicle-detail.css';

/**
 * Digital vehicle passport — one vehicle's whole life in one place, assembled
 * entirely from stored records.
 *
 * This screen serves **every** vehicle type, because a taxi and a truck are the
 * same row in the same table (see `apps/api/src/modules/vehicles`). What differs
 * is what the type can actually do, so the page asks the capability model rather
 * than branching on the type name: a taxi shows seats and air conditioning, a
 * truck shows payload tonnes and body type, a van shows both, and nothing shows
 * a figure its own type cannot possess.
 *
 * The page owns data, permissions and composition; every section is its own
 * module under `features/vehicles/detail`. Thirteen sections sit under six tabs
 * (`vehicle-sections.ts`), with the vehicle's context — the assistant, where it
 * is and what condition it is in — in a rail that stays beside them.
 *
 * `/fleet/vehicles/:id` and `/fleet/trucks/:id` both render this component, so
 * any entry point that knows only a vehicle id lands on the right presentation.
 */

export function VehicleDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const { can, hasFeature, session } = useAuth();
  const queryClient = useQueryClient();
  const [assignOpen, setAssignOpen] = React.useState(false);

  /*
   * Where the reader is, held here rather than inside the tabs: the header's
   * overflow menu opens a tab *at* a section or a document folder, and it can
   * only do that if something above the tabs owns all three.
   */
  const [tab, setTab] = React.useState<VehicleTab>('overview');
  const [sections, setSections] = React.useState<Partial<Record<VehicleTab, string>>>({});
  const [folder, setFolder] = React.useState<string | null>(null);
  /** The tab strip, so opening a section from the header scrolls to it. */
  const tabsRef = React.useRef<HTMLDivElement | null>(null);

  // The generalized endpoint serves both routes: it returns the same row as
  // `/trucks/:id` plus the type, capabilities, hardware and alert roll-up.
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

  // Each section keeps the gate it always had; the API enforces them all
  // regardless, so these only decide what is offered.
  const access = {
    canLookupRegistration: can(Permission.VEHICLE_LOOKUP),
    canSeeQr: can(Permission.QR_READ) && hasFeature(Feature.QR_IDENTITY),
    // Finance is owner-level: not offered at all to a caller who cannot read
    // it, because the existence of a loan is itself private.
    canSeeLoans: can(Permission.LOANS_READ) && hasFeature(Feature.FINANCE_LOANS),
    canSeeToll: can(Permission.TOLL_READ) && hasFeature(Feature.TOLL_FASTAG),
    // Resale is deferred: the entitlement decides, so one server-side switch
    // hides it everywhere rather than each screen keeping its own opinion.
    canSell: can(Permission.RESALE_MANAGE) && hasFeature(Feature.RESALE_PUBLISH),
    // Hardware is a `devices.read` question rather than a telemetry one: what is
    // fitted to a vehicle is an inventory fact, and somebody may legitimately
    // need to see it without being entitled to read what it reports. Not gated on
    // a tracker either: the driver app connects a phone here without one.
    canSeeDevices: can(Permission.DEVICES_READ),
    canSeeCameras: can(Permission.TELEMETRY_READ) && hasFeature(Feature.HARDWARE_CONNECTIVITY),
  };
  // Offered on the strength of a fitted device rather than the type's declared
  // capability: if a unit is reporting, its readings are worth reading.
  const canSeeTelemetry = Boolean(vehicle.device) && can(Permission.TELEMETRY_READ);

  const tabs = vehicleTabs(access);
  const activeTab = tabs.some((entry) => entry.value === tab) ? tab : 'overview';

  /** Open a tab — at a section or folder when given — and bring it into view. */
  const go = (to: VehicleDestination, scroll = false): void => {
    setTab(to.tab);
    if (to.section) setSections((previous) => ({ ...previous, [to.tab]: to.section }));
    if (to.tab === 'documents') setFolder(to.folder ?? null);
    if (scroll) {
      // A menu that silently changed a tab below the fold would read as having
      // done nothing.
      requestAnimationFrame(() => {
        tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };
  const sectionSetter = (target: VehicleTab) => (section: string) =>
    setSections((previous) => ({ ...previous, [target]: section }));

  // The figures an owner checks first, per capability — a taxi has no payload
  // and a truck has no seat count, and a plausible-looking 0 would be worse
  // than not showing either.
  const figures: VehicleFigure[] = [
    ...(carriesFreight
      ? [
          {
            label: 'Payload',
            value: vehicle.capacityTons !== null ? `${vehicle.capacityTons} t` : '-',
            hint: humanizeEnum(vehicle.truckType),
          },
        ]
      : []),
    ...(carriesPassengers
      ? [
          {
            label: 'Seats',
            value:
              vehicle.passengerCapacity !== null ? formatNumber(vehicle.passengerCapacity) : '-',
            hint:
              vehicle.airConditioned === null
                ? 'AC not recorded'
                : vehicle.airConditioned
                  ? 'Air conditioned'
                  : 'Non air-conditioned',
          },
        ]
      : []),
    {
      label: 'Odometer',
      value: `${formatNumber(Math.round(vehicle.odometerKm))} km`,
      hint: lifetime
        ? `${formatDistanceKm(lifetime.totalDistanceKm)} on Saarthi trips`
        : 'As last recorded',
    },
    {
      label: 'Lifetime revenue',
      value: lifetime ? formatCompactCurrency(lifetime.revenue) : '-',
      hint: lifetime ? `Profit ${formatCompactCurrency(lifetime.profit)}` : 'No trips yet',
    },
    {
      label: 'Running cost',
      value: lifetime?.costPerKm ? `${formatCurrency(lifetime.costPerKm)}/km` : '—',
      hint: lifetime?.costPerKm ? 'Fuel and workshop, per km' : 'Per km, once fuel is logged',
    },
  ];

  /**
   * Capability-driven specification — never a field the type cannot have.
   * Three groups, shown side by side: what it is, what it carries, what is on
   * record.
   */
  const specGroups: SpecGroup[] = [
    {
      title: 'Identity',
      rows: [
        { label: 'Vehicle type', value: vehicle.typeLabel },
        ...(vehicle.categoryLabel ? [{ label: 'Category', value: vehicle.categoryLabel }] : []),
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

  const shortcuts = vehicleShortcuts(access);

  return (
    <div className="flex flex-col">
      <VehicleHero
        vehicle={vehicle}
        backTo={backTo}
        backLabel={backLabel}
        actions={
          <>
            {/*
              Assigning a driver is the one action here that changes what the
              vehicle can do next, so it is the only primary button. Verify hides
              itself once the registry has confirmed the plate.
            */}
            {can(Permission.TRUCKS_ASSIGN) ? (
              vehicle.currentDriver ? (
                <Button
                  variant="outline"
                  className={HERO_ACTION_CLASS}
                  onClick={() => unassign.mutate()}
                  loading={unassign.isPending}
                >
                  <UserMinus className="size-4" />
                  Unassign driver
                </Button>
              ) : (
                <Button className={HERO_ACTION_CLASS} onClick={() => setAssignOpen(true)}>
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
              className={HERO_ACTION_CLASS}
            />

            {canSeeTelemetry ? (
              <Button variant="outline" className={HERO_ACTION_CLASS} asChild>
                <Link to={`/fleet/vehicles/${vehicle.id}/telemetry`}>
                  <Activity className="size-4" />
                  Telemetry
                </Link>
              </Button>
            ) : null}

            {/* Renders nothing without `vehicles.update`. */}
            <EditVehicleDialog
              vehicle={vehicle}
              label="Edit details"
              variant="outline"
              size="default"
              className={HERO_ACTION_CLASS}
            />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-11 rounded-[12px]"
                  aria-label="More sections"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuLabel>Go to</DropdownMenuLabel>
                {shortcuts.map((shortcut) => (
                  <DropdownMenuItem key={shortcut.label} onSelect={() => go(shortcut.to, true)}>
                    {shortcut.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="vd-body mx-auto flex w-full max-w-[1320px] flex-col gap-5">
        <VehicleFigureStrip figures={figures} />

        <div className="vd-layout">
          <div className="flex min-w-0 flex-col">
            {/* Anchored, so the overflow menu can scroll a section into view. */}
            <div ref={tabsRef} className="scroll-mt-24" aria-hidden />

            <Tabs value={activeTab} onValueChange={(value) => go({ tab: value as VehicleTab })}>
              <TabsList variant="underline" aria-label="Vehicle sections">
                {tabs.map((entry) => (
                  <TabsTrigger key={entry.value} value={entry.value}>
                    {entry.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="overview" className="mt-5">
                <VehicleOverview
                  vehicle={vehicle}
                  description={definition.description}
                  specGroups={specGroups}
                  passport={passport.data}
                  passportLoading={passport.isLoading}
                />
              </TabsContent>

              {access.canLookupRegistration ? (
                <TabsContent value="rc" className="mt-5">
                  <VirtualRc
                    vehicleId={vehicle.id}
                    registrationNumber={vehicle.registrationNumber}
                    verified={vehicle.verificationStatus === 'VERIFIED'}
                  />
                </TabsContent>
              ) : null}

              <TabsContent value="documents" className="mt-5">
                <VehicleDocuments
                  vehicleId={vehicle.id}
                  registrationNumber={vehicle.registrationNumber}
                  folder={folder}
                  onFolderChange={setFolder}
                  canSeeQr={access.canSeeQr}
                  canLookupRegistration={access.canLookupRegistration}
                  onOpenVirtualRc={() => go({ tab: 'rc' })}
                />
              </TabsContent>

              <TabsContent value="history" className="mt-5">
                <VehicleHistory
                  vehicleId={vehicle.id}
                  passport={passport.data}
                  section={sections.history}
                  onSectionChange={sectionSetter('history')}
                />
              </TabsContent>

              <TabsContent value="finance" className="mt-5">
                <VehicleFinance
                  vehicle={vehicle}
                  section={sections.finance}
                  onSectionChange={sectionSetter('finance')}
                  canSeeLoans={access.canSeeLoans}
                  canSeeToll={access.canSeeToll}
                  canSell={access.canSell}
                />
              </TabsContent>

              <TabsContent value="hardware" className="mt-5">
                <VehicleHardwareTab
                  vehicle={vehicle}
                  section={sections.hardware}
                  onSectionChange={sectionSetter('hardware')}
                  canSeeDevices={access.canSeeDevices}
                  canSeeCameras={access.canSeeCameras}
                />
              </TabsContent>
            </Tabs>
          </div>

          <aside className="vd-rail flex flex-col gap-5" aria-label="Vehicle context">
            {/* Renders nothing without the AI permission and entitlement. */}
            <VehicleAiCard vehicle={vehicle} canSeeFinance={access.canSeeLoans} />
            <VehicleLocationCard vehicle={vehicle} />
            <VehicleConditionCard
              vehicle={vehicle}
              passport={passport.data}
              isLoading={passport.isLoading}
              onOpenDocuments={() => go({ tab: 'documents' }, true)}
            />
          </aside>
        </div>
      </div>

      <AssignDriverDialog
        vehicleId={id}
        vehicleLabel={vehicle.typeLabel.toLowerCase()}
        open={assignOpen}
        onOpenChange={setAssignOpen}
      />
    </div>
  );
}

export default VehicleDetailPage;
