import * as React from 'react';
import { Check, Minus, Plus, ShieldCheck, X } from 'lucide-react';
import {
  TrackerProduct,
  formatCurrency,
  type TrackerProductDefinition,
} from '@saarthi/shared';
import { TrackerProductImage } from '@/features/devices/tracker-product-image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Buying Saarthi trackers: each one shown as it is — its picture, what it
 * does and its final price — with a quantity to choose and one amount to pay.
 *
 * The comparison below the cards is made only of what the products are: how
 * each one gets its data out, and what that means on the road. Nothing here is
 * a spec sheet invented for marketing.
 */

/** What each tracker does, on the points an owner actually decides by. */
const COMPARISON: { label: string; values: Record<TrackerProduct, boolean | string> }[] = [
  {
    label: 'Reads the vehicle — odometer, engine hours, fuel, ignition',
    values: { [TrackerProduct.OBD_BLUETOOTH]: true, [TrackerProduct.CONNECTED_4G]: true },
  },
  {
    label: 'Reports with no phone on board',
    values: { [TrackerProduct.OBD_BLUETOOTH]: false, [TrackerProduct.CONNECTED_4G]: true },
  },
  {
    label: 'Needs the driver’s phone and the Saarthi Driver App',
    values: { [TrackerProduct.OBD_BLUETOOTH]: true, [TrackerProduct.CONNECTED_4G]: false },
  },
  {
    label: 'How it connects',
    values: { [TrackerProduct.OBD_BLUETOOTH]: 'Bluetooth, through the phone', [TrackerProduct.CONNECTED_4G]: 'Its own 4G connection' },
  },
];

const RECOMMENDED = TrackerProduct.CONNECTED_4G;

function ComparisonValue({ value }: { value: boolean | string }) {
  if (typeof value === 'string') return <span className="text-xs">{value}</span>;
  return value ? (
    <Check className="mx-auto size-4 text-success" aria-label="Yes" />
  ) : (
    <X className="mx-auto size-4 text-muted-foreground" aria-label="No" />
  );
}

function QuantityStepper({
  value,
  max,
  onChange,
  label,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border" role="group" aria-label={`${label} quantity`}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        aria-label="One fewer"
      >
        <Minus className="size-3.5" />
      </Button>
      <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="One more"
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

function ProductCard({
  product,
  canBuy,
  maxQuantity,
  blockedReason,
  paying,
  highlighted,
  onPay,
}: {
  product: TrackerProductDefinition;
  canBuy: boolean;
  maxQuantity: number;
  blockedReason: string | null;
  paying: boolean;
  highlighted: boolean;
  onPay: (quantity: number) => void;
}) {
  const [quantity, setQuantity] = React.useState(1);
  const ref = React.useRef<HTMLElement>(null);
  const recommended = product.product === RECOMMENDED;
  const total = product.price * quantity;

  // Keep the chosen quantity within what can still be bought.
  React.useEffect(() => {
    setQuantity((current) => Math.min(Math.max(1, current), Math.max(1, maxQuantity)));
  }, [maxQuantity]);

  React.useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlighted]);

  return (
    <article
      ref={ref}
      aria-labelledby={`tracker-${product.product}`}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow',
        recommended ? 'border-primary/40' : 'border-border',
        highlighted && 'ring-2 ring-primary',
      )}
    >
      <div className="relative">
        <TrackerProductImage product={product} className="aspect-[16/9]" />
        {recommended ? (
          <Badge className="absolute left-3 top-3" variant="default">
            Recommended
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={`tracker-${product.product}`} className="text-base font-semibold tracking-tight">
            {product.name}
          </h3>
          <p className="text-lg font-semibold tabular-nums">
            {formatCurrency(product.price)}
            <span className="ml-1 text-2xs font-normal text-muted-foreground">once, per vehicle</span>
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{product.description}</p>

        <div className="mt-auto space-y-3 border-t border-border pt-3">
          {canBuy ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Quantity</span>
                <QuantityStepper value={quantity} max={maxQuantity} onChange={setQuantity} label={product.name} />
              </div>
              {maxQuantity > 1 ? (
                <p className="text-2xs text-muted-foreground">
                  Up to {maxQuantity} - one for each vehicle without a tracker.
                </p>
              ) : null}
              <Button className="w-full" onClick={() => onPay(quantity)} loading={paying} disabled={paying}>
                <ShieldCheck className="size-4" aria-hidden />
                Pay {formatCurrency(total)}
              </Button>
            </>
          ) : blockedReason ? (
            <p className="rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-xs leading-relaxed">
              {blockedReason}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function TrackerShop({
  products,
  canManage,
  canPurchase,
  remaining,
  blockedReason,
  payingProduct,
  highlightedProduct,
  onPay,
}: {
  products: readonly TrackerProductDefinition[];
  canManage: boolean;
  canPurchase: boolean;
  /** How many more trackers the fleet and plan can take. */
  remaining: number;
  blockedReason: string | null;
  payingProduct: TrackerProduct | null;
  highlightedProduct: TrackerProduct | null;
  onPay: (product: TrackerProduct, quantity: number) => void;
}) {
  const canBuy = canManage && canPurchase && remaining > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {products.map((product) => (
          <ProductCard
            key={product.product}
            product={product}
            canBuy={canBuy}
            maxQuantity={Math.max(1, remaining)}
            blockedReason={canManage ? blockedReason : 'Ask the account owner to buy trackers.'}
            paying={payingProduct === product.product}
            highlighted={highlightedProduct === product.product}
            onPay={(quantity) => onPay(product.product, quantity)}
          />
        ))}
      </div>

      <section aria-labelledby="tracker-compare" className="overflow-hidden rounded-xl border border-border">
        <h3 id="tracker-compare" className="border-b border-border bg-muted/30 px-4 py-2.5 text-sm font-semibold">
          Why the 4G tracker is the better choice
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium" scope="col">
                <span className="sr-only">Feature</span>
              </th>
              {products.map((product) => (
                <th key={product.product} className="w-32 px-2 py-2 text-center font-medium sm:w-44" scope="col">
                  {product.name.replace('Saarthi ', '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.label} className="border-t border-border/60">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  {row.label}
                </th>
                {products.map((product) => (
                  <td key={product.product} className="px-2 py-2 text-center text-muted-foreground">
                    <ComparisonValue value={row.values[product.product]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          The OBD tracker only reports while a driver&rsquo;s phone with the Saarthi Driver App is in
          the vehicle. The 4G tracker carries its own connection, so the vehicle keeps reporting even
          when no phone is on board.
        </p>
      </section>
    </div>
  );
}
