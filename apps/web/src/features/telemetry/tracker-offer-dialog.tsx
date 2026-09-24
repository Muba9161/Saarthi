import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Cpu, Smartphone } from 'lucide-react';
import {
  Permission,
  TRACKER_PRODUCTS,
  type TrackerProduct,
  formatCurrency,
  type CheckoutSession,
  type TrackerProductDefinition,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useCheckout } from '@/features/payments/use-checkout';
import { TrackerProductImage } from '@/features/devices/tracker-product-image';
import { DriverAppInviteList } from '@/features/drivers/driver-app-invite-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

/**
 * Connect a vehicle: buy a Saarthi tracker, or have the drivers use the Driver App.
 *
 * Shown when an owner opens telemetry on a vehicle with nothing reporting from
 * it. A fleet owner running trucks needs a tracker for live telemetry, so for
 * them it opens by itself; anyone may open it from the telemetry screen. It
 * never blocks: "Continue" closes it and the owner carries on.
 */

function ProductCard({
  product,
  canBuy,
  buying,
  onBuy,
}: {
  product: TrackerProductDefinition;
  canBuy: boolean;
  buying: boolean;
  onBuy: () => void;
}) {
  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-border/70 p-3 transition-colors duration-300 hover:border-primary/40">
      <TrackerProductImage product={product} className="aspect-[3/2] rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{product.name}</p>
          <Badge size="sm" variant="info">
            {product.connectivity}
          </Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{product.description}</p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold tabular-nums">
          {formatCurrency(product.price)}
          <span className="ml-1 text-2xs font-normal text-muted-foreground">once</span>
        </p>
        {canBuy ? (
          <Button size="sm" onClick={onBuy} loading={buying}>
            Buy
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function TrackerOfferDialog({
  open,
  onOpenChange,
  vehicleId,
  vehicleLabel,
  onPurchased,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  vehicleLabel: string;
  onPurchased: () => void;
}) {
  const { can } = useAuth();
  const canBuy = can(Permission.SUBSCRIPTION_MANAGE);
  const canNotify = can(Permission.DRIVERS_MANAGE);

  const checkout = useCheckout(onPurchased);

  const buy = useMutation({
    mutationFn: (product: TrackerProduct) =>
      api.post<{ checkout: CheckoutSession | null }>('/subscriptions/trackers', {
        product,
        truckId: vehicleId,
      }),
    onSuccess: async (result) => {
      if (!result.checkout) toast.success('Tracker added', { description: 'Fit it, then pair it from Devices.' });
      await checkout.run(result.checkout, 'Tracker added - fit it, then pair it from Devices.');
      onOpenChange(false);
    },
    onError: (error) => toast.error('Could not buy the tracker', { description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="size-5 text-primary" aria-hidden />
            Connect {vehicleLabel}
          </DialogTitle>
          <DialogDescription>
            Live telemetry reads the vehicle itself — engine, fuel, odometer and faults. Fit a Saarthi
            tracker, or have your drivers use the Saarthi Driver App for location in the meantime.
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby="tracker-options" className="space-y-3">
          <h3 id="tracker-options" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Saarthi trackers
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TRACKER_PRODUCTS.map((product) => (
              <ProductCard
                key={product.product}
                product={product}
                canBuy={canBuy}
                buying={(buy.isPending && buy.variables === product.product) || checkout.busy}
                onBuy={() => buy.mutate(product.product)}
              />
            ))}
          </div>
          {!canBuy ? (
            <p className="text-xs text-muted-foreground">Ask the account owner to buy a tracker.</p>
          ) : null}
        </section>

        {canNotify ? (
          <>
            <Separator />
            <section aria-labelledby="driver-app" className="space-y-3">
              <h3
                id="driver-app"
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                <Smartphone className="size-3.5" aria-hidden />
                Saarthi Driver App
              </h3>
              <p className="text-xs text-muted-foreground">
                Ask your drivers to download the app. It reports the vehicle's location from their
                phone, and the Bluetooth OBD tracker reports through it.
              </p>
              <DriverAppInviteList enabled={open} />
            </section>
          </>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
