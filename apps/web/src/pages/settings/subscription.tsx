import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Cpu,
  Plus,
  Smartphone,
  Truck,
  X,
} from 'lucide-react';
import {
  Permission,
  type PlanTier,
  TRACKER_PRODUCTS,
  VEHICLE_TOPUP,
  formatCurrency,
  humanizeEnum,
  trackerCharge,
  trackerProduct,
  type CheckoutSession,
  type TrackerProduct,
  type TrackerProductDefinition,
  type VehicleCapacity,
} from '@saarthi/shared';
import type { Paginated, TruckSummary } from '@/lib/api-types';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { useCheckout, useCheckoutReturn } from '@/features/payments/use-checkout';
import { BillingCard, type BillingStatus } from '@/features/subscriptions/billing-card';
import { BillingHistory } from '@/features/subscriptions/billing-history';
import { TrackerShop } from '@/features/subscriptions/tracker-shop';

/**
 * Subscription, capacity and hardware.
 *
 * Saarthi is sold by the vehicle, so the first thing this page answers is "how
 * many vehicles can I still add, and what am I paying". It manages the plan
 * chosen at registration — billing, capacity and trackers — and deliberately
 * offers no plan switching: the plan is chosen once, when the account is made.
 *
 * Every price is shown as the final amount — GST is inside it, trackers
 * included.
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
  /** GST included. */
  priceMonthly: number | null;
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
  product: TrackerProduct;
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
  products: TrackerProductDefinition[];
}

function inrDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN');
}

export function SubscriptionPage(): React.ReactElement {
  const { session, can } = useAuth();
  const queryClient = useQueryClient();

  const canManage = can(Permission.SUBSCRIPTION_MANAGE);
  const hasOrganization = Boolean(session?.organization);

  /** The tracker the marketing page's Buy button asked for, highlighted in the shop. */
  const [highlighted, setHighlighted] = React.useState<TrackerProduct | null>(null);

  /*
   * `?buyTracker=<product>` — the marketing page's Buy button lands here
   * (through sign-in if needed) and brings that tracker into view. The
   * parameter is removed once read, so a refresh does not repeat it.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTracker = searchParams.get('buyTracker');
  React.useEffect(() => {
    if (!requestedTracker) return;
    const requested = TRACKER_PRODUCTS.find((product) => product.product === requestedTracker);
    if (requested && canManage) setHighlighted(requested.product);
    else if (requested) toast.info('Ask your account owner to buy trackers for this account.');
    setSearchParams(
      (current) => {
        current.delete('buyTracker');
        return current;
      },
      { replace: true },
    );
  }, [requestedTracker, canManage, setSearchParams]);

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

  const billing = useQuery({
    queryKey: ['subscription', 'billing'],
    queryFn: () => api.get<BillingStatus | null>('/subscriptions/billing'),
    enabled: hasOrganization,
  });

  const refresh = React.useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['subscription'] });
    void queryClient.invalidateQueries({ queryKey: ['session'] });
  }, [queryClient]);

  const checkout = useCheckout(refresh);
  const confirmAutopay = React.useCallback(async () => {
    const status = await api.post<BillingStatus | null>('/subscriptions/billing/autopay/refresh');
    if (status?.autopay?.status === 'ACTIVE') toast.success('Autopay is set up');
    else toast.info('Autopay is waiting for your bank to confirm');
    refresh();
  }, [refresh]);
  // Back from Cashfree: a payment (`?order_id=`) or an autopay authorisation
  // (`?subscription_id=`), each confirmed with the API.
  useCheckoutReturn({ onPayment: refresh, onSubscription: confirmAutopay });

  const buyTopUp = useMutation({
    mutationFn: () =>
      api.post<{ checkout: CheckoutSession | null }>('/subscriptions/topups', {}),
    onSuccess: (result) => {
      if (!result.checkout) {
        toast.success('Capacity added', {
          description: 'You can add one more vehicle straight away.',
        });
      }
      void checkout.run(result.checkout, 'Capacity added - you can add one more vehicle.');
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
    mutationFn: (order: { product: TrackerProduct; quantity: number }) =>
      api.post<{ checkout: CheckoutSession | null }>('/subscriptions/trackers', order),
    onSuccess: (result, order) => {
      setHighlighted(null);
      const added = order.quantity > 1 ? `${order.quantity} trackers added` : 'Tracker added';
      if (!result.checkout) {
        toast.success(added, {
          description: 'Fit them to your vehicles below, then pair them from the Devices screen.',
        });
      }
      void checkout.run(result.checkout, `${added} - fit them to your vehicles below.`);
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

  const data = capacity.data;
  const activeTopUps = (topUps.data ?? []).filter((row) => row.status === 'ACTIVE');
  const activeTrackers = (trackers.data ?? []).filter((row) => row.status === 'ACTIVE');
  const cover = coverage.data;

  /** Why a tracker cannot be bought right now — the same rule the API enforces. */
  const trackerBlockedReason =
    cover && !cover.canPurchase
      ? cover.vehicles === 0
        ? 'Add a vehicle first - a tracker is fitted to one. Then come back here to buy it.'
        : cover.ceiling !== null && cover.activeTrackers >= cover.ceiling
          ? `Your plan covers up to ${cover.ceiling} trackers. Moving to Business removes the limit.`
          : 'You already hold a tracker for every vehicle. Add the vehicle first, then buy its tracker.'
      : null;

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
              description={`${plan.data.name} · billed monthly`}
            />
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                {/* The figure that leaves the account each month. Prices are
                    final, so there is no tax to add to it. */}
                <p className="text-3xl font-semibold tabular-nums">
                  {formatCurrency(plan.data.monthlyTotal)}
                  <span className="text-base font-normal text-muted-foreground">/month</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatCurrency(plan.data.priceMonthly)} plan
                  {activeTopUps.length > 0
                    ? ` + ${activeTopUps.length} × ${formatCurrency(VEHICLE_TOPUP.priceMonthly)} per vehicle`
                    : ''}
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

      {billing.data ? (
        <BillingCard
          billing={billing.data}
          canManage={canManage}
          onCheckout={checkout.run}
          busy={checkout.busy}
          onChanged={refresh}
        />
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
                    {formatCurrency(data.topUpPriceMonthly)}/month
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
                  disabled={!data.canPurchaseTopUp || buyTopUp.isPending || checkout.busy}
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
                  {cover.vehicles === 0
                    ? 'No vehicles on the account yet.'
                    : cover.uncovered > 0
                      ? 'Distance and fuel are worked out from the phone’s trail, so they carry an error - and a phone left behind reports nothing.'
                      : 'Every vehicle is measured.'}
                </p>
              </div>
            </div>

            <Separator />

            <TrackerShop
              products={cover.products}
              canManage={canManage}
              canPurchase={cover.canPurchase}
              remaining={cover.remaining ?? 0}
              blockedReason={trackerBlockedReason}
              payingProduct={buyTracker.isPending || checkout.busy ? (buyTracker.variables?.product ?? null) : null}
              highlightedProduct={highlighted}
              onPay={(product, quantity) => buyTracker.mutate({ product, quantity })}
            />

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
                        {trackerProduct(row.product).name} · {formatCurrency(trackerCharge(row.pricePaid).total)}
                        paid {inrDate(row.purchasedAt)}
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
      {/* Payment history                                                  */}
      {/* ---------------------------------------------------------------- */}
      <BillingHistory enabled={hasOrganization} />

      <p className="text-xs text-muted-foreground">
        Every price shown is the final amount you pay. Add your GSTIN in organization
        settings and it appears on each invoice. Nothing is deleted by a lapsed top-up - capacity is checked when you add a vehicle, so you can never lose one you
        already run. Payments are confirmed with the gateway before anything is added; with the
        mock gateway every reference is prefixed <code className="text-2xs">MOCK-</code> so a demo
        settlement can never be mistaken for a real one.
      </p>


    </div>
  );
}

export default SubscriptionPage;
