import * as React from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Minus } from 'lucide-react';
import {
  FEATURE_CATALOGUE,
  PLAN_CATALOGUE,
  PLAN_TIERS,
  PlanTier,
  VEHICLE_TOPUP,
  formatCurrency,
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

const EASE = [0.16, 1, 0.3, 1] as const;

const TIER_LABEL: Record<PlanTier, string> = {
  [PlanTier.BASIC]: 'Basic',
  [PlanTier.PRO]: 'Pro',
  [PlanTier.INTELLIGENCE]: 'Intelligence',
  [PlanTier.ENTERPRISE]: 'Enterprise',
};

type Billing = 'monthly' | 'yearly';

/**
 * How many months the yearly price is worth, from the real figures.
 *
 * Calculated rather than written as "2 months free" so the copy cannot
 * contradict the catalogue after a price change, and only advertised when
 * every priced plan agrees on the same number.
 */
function monthsFreeOnYearly(): number | null {
  const priced = PLAN_CATALOGUE.filter(
    (plan) => plan.priceMonthly !== null && plan.priceYearly !== null && plan.priceMonthly > 0,
  );
  if (priced.length === 0) return null;

  const ratios = priced.map(
    (plan) => 12 - (plan.priceYearly as number) / (plan.priceMonthly as number),
  );
  const first = ratios[0] as number;
  return ratios.every((ratio) => Math.abs(ratio - first) < 0.01) ? Math.round(first) : null;
}

function vehicleLabel(maxTrucks: number | null): string {
  return maxTrucks === null
    ? 'Unlimited vehicles'
    : `${maxTrucks} vehicle${maxTrucks === 1 ? '' : 's'}`;
}

/**
 * Three limits on the card, not seven.
 *
 * The other four are in the matrix below. A pricing card is for deciding
 * whether to keep reading; a spec sheet in every column is what made the old
 * grid unreadable.
 */
function headlineLimits(plan: PlanDefinition): { label: string; value: string }[] {
  const { limits } = plan;
  return [
    {
      label: 'Drivers',
      value: limits.maxDrivers === null ? 'Unlimited' : String(limits.maxDrivers),
    },
    { label: 'History', value: `${limits.trackingHistoryDays} days` },
    {
      label: 'Devices',
      value:
        limits.maxDevices === null
          ? 'Unlimited'
          : limits.maxDevices === 0
            ? '—'
            : String(limits.maxDevices),
    },
  ];
}

function PlanCard({ plan, billing }: { plan: PlanDefinition; billing: Billing }) {
  const reduced = useReducedMotion();
  const { ref, onPointerMove } = useSpotlight<HTMLDivElement>();
  const featured = plan.tier === PlanTier.PRO;
  const custom = plan.priceMonthly === null;

  const monthlyEquivalent =
    billing === 'yearly' && plan.priceYearly !== null ? plan.priceYearly / 12 : plan.priceMonthly;

  const coverage = (plan.features.length / FEATURE_CATALOGUE.length) * 100;

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl p-6 backdrop-blur-sm',
        'transition-[transform,border-color] duration-500 ease-smooth hover:-translate-y-1',
        featured
          ? 'border border-primary/40 bg-card/70 shadow-lifted'
          : 'border border-border/60 bg-card/50 hover:border-primary/25',
      )}
    >
      <Spotlight />

      {featured ? <Badge className="absolute right-5 top-5 shadow-sm">Most popular</Badge> : null}

      <div className="relative">
        <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {TIER_LABEL[plan.tier]}
        </p>
        <h3 className="mt-2 text-base font-semibold">{vehicleLabel(plan.limits.maxTrucks)}</h3>

        <div className="mt-6 min-h-[4.5rem]">
          {custom ? (
            <>
              <p className="text-4xl font-semibold tracking-[-0.03em]">Custom</p>
              <p className="mt-1.5 text-2xs text-muted-foreground">negotiated per fleet</p>
            </>
          ) : (
            <>
              {/* Only the number changes with the toggle, so only the number
                  is keyed for animation. */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={billing}
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={reduced ? undefined : { opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, y: -10 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="text-4xl font-semibold tracking-[-0.03em]"
                >
                  {formatCurrency(Math.round(monthlyEquivalent ?? 0))}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </motion.p>
              </AnimatePresence>
              <p className="mt-1.5 text-2xs text-muted-foreground">
                {billing === 'yearly'
                  ? `${formatCurrency(plan.priceYearly)} billed yearly`
                  : 'billed monthly'}
              </p>
            </>
          )}
        </div>

        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
      </div>

      {/* Coverage as a bar rather than a bullet list: it is one number, and a
          bar compares four plans at a glance in a way four lists cannot. */}
      <div className="relative mt-6">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">Capabilities</span>
          <span className="font-semibold tabular-nums">
            {plan.features.length}
            <span className="font-normal text-muted-foreground">/{FEATURE_CATALOGUE.length}</span>
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/70">
          <motion.div
            className="h-full rounded-full bg-brand-gradient"
            initial={reduced ? false : { width: 0 }}
            whileInView={reduced ? undefined : { width: `${coverage}%` }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.9, ease: EASE }}
            style={reduced ? { width: `${coverage}%` } : undefined}
          />
        </div>
      </div>

      <dl className="relative mt-6 flex-1 space-y-2">
        {headlineLimits(plan).map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="shrink-0 font-medium tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>

      <Button
        className="relative mt-7 w-full rounded-full"
        variant={featured ? 'gradient' : 'outline'}
        asChild
      >
        <Link to="/register">{custom ? 'Talk to us' : 'Start free trial'}</Link>
      </Button>
    </div>
  );
}

/**
 * The full plan × capability matrix.
 *
 * Collapsed by default — forty-eight rows is the answer to "what exactly do I
 * get", not the first thing a visitor should scroll past. Generated from
 * `tierHasFeature`, the same function the running app calls to decide whether
 * to show a screen, so a tick here means the capability really is reachable on
 * that plan.
 */
function ComparisonMatrix() {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="mt-14">
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
            {/* Scrolls inside its own box, so the page itself never goes
                sideways on a phone. */}
            <div className="mt-8 overflow-x-auto rounded-2xl border border-border/60">
              <table className="w-full min-w-[40rem] border-collapse text-left">
                <caption className="sr-only">Which Saarthi plan includes which capability</caption>
                <thead>
                  <tr className="border-b border-border">
                    {/* Sticky, so the capability name stays readable while the
                        tier columns scroll under the thumb. */}
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
                        className="px-3 py-3.5 text-center text-xs font-semibold"
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
                            <td key={tier} className="px-3 py-3 text-center">
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

export function Pricing() {
  const [billing, setBilling] = React.useState<Billing>('monthly');
  const monthsFree = monthsFreeOnYearly();

  return (
    <Section id="pricing" width="wide">
      <SectionHeading
        eyebrow="Pricing"
        title="Priced by fleet size, not by seat"
        body="One vehicle or fifty — you pay for the vehicles you run, and everyone on your team uses Saarthi. Every plan starts with a 30-day trial, and safety is never gated."
      />

      <Reveal delay={0.1}>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
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
                  onClick={() => setBilling(option)}
                  className={cn(
                    'relative rounded-full px-5 py-2 text-sm font-medium transition-colors duration-200',
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
      </Reveal>

      <RevealGroup
        className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        stagger={0.08}
      >
        {PLAN_CATALOGUE.map((plan) => (
          <RevealItem key={plan.tier} className="h-full">
            <PlanCard plan={plan} billing={billing} />
          </RevealItem>
        ))}
      </RevealGroup>

      {/*
        The top-up sits below the grid rather than as a fifth column: it is not
        a plan anyone starts on, it is the answer to "I just bought one more
        truck" — which should not cost a jump to the next plan.
      */}
      <Reveal delay={0.1}>
        <div className="mt-5 flex flex-col items-center gap-4 rounded-2xl border border-border/60 bg-card/40 p-6 text-center backdrop-blur-sm sm:flex-row sm:text-left">
          <div className="flex-1">
            <h3 className="text-sm font-semibold">{VEHICLE_TOPUP.name} top-up</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Outgrown your plan by one vehicle? Add exactly one, for{' '}
              {formatCurrency(VEHICLE_TOPUP.priceMonthly)} a month. Stack as many as your plan
              allows, and cancel any of them individually.
            </p>
          </div>
          <Button variant="outline" asChild className="w-full rounded-full sm:w-auto">
            <Link to="/register">Start free trial</Link>
          </Button>
        </div>
      </Reveal>

      <ComparisonMatrix />
    </Section>
  );
}
