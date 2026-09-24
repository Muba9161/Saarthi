import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CreditCard, Info, Smartphone } from 'lucide-react';
import {
  Permission,
  TRACKER_PRODUCTS,
  formatCurrency,
  trackerProduct,
  type CheckoutSession,
  type TrackerProduct,
  type VehicleCapacity,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { payAndConfirm } from '@/features/payments/use-checkout';
import { TrackerProductImage } from '@/features/devices/tracker-product-image';
import { DriverAppInviteList, useDriverAppInviteStatus } from '@/features/drivers/driver-app-invite-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Adding a vehicle: its place on the plan, and how it will report.
 *
 * Settled on the last step of every add-vehicle form, and paid for in one go:
 *
 *  • **The ₹99 vehicle slot**, when the plan already covers every vehicle it
 *    can. Mandatory in that case; afterwards it is part of the monthly autopay.
 *  • **How it reports.** The Saarthi Driver App (free), the OBD tracker or the
 *    4G tracker. Choosing the app asks the owner to notify their drivers; once
 *    they have been asked it offers "Continue anyway" and keeps the trackers on
 *    offer.
 *
 * Whatever is due is added up into one final amount — every price already
 * includes GST — and taken in one Cashfree payment *before* the vehicle is
 * created. The server first confirms the vehicle would be accepted, so nobody
 * pays and is then refused. A tracker bought this way is fitted to the vehicle
 * the moment it exists.
 */

export type ConnectionChoice = 'APP' | TrackerProduct;

interface CapacityResponse extends VehicleCapacity {
  topUpPriceMonthly: number;
}

interface TrackerCoverage {
  activeTrackers: number;
  ceiling: number | null;
}

export interface OrderLine {
  label: string;
  note: string;
  amount: number;
}

export function useVehicleOnboarding(open: boolean) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canReadPlan = can(Permission.SUBSCRIPTION_READ);
  const canPay = can(Permission.SUBSCRIPTION_MANAGE);
  const canNotify = can(Permission.DRIVERS_MANAGE);

  // Always read fresh when the form opens: the price shown decides what is
  // charged, so it must never come from a cache older than the last vehicle.
  const capacity = useQuery({
    queryKey: ['subscription', 'capacity'],
    queryFn: () => api.get<CapacityResponse>('/subscriptions/capacity'),
    enabled: open && canReadPlan,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const coverage = useQuery({
    queryKey: ['subscription', 'trackers', 'coverage'],
    queryFn: () => api.get<TrackerCoverage>('/subscriptions/trackers/coverage'),
    enabled: open && canReadPlan,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const invites = useDriverAppInviteStatus(open && can(Permission.DRIVERS_READ));

  const [choice, setChoice] = React.useState<ConnectionChoice>('APP');
  const [paying, setPaying] = React.useState(false);
  /** A tracker already paid for in this dialog, waiting for its vehicle. */
  const paidTracker = React.useRef<string | null>(null);
  const { refetch: refetchCapacity } = capacity;
  const { refetch: refetchCoverage } = coverage;
  React.useEffect(() => {
    if (!open) return;
    setChoice('APP');
    paidTracker.current = null;
    if (canReadPlan) {
      void refetchCapacity();
      void refetchCoverage();
    }
  }, [open, canReadPlan, refetchCapacity, refetchCoverage]);

  const needsSlot = capacity.data?.atCapacity ?? false;
  const slotPrice = capacity.data?.topUpPriceMonthly ?? 0;
  const slotBlockedReason = !needsSlot
    ? null
    : !canPay
      ? 'Your plan is full. Ask the account owner to add this vehicle — it needs a paid vehicle slot.'
      : capacity.data && !capacity.data.canPurchaseTopUp
        ? 'Your plan cannot take more vehicles. Contact Saarthi to move to a larger plan.'
        : null;
  const trackersOffered =
    canPay && (!coverage.data || coverage.data.ceiling === null || coverage.data.activeTrackers < coverage.data.ceiling);
  const driversAlreadyAsked = (invites.data?.invitedDriverIds.length ?? 0) > 0;
  const tracker = choice === 'APP' ? null : trackerProduct(choice);

  /** What is paid today, line by line — every figure final, GST included. */
  const lines: OrderLine[] = [
    ...(needsSlot
      ? [{ label: 'Extra vehicle', note: 'per month · then in your monthly autopay', amount: slotPrice }]
      : []),
    ...(tracker ? [{ label: tracker.name, note: 'one-time', amount: tracker.price }] : []),
  ];
  const total = lines.reduce((sum, line) => sum + line.amount, 0);

  const submitLabel =
    total > 0
      ? `Pay ${formatCurrency(total)}`
      : driversAlreadyAsked
        ? 'Continue anyway'
        : 'Add vehicle';

  const refreshPlan = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['subscription'] });
  };

  /**
   * Take the one payment the vehicle needs, if any. Resolves `true` when the
   * vehicle may now be created.
   *
   * `vehicle` is the create payload: the server checks it would be accepted
   * (Aadhaar, vehicle type, plate) *before* any money is taken.
   */
  const payForVehicle = async (vehicle: Record<string, unknown>): Promise<boolean> => {
    // Read fresh: a slot bought on an earlier attempt must not be bought again.
    const fresh = canReadPlan ? (await capacity.refetch()).data : capacity.data;
    const slot = Boolean(fresh?.atCapacity);
    // Never charge an amount the owner was not shown: if the plan filled up
    // since the form opened, stop and let the new total show first.
    if (slot && !needsSlot) {
      toast.info('This vehicle needs an extra vehicle slot', {
        description: `Your plan is full, so ${formatCurrency(slotPrice)} is added to the total. Check it, then pay.`,
      });
      return false;
    }
    // Nor a tracker already paid for in this dialog.
    const product = choice !== 'APP' && !paidTracker.current ? choice : null;
    if (!slot && !product) return true;
    if (slot && slotBlockedReason) {
      toast.error(slotBlockedReason);
      return false;
    }

    setPaying(true);
    try {
      await api.post('/fleet/vehicles/check', vehicle);
    } catch (error) {
      setPaying(false);
      toast.error('This vehicle cannot be added', { description: errorMessage(error) });
      return false;
    }
    try {
      const order = await api.post<{ checkout: CheckoutSession | null; trackerId: string | null }>(
        '/subscriptions/vehicle-order',
        { slot, ...(product ? { trackerProduct: product } : {}) },
      );
      const status = await payAndConfirm(order.checkout);
      if (status !== 'SUCCEEDED') {
        toast.info('Payment not completed', {
          description: 'Nothing was added and nothing was charged. Try again when you are ready.',
        });
        return false;
      }
      if (order.trackerId) paidTracker.current = order.trackerId;
      return true;
    } catch (error) {
      toast.error('Could not take the payment', { description: errorMessage(error) });
      return false;
    } finally {
      setPaying(false);
      refreshPlan();
    }
  };

  /** Fit the tracker paid for above to the vehicle just created. */
  const finishConnection = async (vehicleId: string): Promise<void> => {
    const trackerId = paidTracker.current;
    if (!trackerId) return;
    try {
      await api.post(`/subscriptions/trackers/${trackerId}/assign`, { truckId: vehicleId });
      paidTracker.current = null;
      toast.success('Tracker ordered for this vehicle', { description: 'Fit it, then pair it from the Devices screen.' });
    } catch (error) {
      toast.warning('Vehicle added — fit the tracker from Settings → Subscription', {
        description: errorMessage(error),
      });
    } finally {
      refreshPlan();
    }
  };

  return {
    choice,
    setChoice,
    needsSlot,
    slotBlockedReason,
    trackersOffered,
    driversAlreadyAsked,
    canNotify,
    lines,
    total,
    submitLabel,
    paying,
    payForVehicle,
    finishConnection,
    open,
  };
}

export type VehicleOnboarding = ReturnType<typeof useVehicleOnboarding>;

function ChoiceCard({
  selected,
  disabled,
  onSelect,
  title,
  price,
  note,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  price: string;
  note: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'group flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-primary/[0.04] ring-1 ring-primary' : 'border-border/70 hover:border-primary/40',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {children}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        {selected ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
      </div>
      <p className="text-sm font-semibold tabular-nums">{price}</p>
      <p className="text-2xs leading-relaxed text-muted-foreground">{note}</p>
    </button>
  );
}

/** The add-vehicle form's last step. */
export function VehicleConnectionStep({ onboarding }: { onboarding: VehicleOnboarding }) {
  const { choice, setChoice } = onboarding;

  return (
    <div className="space-y-4">
      {onboarding.needsSlot ? (
        <Alert variant={onboarding.slotBlockedReason ? 'warning' : 'info'}>
          <CreditCard className="size-4" />
          <AlertTitle>{onboarding.slotBlockedReason ? 'Your plan is full' : 'This is an extra vehicle'}</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            {onboarding.slotBlockedReason ??
              'Your plan already covers the vehicles you have, so this one needs an extra vehicle slot. It is included in the total below and then in your monthly autopay.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-medium">How will this vehicle report its location?</p>
        <div role="radiogroup" aria-label="Tracking option" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ChoiceCard
            selected={choice === 'APP'}
            onSelect={() => setChoice('APP')}
            title="Saarthi Driver App"
            price="Free"
            note="Location from the driver's phone."
          >
            <span className="flex aspect-[3/2] items-center justify-center rounded-lg bg-muted/50">
              <Smartphone className="size-8 text-primary" aria-hidden />
            </span>
          </ChoiceCard>
          {TRACKER_PRODUCTS.map((product) => (
            <ChoiceCard
              key={product.product}
              selected={choice === product.product}
              disabled={!onboarding.trackersOffered}
              onSelect={() => setChoice(product.product)}
              title={product.name}
              price={`${formatCurrency(product.price)}, once`}
              note={product.description}
            >
              <TrackerProductImage product={product} className="aspect-[3/2] rounded-lg" />
            </ChoiceCard>
          ))}
        </div>
        {!onboarding.trackersOffered ? (
          <p className="text-xs text-muted-foreground">
            Trackers are bought by the account owner, within your plan's tracker limit.
          </p>
        ) : null}
      </div>

      {choice === 'APP' ? (
        onboarding.driversAlreadyAsked ? (
          <Alert variant="info">
            <Info className="size-4" />
            <AlertTitle>Your drivers have been asked to install the app</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              You can continue with the Driver App. For engine, fuel and fault data without relying on
              a phone, pick the OBD or 4G tracker above instead.
            </AlertDescription>
          </Alert>
        ) : onboarding.canNotify ? (
          <section aria-labelledby="notify-drivers" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="notify-drivers" className="text-sm font-medium">
                Ask your drivers to download the app
              </h3>
              <Badge size="sm" variant="muted">
                Recommended
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              The vehicle reports only while a driver has the Saarthi Driver App.
            </p>
            <DriverAppInviteList enabled={onboarding.open} />
          </section>
        ) : null
      ) : null}

      {onboarding.total > 0 ? (
        <section aria-labelledby="order-total" className="rounded-xl border border-border bg-muted/30 p-4">
          <h3 id="order-total" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            To pay today
          </h3>
          <dl className="mt-2 space-y-1.5 text-sm">
            {onboarding.lines.map((line) => (
              <div key={line.label} className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0">
                  {line.label} <span className="text-2xs text-muted-foreground">· {line.note}</span>
                </dt>
                <dd className="tabular-nums">{formatCurrency(line.amount)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 font-semibold">
              <dt>Total</dt>
              <dd className="text-base tabular-nums">{formatCurrency(onboarding.total)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-2xs text-muted-foreground">
            One payment through Cashfree. The vehicle is added the moment it succeeds.
          </p>
        </section>
      ) : null}
    </div>
  );
}
