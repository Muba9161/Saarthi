import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  Cpu,
  Plus,
  Smartphone,
  Truck,
  X,
} from 'lucide-react';
import {
  FEATURE_CATALOGUE,
  PLAN_CATALOGUE,
  Permission,
  PlanTier,
  VEHICLE_TOPUP,
  VEHICLE_TRACKER,
  formatCurrency,
  humanizeEnum,
  quoteSubscription,
  type VehicleCapacity,
} from '@saarthi/shared';
import type { Paginated, TruckSummary } from '@/lib/api-types';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Subscription, capacity and hardware.
 *
 * Saarthi is sold by the vehicle, so the first thing this page answers is "how
 * many vehicles can I still add, and what am I paying" — not "which tier am I
 * on". There are only two plans, and the choice between them is a question an
 * operator asks once, so the plan cards sit below the two things they will
 * come back for: capacity, and how much of the fleet has a tracker on it.
 */

interface CapacityResponse extends VehicleCapacity {
  planName: string;
  topUpPriceMonthly: number;
}

interface PlanSummary {
  tier: PlanTier;
  name: string;
  status: string;
  billingPeriod: string;
  startsAt: string;
  endsAt: string | null;
  priceMonthly: number | null;
  priceYearly: number | null;
  usage: { vehicles: number; members: number; drivers: number; trackers: number };
  monthlySubtotal: number;
  monthlyGst: number;
  monthlyTotal: number;
  gstRate: number;
  enforced: boolean;
}

interface TopUpRow {
  id: string;
  status: string;
  startsAt: string;
  expiresAt: string | null;
  priceMonthly: number;
  paymentReference: string | null;
  note: string | null;
}

interface TrackerRow {
  id: string;
  status: string;
  truckId: string | null;
  truckRegistration: string | null;
  serialNumber: string | null;
  pricePaid: number;
  purchasedAt: string;
  paymentReference: string | null;
}

interface TrackerCoverage {
  activeTrackers: number;
  vehicles: number;
  covered: number;
  uncovered: number;
  remaining: number | null;
  canPurchase: boolean;
  ceiling: number | null;
  priceOneTime: number;
}

const TIER_LABEL: Record<PlanTier, string> = {
  [PlanTier.FREE]: 'Free',
  [PlanTier.PERSONAL]: 'Personal',
  [PlanTier.BUSINESS]: 'Business',
};

function inrDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN');
}

export function SubscriptionPage(): React.ReactElement {
  const { session, can } = useAuth();
  const queryClient = useQueryClient();

  const canManage = can(Permission.SUBSCRIPTION_MANAGE);
  const hasOrganization = Boolean(session?.organization);

  const plan = useQuery({
    queryKey: ['subscription', 'plan'],
    queryFn: () => api.get<PlanSummary | null>('/subscriptions/plan'),
    enabled: hasOrganization,
  });

  const capacity = useQuery({
    queryKey: ['subscription', 'capacity'],
    queryFn: () => api.get<CapacityResponse>('/subscriptions/capacity'),
    enabled: hasOrganization,
  });

  const topUps = useQuery({
    queryKey: ['subscription', 'topups'],
    queryFn: () => api.get<TopUpRow[]>('/subscriptions/topups'),
    enabled: hasOrganization,
  });

  const coverage = useQuery({
    queryKey: ['subscription', 'trackers', 'coverage'],
    queryFn: () => api.get<TrackerCoverage>('/subscriptions/trackers/coverage'),
    enabled: hasOrganization,
  });

  const trackers = useQuery({
    queryKey: ['subscription', 'trackers'],
    queryFn: () => api.get<TrackerRow[]>('/subscriptions/trackers'),
    enabled: hasOrganization,
  });

  /**
   * The fleet, for fitting a tracker to one of them.
   *
   * Loaded only once there is an unfitted tracker to fit: an operator whose
   * every tracker is already on a vehicle has nothing to choose from, and this
   * screen should not fetch the fleet to render nothing.
   */
  const hasUnfitted = (trackers.data ?? []).some(
    (row) => row.status === 'ACTIVE' && !row.truckId,
  );

  const vehicles = useQuery({
    queryKey: ['subscription', 'trackers', 'vehicles'],
    queryFn: () =>
      api.get<Paginated<TruckSummary>>('/trucks', { pageSize: 100 }).then((page) => page.items),
    enabled: hasOrganization && hasUnfitted,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['subscription'] });
    void queryClient.invalidateQueries({ queryKey: ['session'] });
  };

  const buyTopUp = useMutation({
    mutationFn: () => api.post('/subscriptions/topups', {}),
    onSuccess: () => {
      toast.success('Capacity added', {
        description: 'You can add one more vehicle straight away.',
      });
      refresh();
    },
    onError: (error) => toast.error('Could not add capacity', { description: errorMessage(error) }),
  });

  const cancelTopUp = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/topups/${id}/cancel`),
    onSuccess: () => {
      toast.success('Top-up cancelled', {
        description: 'Vehicles already on the road are unaffected.',
      });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const buyTracker = useMutation({
    mutationFn: () => api.post('/subscriptions/trackers', {}),
    onSuccess: () => {
      toast.success('Tracker added', {
        description: 'Fit it, then pair it from the Devices screen.',
      });
      refresh();
    },
    onError: (error) => toast.error('Could not add a tracker', { description: errorMessage(error) }),
  });

  const assignTracker = useMutation({
    mutationFn: ({ id, truckId }: { id: string; truckId: string }) =>
      api.post(`/subscriptions/trackers/${id}/assign`, { truckId }),
    onSuccess: () => {
      toast.success('Tracker fitted', {
        description: 'Pair the unit from the Devices screen to start reading the vehicle.',
      });
      refresh();
    },
    onError: (error) => toast.error('Could not fit the tracker', { description: errorMessage(error) }),
  });

  const retireTracker = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/trackers/${id}/retire`),
    onSuccess: () => {
      toast.success('Tracker retired', {
        description: 'Its vehicle falls back to driver-app data.',
      });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const changePlan = useMutation({
    mutationFn: (tier: PlanTier) =>
      api.post('/subscriptions/plan', { tier, billing: plan.data?.billingPeriod === 'YEARLY' ? 'yearly' : 'monthly' }),
    onSuccess: (_data, tier) => {
      toast.success(`Now on Saarthi ${TIER_LABEL[tier]}`);
      refresh();
    },
    onError: (error) => toast.error('Could not change plan', { description: errorMessage(error) }),
  });

  const currentTier = plan.data?.tier ?? session?.subscription?.planTier;
  const held = new Set(session?.subscription?.features ?? []);
  const data = capacity.data;
  const activeTopUps = (topUps.data ?? []).filter((row) => row.status === 'ACTIVE');
  const activeTrackers = (trackers.data ?? []).filter((row) => row.status === 'ACTIVE');
  const cover = coverage.data;

  const usedPercent =
    data && data.effectiveLimit !== null && data.effectiveLimit > 0
      ? Math.min(100, Math.round((data.used / data.effectiveLimit) * 100))
      : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Subscription"
        description="What you pay, how many vehicles it covers, and which of them Saarthi can actually measure."
      />

      {/* Development only. Said loudly rather than left implicit: with
          enforcement off nothing on this page is being charged for, and a
          screenshot of it would otherwise be misleading. */}
      {plan.data && !plan.data.enforced ? (
        <Alert variant="warning">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            Plan enforcement is switched off in this environment, so every capability is granted and
            no limit applies. Set <code className="text-2xs">SUBSCRIPTION_ENFORCEMENT=true</code> to
            see what a customer sees.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* What you pay                                                     */}
      {/* ---------------------------------------------------------------- */}
      {plan.isLoading ? (
        <LoadingState />
      ) : plan.data ? (
        <Card>
          <CardHeader className="pb-3">
            <SectionHeader
              title="Your plan"
              description={`${plan.data.name} · billed ${plan.data.billingPeriod.toLowerCase()}`}
            />
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                {/* The figure that leaves the account, GST included — this is
                    a billing screen, and a pre-tax number here would not match
                    the statement the owner is holding. */}
                <p className="text-3xl font-semibold tabular-nums">
                  {formatCurrency(plan.data.monthlyTotal)}
                  <span className="text-base font-normal text-muted-foreground">/month</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatCurrency(plan.data.monthlySubtotal)}
                  {' + '}
                  {formatCurrency(plan.data.monthlyGst)} GST at{' '}
                  {Math.round(plan.data.gstRate * 100)}%
                </p>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  {formatCurrency(
                    plan.data.billingPeriod === 'YEARLY'
                      ? Math.round((plan.data.priceYearly ?? 0) / 12)
                      : plan.data.priceMonthly,
                  )}{' '}
                  plan
                  {activeTopUps.length > 0
                    ? ` + ${activeTopUps.length} × ${formatCurrency(VEHICLE_TOPUP.priceMonthly)} per vehicle`
                    : ' - one vehicle included'}
                  , before tax
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={plan.data.status === 'ACTIVE' ? 'success' : 'warning'} dot>
                  {humanizeEnum(plan.data.status)}
                </Badge>
                {plan.data.endsAt ? (
                  <span className="text-xs text-muted-foreground">
                    until {inrDate(plan.data.endsAt)}
                  </span>
                ) : null}
              </div>
            </div>

            <Separator className="my-4" />

            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: 'Vehicles', value: plan.data.usage.vehicles },
                { label: 'Drivers', value: plan.data.usage.drivers },
                { label: 'Team members', value: plan.data.usage.members },
                { label: 'Trackers', value: plan.data.usage.trackers },
              ].map((row) => (
                <div key={row.label}>
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{row.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Vehicle capacity                                                 */}
      {/* ---------------------------------------------------------------- */}
      {capacity.isLoading ? (
        <LoadingState />
      ) : data ? (
        <Card className={data.atCapacity ? 'border-warning/50' : undefined}>
          <CardHeader className="pb-3">
            <SectionHeader
              title="Vehicle capacity"
              description="Capacity is checked when you add a vehicle, never afterwards."
            />
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-2xl font-semibold tabular-nums">
                  {data.used}
                  <span className="text-base font-normal text-muted-foreground">
                    {' / '}
                    {data.effectiveLimit === null ? 'unlimited' : data.effectiveLimit} vehicles
                  </span>
                </p>
                {data.effectiveLimit !== null ? (
                  <p className="text-sm text-muted-foreground">
                    {data.baseLimit} on the plan
                    {data.activeTopUps > 0
                      ? ` + ${data.activeTopUps} top-up${data.activeTopUps === 1 ? '' : 's'}`
                      : ''}
                  </p>
                ) : null}
              </div>
              {data.effectiveLimit !== null ? (
                <Progress
                  value={usedPercent}
                  className="h-2"
                  indicatorClassName={data.atCapacity ? 'bg-warning' : undefined}
                />
              ) : null}
            </div>

            {data.atCapacity ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                <p className="font-medium">You are at capacity.</p>
                <p className="mt-0.5 text-muted-foreground">
                  Your vehicles keep working exactly as they are - you simply cannot add another
                  until you take a top-up or move up a plan.
                </p>
              </div>
            ) : null}

            <Separator />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Truck className="size-4 text-muted-foreground" />
                  {VEHICLE_TOPUP.name}
                  <span className="text-muted-foreground">
                    {formatCurrency(data.topUpPriceMonthly)}/month + GST
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {VEHICLE_TOPUP.description} Each one is its own line on the bill and can be
                  cancelled on its own.
                </p>
              </div>
              {canManage ? (
                <Button
                  onClick={() => buyTopUp.mutate()}
                  disabled={!data.canPurchaseTopUp || buyTopUp.isPending}
                  title={
                    data.canPurchaseTopUp
                      ? undefined
                      : `This plan allows up to ${data.topUpCeiling} top-ups.`
                  }
                >
                  <Plus className="mr-1 size-4" />
                  {buyTopUp.isPending ? 'Adding…' : 'Add a vehicle'}
                </Button>
              ) : null}
            </div>

            {activeTopUps.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Active top-ups
                </p>
                {activeTopUps.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate">
                        +1 vehicle · {formatCurrency(row.priceMonthly)}/month
                      </p>
                      <p className="text-2xs text-muted-foreground">
                        Since {inrDate(row.startsAt)}
                        {row.expiresAt ? ` · renews ${inrDate(row.expiresAt)}` : ''}
                        {row.paymentReference ? ` · ${row.paymentReference}` : ''}
                      </p>
                    </div>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => cancelTopUp.mutate(row.id)}
                        disabled={cancelTopUp.isPending}
                      >
                        <X className="mr-1 size-3.5" />
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Trackers                                                         */}
      {/* ---------------------------------------------------------------- */}
      {cover ? (
        <Card className={cover.uncovered > 0 ? 'border-accent/40' : undefined}>
          <CardHeader className="pb-3">
            <SectionHeader
              title="Trackers"
              description="A tracker reads the vehicle. Without one, the driver's phone is the only source and its figures are estimates."
            />
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-success/30 bg-success/[0.04] p-3">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Cpu className="size-3.5" />
                  Measured
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {cover.covered}
                  <span className="text-sm font-normal text-muted-foreground">
                    {' '}
                    of {cover.vehicles} vehicle{cover.vehicles === 1 ? '' : 's'}
                  </span>
                </p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  Real odometer, engine hours, fuel draw and ignition events.
                </p>
              </div>

              <div
                className={cn(
                  'rounded-lg border p-3',
                  cover.uncovered > 0
                    ? 'border-warning/40 bg-warning/[0.04]'
                    : 'border-border bg-muted/30',
                )}
              >
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Smartphone className="size-3.5" />
                  Estimated
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {cover.uncovered}
                  <span className="text-sm font-normal text-muted-foreground">
                    {' '}
                    on driver-app data
                  </span>
                </p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  {cover.uncovered > 0
                    ? 'Distance and fuel are worked out from the phone’s trail, so they carry an error - and a phone left behind reports nothing.'
                    : 'Every vehicle is measured.'}
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {VEHICLE_TRACKER.name}{' '}
                  <span className="text-muted-foreground">
                    {formatCurrency(cover.priceOneTime)} + GST, once per vehicle
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  No monthly charge and no expiry. Move it to another vehicle whenever you like.
                  {cover.ceiling !== null ? ` This plan covers up to ${cover.ceiling}.` : ''}
                </p>
              </div>
              {canManage ? (
                <Button
                  variant="outline"
                  onClick={() => buyTracker.mutate()}
                  disabled={!cover.canPurchase || buyTracker.isPending}
                  title={
                    cover.canPurchase
                      ? undefined
                      : cover.vehicles === 0
                        ? 'Add a vehicle first - a tracker is fitted to one.'
                        : 'You already hold a tracker for every vehicle.'
                  }
                >
                  <Plus className="mr-1 size-4" />
                  {buyTracker.isPending ? 'Adding…' : 'Add a tracker'}
                </Button>
              ) : null}
            </div>

            {activeTrackers.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Active trackers
                </p>
                {activeTrackers.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      {row.truckId ? (
                        <p className="truncate">
                          {row.truckRegistration ?? 'Fitted'}
                          {row.serialNumber ? ` · ${row.serialNumber}` : ''}
                        </p>
                      ) : canManage ? (
                        /* A tracker nobody can fit is money spent on nothing,
                           so the picker sits on the row itself rather than
                           behind a link to another screen. */
                        <Select
                          onValueChange={(truckId) => assignTracker.mutate({ id: row.id, truckId })}
                          disabled={assignTracker.isPending}
                        >
                          <SelectTrigger className="h-8 w-full max-w-[16rem] text-xs">
                            <SelectValue placeholder="Fit it to a vehicle…" />
                          </SelectTrigger>
                          <SelectContent>
                            {(vehicles.data ?? []).map((vehicle) => (
                              <SelectItem key={vehicle.id} value={vehicle.id}>
                                {vehicle.registrationNumber}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="truncate text-muted-foreground">Not fitted yet</p>
                      )}
                      <p className="mt-0.5 text-2xs text-muted-foreground">
                        {formatCurrency(row.pricePaid)} paid {inrDate(row.purchasedAt)}
                        {row.paymentReference ? ` · ${row.paymentReference}` : ''}
                      </p>
                    </div>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => retireTracker.mutate(row.id)}
                        disabled={retireTracker.isPending}
                      >
                        <X className="mr-1 size-3.5" />
                        Retire
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* The three plans                                                  */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PLAN_CATALOGUE.map((definition) => {
          const isCurrent = definition.tier === currentTier;
          const vehicles = plan.data?.usage.vehicles ?? 1;
          const yourQuote = quoteSubscription({
            tier: definition.tier,
            vehicles,
            billing: plan.data?.billingPeriod === 'YEARLY' ? 'yearly' : 'monthly',
          });

          /**
           * A plan that covers no vehicles, which is Free and only Free.
           *
           * Every per-vehicle line on this card would be wrong on it rather
           * than merely uninteresting: "1 vehicle included, then ₹75 each"
           * describes a charge that cannot be incurred, and quoting "₹0/month
           * for your 6 vehicles" invites the reader to believe Saarthi will
           * keep running six vehicles for nothing.
           */
          const vehicleless =
            definition.limits.maxTrucks === 0 && definition.limits.maxVehicleTopUps === 0;

          return (
            <Card
              key={definition.tier}
              className={cn(isCurrent && 'border-primary ring-1 ring-primary')}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{TIER_LABEL[definition.tier]}</CardTitle>
                  {isCurrent ? (
                    <Badge variant="default" size="sm">
                      Current
                    </Badge>
                  ) : null}
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {vehicleless ? (
                    'Free'
                  ) : (
                    <>
                      {formatCurrency(definition.priceMonthly)}
                      <span className="text-sm font-normal text-muted-foreground">
                        /month + GST
                      </span>
                    </>
                  )}
                </p>
                {/* What it would cost this tenant, not just the headline. The
                    number that decides a switch is the one for their own fleet,
                    with the tax they will actually be charged. */}
                <p className="text-xs text-muted-foreground">
                  {vehicleless
                    ? 'For an account that does not run a vehicle'
                    : `${formatCurrency(yourQuote.monthly.total)}/month for your ${vehicles} vehicle${
                        vehicles === 1 ? '' : 's'
                      }, GST included`}
                </p>
              </CardHeader>
              <CardContent className="space-y-1.5 pt-0">
                {definition.features.slice(0, 7).map((feature) => {
                  const entry = FEATURE_CATALOGUE.find((candidate) => candidate.key === feature);
                  return (
                    <p
                      key={feature}
                      className={cn(
                        'flex items-start gap-1.5 text-xs',
                        held.has(feature) ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      <Check className="mt-0.5 size-3 shrink-0" />
                      {entry?.name ?? humanizeEnum(feature)}
                    </p>
                  );
                })}
                {definition.features.length > 7 ? (
                  <p className="text-xs text-muted-foreground">
                    +{definition.features.length - 7} more
                  </p>
                ) : null}

                <div className="mt-3 space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
                  <p>
                    {vehicleless
                      ? 'No vehicle, no tracker, no telemetry'
                      : `1 vehicle included, then ${formatCurrency(VEHICLE_TOPUP.priceMonthly)} each`}
                  </p>
                  <p>
                    {definition.limits.maxMembers === null
                      ? 'Unlimited team members'
                      : `${definition.limits.maxMembers} login${definition.limits.maxMembers === 1 ? '' : 's'}`}
                    {vehicleless
                      ? ''
                      : ` · ${
                          definition.limits.maxDrivers === null
                            ? 'unlimited drivers'
                            : `up to ${definition.limits.maxDrivers} drivers`
                        }`}
                  </p>
                  {vehicleless ? null : (
                    <p>{definition.limits.trackingHistoryDays} days of tracking history</p>
                  )}
                </div>

                {canManage && !isCurrent ? (
                  <Button
                    variant="outline"
                    className="mt-3 w-full"
                    onClick={() => changePlan.mutate(definition.tier)}
                    disabled={changePlan.isPending}
                  >
                    {changePlan.isPending
                      ? 'Changing…'
                      : `Switch to ${TIER_LABEL[definition.tier]}`}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Plan and add-on prices are shown before GST; the monthly figure at the top and every charge
        taken include GST at {Math.round((plan.data?.gstRate ?? 0.18) * 100)}%. Add your GSTIN in
        organization settings and it appears on each invoice. Nothing is deleted by a plan change or
        a lapsed top-up - capacity is checked when you add a vehicle, so you can never lose one you
        already run. Payments run through the payment provider abstraction; locally that is the mock
        gateway, and every reference it issues is prefixed{' '}
        <code className="text-2xs">MOCK-</code> so a demo settlement can never be mistaken for a
        real one.
      </p>
    </div>
  );
}

export default SubscriptionPage;
