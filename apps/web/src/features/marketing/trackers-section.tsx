import { Link } from 'react-router-dom';
import { Check, Minus, ShoppingCart, Signal, Smartphone } from 'lucide-react';
import { TRACKER_PRODUCTS, TrackerProduct, formatCurrency } from '@saarthi/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import { TrackerProductImage } from '@/features/devices/tracker-product-image';
import { Section, SectionHeading } from './marketing-chrome';
import { Reveal, RevealGroup, RevealItem } from './motion-extras';
import { cn } from '@/lib/utils';

/**
 * Saarthi trackers, in their own band after pricing.
 *
 * A tracker is a one-time hardware purchase, not part of any plan, so it is
 * sold here rather than on the plan cards: the cards stay about what renews,
 * and this band has room to show the product and say what it changes.
 *
 * Name, price and description come from `TRACKER_PRODUCTS`, the list checkout
 * charges from. The advantages below are the marketing copy for each unit.
 */

const ADVANTAGES: Record<TrackerProduct, readonly string[]> = {
  [TrackerProduct.OBD_BLUETOOTH]: [
    'Plugs straight into the vehicle’s OBD port',
    'Reads the engine: ignition, odometer, engine hours and fault codes',
    'Reports through the Saarthi Driver App over Bluetooth',
    'The lowest-cost way to measured data',
  ],
  [TrackerProduct.CONNECTED_4G]: [
    'Its own 4G connection - no phone needed on board',
    'Live location even when the driver’s phone is off or left behind',
    'Ignition on and off, so trips start and end themselves',
    'Harsh braking and over-speeding alerts',
  ],
};

/** True of both units — the terms, stated once. */
const SHARED_TERMS = [
  'Charged once - no monthly fee and no data charge',
  'One per vehicle, and it moves to your next vehicle free',
  'Fit it any time from the vehicle’s Telemetry screen',
] as const;

/**
 * Where "Buy" goes. Payment happens inside the app, on the subscription
 * screen, because a tracker is bought for an account and fitted to one of its
 * vehicles: a signed-in visitor goes straight there, anyone else signs in
 * first and is brought back, and a new visitor creates an account, adds the
 * vehicle, then buys it.
 */
function useBuyLinks(product: TrackerProduct) {
  const { status } = useAuth();
  const buyPath = `/settings/subscription?buyTracker=${product}`;
  return {
    signedIn: status === 'authenticated',
    buy: status === 'authenticated' ? buyPath : `/login?next=${encodeURIComponent(buyPath)}`,
    register: '/register',
  };
}

function TrackerCard({ product }: { product: (typeof TRACKER_PRODUCTS)[number] }) {
  const links = useBuyLinks(product.product);
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm">
      {/* Fixed dark frame: a photograph is one exposure and does not follow the theme. */}
      <div className="relative bg-neutral-950">
        <TrackerProductImage product={product} className="aspect-[3/2]" />
        <span className="absolute left-4 top-4 rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-2xs font-medium uppercase tracking-[0.14em] text-white/85 backdrop-blur-sm">
          {product.connectivity}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <h3 className="text-lg font-semibold tracking-[-0.01em]">{product.name}</h3>
          <p className="text-right">
            <span className="block text-2xl font-semibold tabular-nums tracking-[-0.02em]">
              {formatCurrency(product.price)}
            </span>
            <span className="block text-2xs uppercase tracking-[0.14em] text-muted-foreground">
              once
            </span>
          </p>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{product.description}</p>

        <ul className="mt-5 flex-1 space-y-2.5 border-t border-border/50 pt-5">
          {ADVANTAGES[product.product].map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-sm leading-snug">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" strokeWidth={3} aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 space-y-2.5">
          <Button variant="gradient" className="w-full rounded-full" asChild>
            <Link to={links.buy}>
              <ShoppingCart className="size-4" />
              Buy {product.name}
            </Link>
          </Button>
          {links.signedIn ? null : (
            <p className="text-center text-2xs text-muted-foreground">
              New to Saarthi?{' '}
              <Link to={links.register} className="font-medium text-foreground underline underline-offset-2">
                Create an account
              </Link>
              , add your vehicle, then buy its tracker.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

export function TrackersSection() {
  return (
    <Section id="trackers" width="wide" tone="raised">
      <SectionHeading
        eyebrow="Saarthi trackers"
        title="Measured, not estimated"
        body="Saarthi works on the driver's phone alone. Fit a tracker and the numbers come from the vehicle itself - location, engine and driving - whether or not anyone brings a phone."
      />

      <RevealGroup className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-2" stagger={0.08}>
        {TRACKER_PRODUCTS.map((product) => (
          <RevealItem key={product.product} className="h-full">
            <TrackerCard product={product} />
          </RevealItem>
        ))}
      </RevealGroup>

      <Reveal delay={0.05}>
        <ul className="mx-auto mt-6 flex max-w-5xl flex-col items-center justify-center gap-x-8 gap-y-2 text-center text-xs text-muted-foreground sm:flex-row">
          {SHARED_TERMS.map((line) => (
            <li key={line} className="flex items-center gap-2">
              <Check className="size-3 shrink-0 text-primary" strokeWidth={3} aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="mx-auto mt-16 max-w-5xl">
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Read this before you decide
          </p>
          <h3 className="mt-1.5 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
            What Saarthi can actually know
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Your driver&rsquo;s phone reports the location, but a phone is not the vehicle, and
            everything worked out from its trail is an estimate. Here is exactly what changes when
            a tracker is fitted, so you know which numbers you can act on.
          </p>
        </div>
      </Reveal>
      <div className="mx-auto max-w-5xl">
        <DataSources />
      </div>
    </Section>
  );
}

/**
 * Where the numbers come from, with and without a tracker.
 *
 * This is the section a fleet needs most and the one a pricing page usually
 * omits. Saarthi works without hardware — the driver's phone reports location —
 * but a phone can be left on a desk, run flat or lose signal, and everything
 * derived from its trail is then an estimate. Saying so is not a weakness to
 * hide: an operator who knows a figure is estimated treats it as one, and an
 * operator who does not makes a decision on a number that was never measured.
 */
function DataSources() {
  const columns = [
    {
      icon: Smartphone,
      eyebrow: 'Included on every vehicle plan',
      title: 'Driver app only',
      claim: 'Estimated',
      claimTone: 'warning' as const,
      gives: [
        'Live location while the app is running',
        'Trip start and end as the driver marks them',
        'Distance from the phone’s own GPS trail',
        'Fuel and expenses as the driver enters them',
        'SOS, hazard alerts and duty hours',
      ],
      limits: [
        'A phone left behind, switched off or out of charge reports nothing, and the vehicle looks parked.',
        'No signal means a gap in the trail, so distance and trip time come out short.',
        'Odometer, fuel use and idling are worked out from the trail rather than read, so they carry an error.',
        'Nothing about the engine - ignition, engine hours, coolant, fault codes - is visible at all.',
      ],
    },
    {
      icon: Signal,
      eyebrow: `From ${formatCurrency(Math.min(...TRACKER_PRODUCTS.map((product) => product.price)))}, once per vehicle`,
      title: 'With a Saarthi tracker',
      claim: 'Measured',
      claimTone: 'success' as const,
      gives: [
        'Location whether or not anyone brings a phone',
        'Ignition on and off, so trips start themselves',
        'Real odometer, engine hours and idling time',
        'Actual fuel draw, and refuel or drain events',
        'Harsh braking, over-speeding and fault codes',
      ],
      limits: [
        'Needs fitting to the vehicle. Any Saarthi workshop or your own auto-electrician can do it.',
        'One tracker covers one vehicle. Vehicles without one keep working on driver-app data.',
        'Choose the Bluetooth OBD unit, which reports through the driver app, or the 4G tracker, which reports on its own.',
        'Fleet owners running trucks need one for live telemetry.',
      ],
    },
  ];

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card/30 backdrop-blur-sm">
      <div className="grid grid-cols-1 divide-y divide-border/60 md:grid-cols-2 md:divide-x md:divide-y-0">
        {columns.map((column) => (
          <div key={column.title} className="p-6 sm:p-7">
            <div className="flex flex-wrap items-center gap-2.5">
              <column.icon className="size-4 text-muted-foreground" aria-hidden />
              <h3 className="text-sm font-semibold">{column.title}</h3>
              <Badge variant={column.claimTone} size="sm">
                {column.claim}
              </Badge>
            </div>
            <p className="mt-1 text-2xs uppercase tracking-[0.14em] text-muted-foreground">
              {column.eyebrow}
            </p>

            <ul className="mt-5 space-y-2">
              {column.gives.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-sm leading-snug">
                  <Check
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0',
                      column.claimTone === 'success' ? 'text-success' : 'text-muted-foreground',
                    )}
                    strokeWidth={3}
                    aria-hidden
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="mt-5 border-t border-border/50 pt-4">
              <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {column.claimTone === 'success' ? 'What it needs' : 'Where it falls short'}
              </p>
              <ul className="mt-2.5 space-y-2">
                {column.limits.map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-2.5 text-2xs leading-relaxed text-muted-foreground"
                  >
                    <Minus className="mt-1 size-3 shrink-0 text-muted-foreground/50" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

