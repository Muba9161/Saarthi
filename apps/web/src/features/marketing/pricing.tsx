import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  CircleDollarSign,
  Minus,
  Plus,
} from 'lucide-react';
import {
  DEFAULT_TRIAL_DAYS,
  GST_RATE,
  PLAN_CATALOGUE,
  PLAN_TIER_ORDER,
  PlanTier,
  VEHICLE_TOPUP,
  formatCurrency,
  quoteSubscription,
  type PlanDefinition,
} from '@saarthi/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { Section, SectionHeading } from './marketing-chrome';
import { Reveal, RevealGroup, RevealItem, Spotlight, useSpotlight } from './motion-extras';
import { cn } from '@/lib/utils';

/**
 * Pricing.
 *
 * The organising idea is that Saarthi is priced by the vehicle, so the page is
 * built around the one question an operator actually arrives with: what will
 * *my* fleet cost. The fleet-size control at the top drives both cards, so the
 * number on each card is this reader's real monthly total rather than a
 * headline price they then have to do arithmetic on.
 *
 * That replaced a four-column grid whose most prominent element was a bar
 * showing "31 of 48 capabilities". Nobody buys a fraction of a capability
 * count, and a plan two-thirds along that bar was not two-thirds as useful —
 * which is what the bar implied.
 *
 * Every price on a card is final: plans and extra vehicles are sold with GST
 * already inside them, so no tax line is shown against them.
 *
 * Trackers are not on the cards at all. They are a one-time hardware purchase,
 * not part of a plan, so they have their own section (`TrackersSection`) and
 * the cards stay about what renews each month.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

const TIER_LABEL: Record<PlanTier, string> = {
  [PlanTier.FREE]: 'Free',
  [PlanTier.PERSONAL]: 'Personal',
  [PlanTier.SUPPLIER]: 'Supplier',
  [PlanTier.BUSINESS]: 'Business',
};

/** Who each plan is for, in the words that let a reader recognise themselves. */
const TIER_AUDIENCE: Record<PlanTier, string> = {
  [PlanTier.FREE]: 'You are not running a vehicle',
  [PlanTier.PERSONAL]: 'You own a personal vehicle',
  [PlanTier.SUPPLIER]: 'You supply material',
  [PlanTier.BUSINESS]: 'You run a fleet or a travel business',
};

/** The plans in the order they are offered — cheapest first. */
const OFFERED_PLANS = PLAN_TIER_ORDER.map((tier) =>
  PLAN_CATALOGUE.find((plan) => plan.tier === tier),
).filter((plan): plan is PlanDefinition => Boolean(plan));

/** The most vehicles the fleet control goes up to before it stops being useful. */
const MAX_VEHICLES = 30;

/**
 * Days of free trial, mirroring `SUBSCRIPTION_TRIAL_DAYS` on the API.
 *
 * Read from the build config rather than written into the copy, so the page
 * cannot quote a period the server does not honour. Unset, both sides fall
 * back to the same shared default.
 */
const TRIAL_DAYS = Number.parseInt(
  (import.meta.env.VITE_SUBSCRIPTION_TRIAL_DAYS as string | undefined) ?? '',
  10,
);
const TRIAL = Number.isFinite(TRIAL_DAYS) && TRIAL_DAYS >= 0 ? TRIAL_DAYS : DEFAULT_TRIAL_DAYS;

/**
 * The three or four things a reader checks before they read any further.
 *
 * Written around who each plan is for rather than around what it withholds:
 * every paid plan carries the same capabilities, and what differs is the kind
 * of account and the vehicles it runs.
 */
const TIER_HIGHLIGHTS: Record<PlanTier, readonly string[]> = {
  [PlanTier.FREE]: [
    'Fuel, food, workshops and help, wherever you are',
    'Say what you need and compare the offers that come back',
    'Follow your order or delivery on the map, live',
    'Book a cab, a bus or a tour package',
    'No vehicle, no tracker and no card',
  ],
  [PlanTier.PERSONAL]: [
    'Your car, SUV or other personal vehicle - not trucks',
    'Live location, trips, documents, service and EMI',
    'Drive it yourself or hand it to a driver',
    'A tracker is optional - add one whenever you like',
    'Every Saarthi capability, nothing held back',
  ],
  [PlanTier.SUPPLIER]: [
    'Your material catalogue, stock and availability',
    'Requirements, quotes and supplier orders',
    'No vehicle, fleet or tracker setup needed',
    'Your whole team included',
    'Every Saarthi capability for a supplier',
  ],
  [PlanTier.BUSINESS]: [
    'Fleet owners: trucks, with a Saarthi tracker for telemetry',
    'Tour, travel and mobility: cars, SUVs, buses and more',
    'Trips, dispatch and the Saarthi Driver App for your drivers',
    'Marketplace, bidding, analytics and AI',
    'Your whole team included',
  ],
};

/**
 * A stepper for one line of the configuration.
 *
 * Typeable as well as steppable: an operator with nine trucks should not have
 * to press a button nine times, and one with three should not have to open a
 * keyboard.
 */
function CountField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p>
      </div>

      <div
        className={cn(
          'inline-flex shrink-0 items-center rounded-full border border-border/70 bg-background/60 p-0.5',
          disabled && 'opacity-50',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-full"
          onClick={() => onChange(clamp(value - 1))}
          disabled={disabled || value <= min}
          aria-label={`One fewer - ${label}`}
        >
          <Minus className="size-3.5" aria-hidden />
        </Button>

        <label>
          <span className="sr-only">{label}</span>
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            disabled={disabled}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              // A half-typed or cleared field must not blank the price, so
              // anything unparseable holds the last good number.
              if (Number.isFinite(next)) onChange(clamp(next));
            }}
            className="w-9 border-0 bg-transparent p-0 text-center text-sm font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-full"
          onClick={() => onChange(clamp(value + 1))}
          disabled={disabled || value >= max}
          aria-label={`One more - ${label}`}
        >
          <Plus className="size-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  vehicles,
  onVehicles,
}: {
  plan: PlanDefinition;
  vehicles: number;
  onVehicles: (next: number) => void;
}) {
  const reduced = useReducedMotion();
  const { ref, onPointerMove } = useSpotlight<HTMLDivElement>();
  const featured = plan.tier === PlanTier.BUSINESS;

  // Trackers are hardware, priced in their own section, so the plan quote
  // carries only what renews.
  const quote = quoteSubscription({ tier: plan.tier, vehicles });

  /**
   * A plan that covers no vehicles — Free and Supplier.
   *
   * A vehicle stepper would imply a vehicle is expected, so the card drops it.
   * Only Free is also free of charge.
   */
  const vehicleless = plan.limits.maxTrucks === 0 && plan.limits.maxVehicleTopUps === 0;
  const free = plan.priceMonthly === 0;

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl p-6 backdrop-blur-sm sm:p-7',
        'transition-[transform,border-color,opacity] duration-500 ease-smooth hover:-translate-y-1',
        featured
          ? 'border border-primary/40 bg-card/70 shadow-lifted'
          : 'border border-border/60 bg-card/50 hover:border-primary/25',
        quote.overVehicleCeiling && 'opacity-75',
      )}
    >
      <Spotlight />

      {featured ? (
        <Badge className="absolute right-5 top-5 shadow-sm">Most operators</Badge>
      ) : null}

      <div className="relative">
        <h3 className="text-lg font-semibold tracking-[-0.01em]">{TIER_LABEL[plan.tier]}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{TIER_AUDIENCE[plan.tier]}</p>

        {/* The recurring figure, which is the one a customer compares. Only
            the number is keyed for animation, so changing the count does not
            restage the card. */}
        <div className="mt-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={vehicles}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={reduced ? undefined : { opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="text-4xl font-semibold tracking-[-0.03em] tabular-nums sm:text-5xl"
            >
              {free ? (
                'Free'
              ) : (
                <>
                  {formatCurrency(quote.monthly.total)}
                  <span className="text-base font-normal text-muted-foreground">/month</span>
                </>
              )}
            </motion.p>
          </AnimatePresence>
          {/* The headline is the final monthly price — what is actually paid —
              so it carries no tax breakdown. */}
          <p className="mt-1.5 text-2xs text-muted-foreground">
            {free
              ? 'No card and no vehicle'
              : vehicleless
                ? 'No vehicle or fleet setup · billed monthly'
                : `For ${vehicles} vehicle${vehicles === 1 ? '' : 's'} · billed monthly`}
          </p>
        </div>
      </div>

      {/* The configuration, on the card and not in a band underneath it. The
          priced cards share this state, so changing the fleet size on one moves
          the other too — which is the only way the two prices stay comparable.

          Absent from the free card, because a vehicle stepper on a plan that
          covers no vehicles is not a control, it is a promise the plan cannot
          keep. */}
      {vehicleless ? null : (
      <div className="relative mt-6 divide-y divide-border/50 border-y border-border/50">
        <CountField
          label="Vehicles"
          hint={`1 included, then ${formatCurrency(VEHICLE_TOPUP.priceMonthly)} a month each`}
          value={vehicles}
          min={1}
          max={MAX_VEHICLES}
          onChange={onVehicles}
        />
      </div>
      )}

      {/* Itemised, because a total a customer cannot reconstruct is a total
          they do not trust. A free plan has nothing to itemise: an invoice
          totalling zero invites the reader to look for the catch. */}
      {free ? (
        <p className="relative mt-4 text-2xs leading-relaxed text-muted-foreground">
          Nothing to pay, and nothing to cancel. Move to a paid plan whenever you
          actually start running a vehicle.
        </p>
      ) : vehicleless ? (
        <p className="relative mt-4 text-2xs leading-relaxed text-muted-foreground">
          {TRIAL > 0 ? `Free for ${TRIAL} days, then ` : ''}
          {formatCurrency(quote.monthly.total)} a month.
        </p>
      ) : (
      <dl className="relative mt-4 space-y-1.5">
        {quote.lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="min-w-0 truncate text-muted-foreground">{line.label}</dt>
            <dd className="shrink-0 tabular-nums">{formatCurrency(line.amount)}</dd>
          </div>
        ))}

        {/* The one number a customer is looking for. Given its own weight and
            its own rule, because everything above it is working. */}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
          <dt>Total to pay</dt>
          <dd className="tabular-nums">{formatCurrency(quote.dueNow.total)}</dd>
        </div>

        <p className="text-2xs leading-relaxed text-muted-foreground">
          {TRIAL > 0 ? `Free for ${TRIAL} days - nothing is charged today. ` : ''}
          Then {formatCurrency(quote.monthly.total)} a month.
        </p>
      </dl>
      )}

      {quote.overVehicleCeiling ? (
        <p className="relative mt-4 rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-2xs leading-relaxed">
          Personal covers up to {quote.vehicleCeiling} vehicles. For {vehicles}, Business is the
          plan that fits.
        </p>
      ) : null}

      <ul className="relative mt-6 flex-1 space-y-2.5">
        {TIER_HIGHLIGHTS[plan.tier].map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-sm leading-snug">
            <Check
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                featured ? 'text-primary' : 'text-success',
              )}
              strokeWidth={3}
              aria-hidden
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="relative mt-6 space-y-3">
        <Button
          className="w-full rounded-full"
          variant={featured ? 'gradient' : 'outline'}
          disabled={quote.overVehicleCeiling}
          asChild={!quote.overVehicleCeiling}
        >
          {quote.overVehicleCeiling ? (
            <span>Too many vehicles for this plan</span>
          ) : (
            /* Only the plan travels to signup. The fleet size here is a
               price calculator: vehicles are added in the app, and an extra
               vehicle slot is bought when the second one is. */
            <Link to={`/register?plan=${plan.tier.toLowerCase()}`}>
              {free ? 'Start for free' : `Subscribe to ${TIER_LABEL[plan.tier]}`}
            </Link>
          )}
        </Button>
        <p className="text-center text-2xs text-muted-foreground">
          {free ? 'No payment details asked for.' : 'Cancel or change plan whenever you like.'}
        </p>
      </div>
    </div>
  );
}

/**
 * The terms, in the open.
 *
 * Everything here is a question somebody would otherwise have to ask support,
 * and every answer is one the product actually implements — the capacity rule,
 * the top-up windows and the tracker having no expiry are all enforced in the
 * subscription module, not just promised here.
 */
function Terms() {
  const terms: readonly { q: string; a: string }[] = [
    {
      q: 'What counts as a vehicle?',
      a: 'Anything you put on Saarthi and track, and every one costs the same. Which vehicles you can add follows your account: Personal is for your own car or personal vehicle, a fleet owner runs trucks, and a tour or travel business runs cars, SUVs, buses and the like.',
    },
    {
      q: 'Can I change plan later?',
      a: 'Yes, whenever you like. Moving to Business is immediate. Moving down to Personal is allowed as long as what you already run fits inside it - otherwise you are told exactly which limit is in the way. The Supplier plan is for material suppliers only.',
    },
    {
      q: 'What happens if I stop paying for a vehicle?',
      a: 'Nothing is deleted, and no vehicle stops working. Capacity is checked when you add a vehicle, never afterwards - so a lapsed top-up means you cannot add the next one, not that you lose the last one.',
    },
    {
      q: 'Is the tracker really a one-time charge?',
      a: 'Yes. There is no monthly fee, no data charge and no expiry on it. If you sell the vehicle, take the tracker off and fit it to the next one at no cost.',
    },
    {
      q: 'Do I have to buy a tracker?',
      a: 'Not on Personal or for a travel business - the driver app works on its own, and safety, documents, EMI and toll need no hardware. A fleet owner running trucks needs a tracker for live telemetry, and Saarthi offers one the first time telemetry is opened.',
    },
    {
      q: 'When am I first charged?',
      a:
        TRIAL > 0
          ? `The plan is not charged on signup - every paid plan starts with ${TRIAL} days free, and is billed monthly after that. Extra vehicles and any trackers you order are charged when you sign up.`
          : 'On signup. The first charge covers the plan, your extra vehicles and any trackers you ordered.',
    },
    {
      q: 'Is GST included?',
      a: `Yes. Plan and vehicle prices are final - GST is already inside them. Tracker hardware is priced before tax, and ${Math.round(GST_RATE * 100)}% GST is added to it at checkout. Add your GSTIN in settings and it appears on every invoice.`,
    },
    {
      q: 'Can I add myself as a driver?',
      a: 'On Personal, yes - there is a switch for it when you sign up, and one more in your settings afterwards. Give your licence number and you can be assigned to your own vehicles alongside the drivers you employ.',
    },
  ];

  return (
    <div className="mt-4 rounded-2xl border border-border/60 bg-card/30 p-6 backdrop-blur-sm sm:p-7">
      <h3 className="flex items-center gap-2.5 text-sm font-semibold">
        <CircleDollarSign className="size-4 text-muted-foreground" aria-hidden />
        Terms, before you ask
      </h3>
      <dl className="mt-5 grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2">
        {terms.map((term) => (
          <div key={term.q}>
            <dt className="text-sm font-medium">{term.q}</dt>
            <dd className="mt-1 text-2xs leading-relaxed text-muted-foreground">{term.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A plan's monthly price, GST included. */
function priceOf(tier: PlanTier): number {
  return PLAN_CATALOGUE.find((plan) => plan.tier === tier)?.priceMonthly ?? 0;
}

/** A heading for the bands below the plan grid. */
function BandHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mt-14">
      <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {eyebrow}
      </p>
      <h3 className="mt-1.5 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{title}</h3>
    </div>
  );
}

export function Pricing() {
  /*
   * One fleet configuration, shared by every card.
   *
   * Per-card state would let a reader price three vehicles on Personal against
   * ten on Business and think they had compared the plans. Sharing it means the
   * totals always answer the same question.
   */
  const [vehicles, setVehicles] = React.useState(1);

  return (
    <Section id="pricing" width="wide">
      <SectionHeading
        eyebrow="Pricing"
        title="Four plans. Priced by the vehicle."
        body={`Free if you are not running a vehicle. ${formatCurrency(priceOf(PlanTier.PERSONAL))} a month for your own vehicle, ${formatCurrency(priceOf(PlanTier.BUSINESS))} for a fleet or travel business, ${formatCurrency(priceOf(PlanTier.SUPPLIER))} for a material supplier - and ${formatCurrency(VEHICLE_TOPUP.priceMonthly)} for every vehicle after the first. Every plan carries every capability.`}
      />

      <Reveal delay={0.1}>
        <p className="mx-auto mt-10 max-w-lg text-center text-2xs leading-relaxed text-muted-foreground">
          Set your fleet size on any card - they all update together, so every total is for the
          same fleet. Trackers are optional hardware, priced in their own section below.
        </p>
      </Reveal>

      {/* Four abreast on a wide screen, two on a tablet, one on a phone. */}
      <RevealGroup
        className="mx-auto mt-8 grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        stagger={0.08}
      >
        {OFFERED_PLANS.map((plan) => (
          <RevealItem key={plan.tier} className="h-full">
            <PlanCard plan={plan} vehicles={vehicles} onVehicles={setVehicles} />
          </RevealItem>
        ))}
      </RevealGroup>

      <Reveal delay={0.05}>
        <BandHeading eyebrow="The small print" title="Nothing hidden in it" />
      </Reveal>
      <Terms />
    </Section>
  );
}
