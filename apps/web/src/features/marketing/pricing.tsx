import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  CircleDollarSign,
  Minus,
  Plus,
  Signal,
  Smartphone,
} from 'lucide-react';
import {
  FEATURE_CATALOGUE,
  GST_RATE,
  PLAN_CATALOGUE,
  PLAN_TIERS,
  PlanTier,
  VEHICLE_TOPUP,
  VEHICLE_TRACKER,
  formatCurrency,
  monthsFreeOnYearly,
  quoteSubscription,
  tierHasFeature,
  type Feature,
  type PlanDefinition,
} from '@saarthi/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { Section, SectionHeading } from './marketing-chrome';
import { Reveal, RevealGroup, RevealItem, Spotlight, useSpotlight } from './motion-extras';
import { GROUPED_FEATURES } from './feature-catalogue';
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
 * Below the plans sit the two add-ons, kept visually apart because neither is a
 * plan: one is a recurring per-vehicle charge and one is a single hardware
 * purchase, and conflating them is how a customer ends up surprised by a bill.
 * Then the honest part — what Saarthi can and cannot know without a tracker —
 * because a fleet that acts on an estimated fuel figure believing it measured
 * is worse off than one that was told.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

const TIER_LABEL: Record<PlanTier, string> = {
  [PlanTier.PERSONAL]: 'Personal',
  [PlanTier.BUSINESS]: 'Business',
};

/** Who each plan is for, in the words that let a reader recognise themselves. */
const TIER_AUDIENCE: Record<PlanTier, string> = {
  [PlanTier.PERSONAL]: 'You own the vehicles',
  [PlanTier.BUSINESS]: 'You run a transport business',
};

type Billing = 'monthly' | 'yearly';

/** The most vehicles the fleet control goes up to before it stops being useful. */
const MAX_VEHICLES = 30;

/**
 * Days of free trial, mirroring `SUBSCRIPTION_TRIAL_DAYS` on the API.
 *
 * Read from the build config rather than written into the copy, because a card
 * that says "free for 30 days" against a server that grants 14 is a card that
 * mis-sells. Falls back to 0, which makes the page quote the price as due
 * immediately — the safe direction to be wrong in.
 */
const TRIAL_DAYS = Number.parseInt(
  (import.meta.env.VITE_SUBSCRIPTION_TRIAL_DAYS as string | undefined) ?? '',
  10,
);
const TRIAL = Number.isFinite(TRIAL_DAYS) && TRIAL_DAYS > 0 ? TRIAL_DAYS : 0;

/**
 * The three or four things a reader checks before they read any further.
 *
 * Chosen per plan rather than from a shared list: what makes Personal worth
 * ninety-nine rupees is that nothing about safety is withheld, and what makes
 * Business worth the step up is the commercial surface. A single template of
 * limits would have said neither.
 */
const TIER_HIGHLIGHTS: Record<PlanTier, readonly string[]> = {
  [PlanTier.PERSONAL]: [
    'Live location, trip history and replay',
    'Documents, service records and EMI reminders',
    'FASTag balance and what each route costs in toll',
    'SOS, hazard alerts and no-entry warnings - never withheld',
    'Drive one yourself and assign the rest to your drivers',
  ],
  [PlanTier.BUSINESS]: [
    'Everything in Personal, for your whole team',
    'Marketplace, requirements and competitive bidding',
    'Trips, dispatch, driver scoring and analytics',
    'AI copilot, predictive maintenance and return loads',
    'Travel packages, association network and API access',
  ],
};

/**
 * The billing period.
 *
 * The one choice that stays above the cards, because it applies to both
 * identically and to every line on them — the plan and each vehicle top-up all
 * move to the yearly rate together. Fleet size and trackers are per-plan
 * decisions and live on the cards themselves.
 */
function BillingControl({
  billing,
  onBilling,
  monthsFree,
}: {
  billing: Billing;
  onBilling: (next: Billing) => void;
  monthsFree: number | null;
}) {
  return (
    <div className="mt-10 flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-card/60 p-1 backdrop-blur"
        >
          {(['monthly', 'yearly'] as Billing[]).map((option) => {
            const selected = billing === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onBilling(option)}
                className={cn(
                  'relative rounded-full px-5 py-1.5 text-sm font-medium transition-colors duration-200',
                  selected
                    ? 'text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {selected ? (
                  <motion.span
                    layoutId="billing-pill"
                    className="absolute inset-0 rounded-full bg-brand-gradient"
                    transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                  />
                ) : null}
                <span className="relative">{option === 'monthly' ? 'Monthly' : 'Yearly'}</span>
              </button>
            );
          })}
        </div>

        {monthsFree && monthsFree > 0 ? (
          <Badge variant="success">
            {monthsFree} month{monthsFree === 1 ? '' : 's'} free on yearly
          </Badge>
        ) : null}
      </div>

      <p className="max-w-lg text-center text-2xs leading-relaxed text-muted-foreground">
        Set your fleet size and trackers on either card - both update together, so the two totals
        are always for the same fleet.
      </p>
    </div>
  );
}

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
  billing,
  vehicles,
  trackers,
  onVehicles,
  onTrackers,
}: {
  plan: PlanDefinition;
  billing: Billing;
  vehicles: number;
  trackers: number;
  onVehicles: (next: number) => void;
  onTrackers: (next: number) => void;
}) {
  const reduced = useReducedMotion();
  const { ref, onPointerMove } = useSpotlight<HTMLDivElement>();
  const featured = plan.tier === PlanTier.BUSINESS;

  const quote = quoteSubscription({ tier: plan.tier, vehicles, trackers, billing });

  const trackerCeiling =
    plan.limits.maxTrackers === null
      ? vehicles
      : Math.min(plan.limits.maxTrackers, vehicles);

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
              key={`${billing}-${vehicles}`}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={reduced ? undefined : { opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="text-4xl font-semibold tracking-[-0.03em] tabular-nums sm:text-5xl"
            >
              {formatCurrency(Math.round(quote.monthly.subtotal))}
              <span className="text-base font-normal text-muted-foreground">/mo</span>
            </motion.p>
          </AnimatePresence>
          {/* The headline stays exclusive of GST — those are the figures
              quoted everywhere else and the ones a business reclaims as input
              credit — but it says so, because an unlabelled price reads as the
              amount that will be charged. The tax is added in full below. */}
          <p className="mt-1.5 text-2xs text-muted-foreground">
            + {Math.round(quote.gstRate * 100)}% GST · for {vehicles} vehicle
            {vehicles === 1 ? '' : 's'} ·{' '}
            {billing === 'yearly'
              ? `${formatCurrency(quote.recurring.subtotal)} billed yearly`
              : 'billed monthly'}
          </p>
        </div>
      </div>

      {/* The configuration, on the card and not in a band underneath it. Both
          cards share this state, so changing the fleet size on one moves the
          other too — which is the only way the two prices stay comparable. */}
      <div className="relative mt-6 divide-y divide-border/50 border-y border-border/50">
        <CountField
          label="Vehicles"
          hint={`1 included, then ${formatCurrency(VEHICLE_TOPUP.priceMonthly)} a month each`}
          value={vehicles}
          min={1}
          max={MAX_VEHICLES}
          onChange={onVehicles}
        />
        <CountField
          label="Trackers"
          hint={
            trackerCeiling === 0
              ? 'One per vehicle, at most'
              : `${formatCurrency(VEHICLE_TRACKER.priceOneTime)} each, charged once - optional`
          }
          value={Math.min(trackers, trackerCeiling)}
          min={0}
          max={trackerCeiling}
          onChange={onTrackers}
        />
      </div>

      {/* Itemised, because a total a customer cannot reconstruct is a total
          they do not trust — and because the hardware must be visibly separate
          from what renews. */}
      <dl className="relative mt-4 space-y-1.5">
        {quote.lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="min-w-0 truncate text-muted-foreground">
              {line.label}
              {line.cadence === 'once' ? (
                <span className="ml-1.5 text-2xs uppercase tracking-wide text-accent-foreground/70">
                  once
                </span>
              ) : null}
            </dt>
            <dd className="shrink-0 tabular-nums">{formatCurrency(line.amount)}</dd>
          </div>
        ))}

        <div className="flex items-baseline justify-between gap-3 border-t border-border/50 pt-2 text-xs">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums">{formatCurrency(quote.dueNow.subtotal)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <dt className="text-muted-foreground">
            GST {Math.round(quote.gstRate * 100)}%
          </dt>
          <dd className="tabular-nums">{formatCurrency(quote.dueNow.gst)}</dd>
        </div>

        {/* The one number a customer is looking for. Given its own weight and
            its own rule, because everything above it is working. */}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
          <dt>Total to pay</dt>
          <dd className="tabular-nums">{formatCurrency(quote.dueNow.total)}</dd>
        </div>

        {/* What renews is not what the first invoice says, whenever hardware is
            on the order. Spelling out both stops the tracker from reading as a
            monthly charge. */}
        <p className="text-2xs leading-relaxed text-muted-foreground">
          {TRIAL > 0
            ? `Free for ${TRIAL} days - nothing is charged today. `
            : ''}
          {trackers > 0
            ? `Then ${formatCurrency(quote.renews.total)} a ${billing === 'yearly' ? 'year' : 'month'} including GST - the trackers are charged once and never again.`
            : `Renews at ${formatCurrency(quote.renews.total)} a ${billing === 'yearly' ? 'year' : 'month'}, including GST.`}
        </p>
      </dl>

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
            /* The whole configuration travels to signup, so the summary there
               and what gets provisioned are the same thing the reader priced. */
            <Link
              to={`/register?plan=${plan.tier.toLowerCase()}&billing=${billing}&vehicles=${vehicles}&trackers=${Math.min(trackers, trackerCeiling)}`}
            >
              Subscribe to {TIER_LABEL[plan.tier]}
            </Link>
          )}
        </Button>
        <p className="text-center text-2xs text-muted-foreground">
          GST included above. Cancel or change plan whenever you like.
        </p>
      </div>
    </div>
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
      eyebrow: 'Included on both plans',
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
      eyebrow: `${formatCurrency(VEHICLE_TRACKER.priceOneTime)} once, per vehicle`,
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
        'Telemetry history is kept for 90 days on Personal and 365 on Business.',
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
      a: 'Anything you put on Saarthi and track - a car, a tempo, a bus, a tipper or a multi-axle truck. They are all one vehicle, and they all cost the same. Trucks are not charged more than cars.',
    },
    {
      q: 'Can I change plan later?',
      a: 'Yes, either way, whenever you like. Moving to Business is immediate. Moving down to Personal is allowed as long as what you already run fits inside it - otherwise you are told exactly which limit is in the way rather than being refused.',
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
      a: 'No. Both plans work with the driver app alone, and everything to do with safety, documents, EMI and toll works without any hardware. The tracker is for operators who need the engine and fuel figures to be measured rather than estimated.',
    },
    {
      q: 'When am I first charged?',
      a:
        TRIAL > 0
          ? `Not on signup. Every plan starts with ${TRIAL} days free, and the first invoice - the plan, your vehicle top-ups, any trackers you ordered, plus GST - is raised when that ends. Cancel before then and you pay nothing.`
          : 'On signup. The first invoice covers the plan, your vehicle top-ups, any trackers you ordered, and GST.',
    },
    {
      q: 'What is the yearly discount?',
      a: 'Paying yearly costs ten months instead of twelve, on the plan and on every vehicle top-up. Nothing else changes.',
    },
    {
      q: 'Is GST included?',
      a: `Yes, in the total. Plan and top-up prices are quoted excluding GST - those are the figures you would reclaim as input credit - and ${Math.round(GST_RATE * 100)}% is added on the card above, so the "total to pay" is the amount that will actually be charged. Add your GSTIN in settings and it appears on every invoice.`,
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

/**
 * The full plan × capability matrix.
 *
 * Collapsed by default — forty-odd rows is the answer to "what exactly do I
 * get", not the first thing a visitor should scroll past. Generated from
 * `tierHasFeature`, the same function the running app calls to decide whether
 * to show a screen, so a tick here means the capability really is reachable on
 * that plan.
 */
function ComparisonMatrix() {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="mt-12">
      <div className="flex justify-center">
        <Button
          variant="outline"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="rounded-full"
        >
          {open ? 'Hide' : 'Compare'} all {FEATURE_CATALOGUE.length} capabilities
          <ChevronDown
            className={cn(
              'size-4 transition-transform duration-300 ease-smooth',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="matrix"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={reduced ? undefined : { opacity: 1, height: 'auto' }}
            exit={reduced ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="overflow-hidden"
          >
            <p className="mt-6 text-center text-2xs text-muted-foreground">
              A dash in both columns means the capability needs a tracker - see above.
            </p>

            {/* Scrolls inside its own box, so the page itself never goes
                sideways on a phone. */}
            <div className="mt-4 overflow-x-auto rounded-2xl border border-border/60">
              <table className="w-full min-w-[32rem] border-collapse text-left">
                <caption className="sr-only">Which Saarthi plan includes which capability</caption>
                <thead>
                  <tr className="border-b border-border">
                    {/* Sticky, so the capability name stays readable while the
                        plan columns scroll under the thumb. */}
                    <th
                      scope="col"
                      className="sticky left-0 z-[1] bg-card px-5 py-3.5 text-xs font-semibold"
                    >
                      Capability
                    </th>
                    {PLAN_TIERS.map((tier) => (
                      <th
                        key={tier}
                        scope="col"
                        className="px-4 py-3.5 text-center text-xs font-semibold"
                      >
                        {TIER_LABEL[tier]}
                      </th>
                    ))}
                  </tr>
                </thead>

                {GROUPED_FEATURES.map((entry) => (
                  <tbody key={entry.group.id}>
                    <tr className="border-b border-border/60 bg-secondary/40">
                      <th
                        scope="colgroup"
                        colSpan={PLAN_TIERS.length + 1}
                        className="px-5 py-2.5 text-left"
                      >
                        <span className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          <entry.group.icon className="size-3.5" aria-hidden />
                          {entry.group.label}
                        </span>
                      </th>
                    </tr>

                    {entry.features.map((definition) => (
                      <tr
                        key={definition.key}
                        className="border-b border-border/40 transition-colors last:border-0 hover:bg-secondary/30"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 z-[1] max-w-[15rem] bg-card px-5 py-3 text-left"
                        >
                          <span className="block text-xs font-medium">{definition.name}</span>
                          <span className="mt-0.5 hidden text-2xs leading-snug text-muted-foreground sm:block">
                            {definition.description}
                          </span>
                        </th>
                        {PLAN_TIERS.map((tier) => {
                          const included = tierHasFeature(tier, definition.key as Feature);
                          return (
                            <td key={tier} className="px-4 py-3 text-center">
                              {included ? (
                                <Check
                                  className="mx-auto size-4 text-success"
                                  strokeWidth={3}
                                  aria-hidden
                                />
                              ) : (
                                <Minus
                                  className="mx-auto size-3.5 text-muted-foreground/30"
                                  aria-hidden
                                />
                              )}
                              <span className="sr-only">
                                {included ? 'Included in' : 'Not in'} {TIER_LABEL[tier]}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
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
  const [billing, setBilling] = React.useState<Billing>('monthly');
  /*
   * One fleet configuration, shared by both cards.
   *
   * Per-card state would let a reader price three vehicles on Personal against
   * ten on Business and think they had compared the plans. Sharing it means the
   * two totals always answer the same question.
   */
  const [vehicles, setVehicles] = React.useState(1);
  const [trackers, setTrackers] = React.useState(0);

  const monthsFree = monthsFreeOnYearly();

  /*
   * Trackers are fitted to vehicles, so shrinking the fleet has to take the
   * surplus hardware off the quote — otherwise the price would keep charging
   * for a tracker with nothing to fit it to.
   */
  const setFleetSize = (next: number): void => {
    setVehicles(next);
    setTrackers((held) => Math.min(held, next));
  };

  return (
    <Section id="pricing" width="wide">
      <SectionHeading
        eyebrow="Pricing"
        title="Two plans. Priced by the vehicle."
        body="Ninety-nine rupees a month if the vehicles are yours, one ninety-nine if you run a transport business - and seventy-five for every vehicle after the first. Everyone on your team is included, and safety is never gated."
      />

      <Reveal delay={0.1}>
        <BillingControl billing={billing} onBilling={setBilling} monthsFree={monthsFree} />
      </Reveal>

      <RevealGroup
        className="mx-auto mt-8 grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2"
        stagger={0.08}
      >
        {PLAN_CATALOGUE.map((plan) => (
          <RevealItem key={plan.tier} className="h-full">
            <PlanCard
              plan={plan}
              billing={billing}
              vehicles={vehicles}
              trackers={trackers}
              onVehicles={setFleetSize}
              onTrackers={setTrackers}
            />
          </RevealItem>
        ))}
      </RevealGroup>

      <Reveal delay={0.05}>
        <BandHeading eyebrow="Read this before you decide" title="What Saarthi can actually know" />
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Saarthi works without any hardware - your driver&rsquo;s phone reports the location. But
          a phone is not the vehicle, and everything worked out from its trail is an estimate. Here
          is exactly what changes when a tracker is fitted, so you know which numbers you can act
          on.
        </p>
      </Reveal>
      <DataSources />

      <Reveal delay={0.05}>
        <BandHeading eyebrow="The small print" title="Nothing hidden in it" />
      </Reveal>
      <Terms />

      <ComparisonMatrix />
    </Section>
  );
}
