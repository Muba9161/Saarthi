import * as React from 'react';
import { toast } from 'sonner';
import { Route } from 'lucide-react';
import { formatPercent } from '@saarthi/shared';
import { errorMessage } from '@/lib/api-client';
import { WizardField } from '@/components/common/form-wizard';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useEnableBackhaul } from './use-backhaul';
import type { BackhaulOffer } from './types';

const DETOUR_OPTIONS_KM = [25, 50, 100, 200] as const;
const DEFAULT_DETOUR_KM = 50;

/**
 * "Enable backhaul" — the commission is stated before anything is switched on.
 *
 * The owner agrees to it explicitly, with a checkbox rather than by clicking
 * through, because it is a higher rate than an ordinary job.
 */
export function EnableBackhaulDialog({
  tripId,
  vehicleLabel,
  freeAt,
  commission,
  open,
  onOpenChange,
}: {
  tripId: string;
  vehicleLabel: string;
  /** Where the truck becomes free — the trip's destination. */
  freeAt: string;
  commission: BackhaulOffer['commission'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [agreed, setAgreed] = React.useState(false);
  const [detourKm, setDetourKm] = React.useState<number>(DEFAULT_DETOUR_KM);
  const enable = useEnableBackhaul(tripId);

  const rate = formatPercent(commission.rate * 100);
  const ordinary = formatPercent(commission.ordinaryRate * 100);

  // Consent is given each time the dialog is opened, never remembered from a
  // dialog that was dismissed.
  const changeOpen = (next: boolean): void => {
    if (!next) setAgreed(false);
    onOpenChange(next);
  };

  // Awaited rather than given per-call callbacks: enabling swaps this dialog
  // out of the page, and a callback on an unmounted mutation is not run.
  const submit = async (): Promise<void> => {
    try {
      await enable.mutateAsync({ detourToleranceKm: detourKm });
      toast.success('Backhaul enabled', {
        description: 'Customers on the way home are listed on this trip.',
      });
      changeOpen(false);
    } catch (caught) {
      toast.error('Could not enable backhaul', { description: errorMessage(caught) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enable backhaul for {vehicleLabel}</DialogTitle>
          <DialogDescription>
            Find paid work for the way home from {freeAt}, so the truck does not run back empty.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ol className="space-y-2 text-sm">
            <Step index={1}>
              We list customers who need material delivered along your way home.
            </Step>
            <Step index={2}>
              For each one, we show sellers near your truck, so you buy close by and deliver on the
              way.
            </Step>
            <Step index={3}>
              You bid. If the customer awards you, it runs like any other order.
            </Step>
          </ol>

          <section
            aria-labelledby="backhaul-commission"
            className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/10 p-3"
          >
            <h3 id="backhaul-commission" className="text-sm font-semibold">
              Saarthi backhaul commission: {rate} of profit
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              On a job you win through backhaul, Saarthi takes {rate} of your profit, instead of the
              usual {ordinary}. Profit is your price to the customer minus what you pay the seller.
              It is held back from the customer&apos;s final 70% payment. Enabling is free. Nothing
              is charged unless you win a job.
            </p>
          </section>

          <WizardField
            label="How far off the way home will you go?"
            hint="Work that adds more detour than this is not shown."
          >
            <Select value={String(detourKm)} onValueChange={(value) => setDetourKm(Number(value))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DETOUR_OPTIONS_KM.map((km) => (
                  <SelectItem key={km} value={String(km)}>
                    Up to {km} km
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>

          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Checkbox
              id="backhaul-agree"
              checked={agreed}
              onCheckedChange={(value) => setAgreed(value === true)}
              className="mt-0.5"
            />
            <label htmlFor="backhaul-agree" className="cursor-pointer text-sm leading-snug">
              I agree to Saarthi&apos;s {rate} backhaul commission on the profit of any job I win
              through backhaul.
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => changeOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!agreed} loading={enable.isPending}>
            <Route className="size-4" />
            Enable backhaul
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xs font-semibold text-primary tabular-nums"
      >
        {index}
      </span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}
