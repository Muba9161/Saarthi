import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  FileCheck2,
  LifeBuoy,
  Package,
  PhoneCall,
  Radio,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useInView } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { motion, useReducedMotion } from '@/components/motion';
import { Section, SectionHeading } from './marketing-chrome';
import { Reveal, RevealGroup, RevealItem, Spotlight, useSpotlight } from './motion-extras';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as const;

/* -------------------------------------------------------------------------
 * Why one system
 * ---------------------------------------------------------------------- */

/**
 * The differentiators, before the exhaustive list.
 *
 * The explorer answers "what do I get". This answers "why is this different
 * from the tracker I already pay for", which is the question that decides
 * whether anyone reads the explorer at all.
 *
 * Laid out as a bento rather than six identical cards: two of these six are
 * the actual reason to switch, and a uniform grid gives every claim the same
 * weight, which is another way of giving none of them any.
 */
const PILLARS = [
  {
    icon: Radio,
    title: 'Live tracking that moves',
    body: 'Realtime positions, ETAs and route-deviation alerts pushed over a socket. The same pipeline serves the simulator today and GPS hardware tomorrow.',
    span: 'lg:col-span-2',
  },
  {
    icon: Package,
    title: 'A marketplace, not a mailbox',
    body: 'Customers post loads, verified fleets quote them, and accepting a quote creates the trip. No phone tag, no re-keying.',
    span: 'lg:col-span-2',
  },
  {
    icon: FileCheck2,
    title: 'Documents that chase themselves',
    body: 'Versioned uploads, a verification workflow, and an expiry engine that warns you 30, 15 and 7 days before a permit lapses.',
    span: '',
  },
  {
    icon: LifeBuoy,
    title: 'Safety that is never billed',
    body: 'One tap reaches nearby trucks in expanding rings — on every plan, in trial, and after a payment fails.',
    span: '',
  },
  {
    icon: ShieldCheck,
    title: 'Scores a driver can argue with',
    body: 'Every point gained or lost carries a written reason and the record it came from.',
    span: '',
  },
  {
    icon: Bot,
    title: 'AI grounded in your data',
    body: 'Answers are assembled only from records your role can already open, and they cite them.',
    span: '',
  },
] as const;

function PillarCard({ pillar }: { pillar: (typeof PILLARS)[number] }) {
  const { ref, onPointerMove } = useSpotlight<HTMLDivElement>();

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      className={cn(
        'group relative h-full overflow-hidden rounded-2xl border border-border/60 bg-card/50 p-6 backdrop-blur-sm sm:p-7',
        'transition-[transform,border-color] duration-500 ease-smooth hover:-translate-y-1 hover:border-primary/30',
      )}
    >
      <Spotlight />

      <span className="relative inline-flex rounded-xl bg-primary/[0.08] p-3 text-primary ring-1 ring-inset ring-primary/10">
        <pillar.icon className="size-5" aria-hidden />
      </span>
      <h3 className="relative mt-5 text-lg font-semibold tracking-[-0.01em]">{pillar.title}</h3>
      <p className="relative mt-2.5 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
    </div>
  );
}

export function Pillars() {
  return (
    <Section id="platform">
      <SectionHeading
        eyebrow="Why one system"
        title="Everything a haul touches, writing to one record"
        body="Not a tracker with features bolted on. Each part of Saarthi reads and writes the same operational history — the only reason the numbers on one screen agree with the numbers on another."
      />

      <RevealGroup
        className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        stagger={0.08}
      >
        {PILLARS.map((pillar) => (
          <RevealItem key={pillar.title} className={cn('h-full', pillar.span)}>
            <PillarCard pillar={pillar} />
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* -------------------------------------------------------------------------
 * How it works
 * ---------------------------------------------------------------------- */

const STEPS = [
  {
    step: '01',
    title: 'Post what needs moving',
    body: 'A customer names the material, quantity, pickup and delivery. Saarthi ranks the transport that can actually do it — by capacity, by location, and by whether the paperwork is current.',
  },
  {
    step: '02',
    title: 'Verified fleets compete',
    body: 'Operators quote with a specific truck and a specific driver. Compare price, ETA, capacity and driver score side by side, rather than trusting whoever answered the phone first.',
  },
  {
    step: '03',
    title: 'Accept, and the trip exists',
    body: 'One click creates the trip, assigns the vehicle, reserves the stock in the supplier’s yard and notifies the driver. Nothing is retyped into a second system.',
  },
  {
    step: '04',
    title: 'Watch it arrive',
    body: 'Live position, live ETA, deviation and delay alerts, proof of delivery — and a driver score that moves on what actually happened, with the record that caused it attached.',
  },
] as const;

function StepBlock({
  step,
  index,
  onEnter,
}: {
  step: (typeof STEPS)[number];
  index: number;
  onEnter: (index: number) => void;
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLLIElement>(null);
  // Half the block must be showing before it claims the rail, so the highlight
  // changes once per step rather than flickering between two.
  const inView = useInView(ref, { amount: 0.5 });

  React.useEffect(() => {
    if (inView) onEnter(index);
  }, [inView, index, onEnter]);

  return (
    <li ref={ref}>
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 32 }}
        whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="relative"
      >
        {/* The numeral is the illustration — outlined, oversized, and behind
            the text. Cheaper than a fake screenshot and it never dates. */}
        <span
          className="pointer-events-none absolute -left-2 -top-10 select-none text-[7rem] font-semibold leading-none tracking-tighter text-transparent sm:-top-14 sm:text-[10rem]"
          style={{ WebkitTextStroke: '1px hsl(var(--border-strong) / 0.5)' }}
          aria-hidden
        >
          {step.step}
        </span>

        <div className="relative">
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-primary">
            Step {step.step}
          </p>
          <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
            {step.title}
          </h3>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {step.body}
          </p>
        </div>
      </motion.div>
    </li>
  );
}

/**
 * The lifecycle, told by scrolling.
 *
 * The rail on the left stays put and marks where you are while the steps move
 * past it. This replaced a row of four cards that auto-advanced on a timer —
 * a panel that keeps moving while you are reading it is worse than a static
 * list, and tying the sequence to the scroll position puts the reader in
 * charge of the pace instead.
 */
export function HowItWorks() {
  const [active, setActive] = React.useState(0);
  const onEnter = React.useCallback((index: number) => setActive(index), []);

  return (
    <Section id="how" width="wide">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:h-fit">
          <SectionHeading
            align="start"
            eyebrow="How it works"
            title="From “I need 20 tons of sand” to delivered"
            body="Four moves, one record — which is why a delay on the road reaches the customer's view, the driver's score and the month's analytics without anybody entering it twice."
          />

          {/* Progress rail. Decorative on mobile, so it is simply not there. */}
          <ol className="mt-10 hidden space-y-1 lg:block" aria-hidden>
            {STEPS.map((step, index) => {
              const reached = index <= active;
              return (
                <li key={step.step} className="flex items-center gap-3">
                  <span className="relative flex h-8 w-4 items-center justify-center">
                    {index < STEPS.length - 1 ? (
                      <span
                        className={cn(
                          'absolute left-1/2 top-4 h-8 w-px -translate-x-1/2 transition-colors duration-500',
                          index < active ? 'bg-primary/50' : 'bg-border',
                        )}
                      />
                    ) : null}
                    <span
                      className={cn(
                        'relative size-2 rounded-full transition-all duration-500',
                        reached ? 'scale-125 bg-primary' : 'bg-border-strong',
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      'text-sm transition-colors duration-500',
                      index === active
                        ? 'font-medium text-foreground'
                        : reached
                          ? 'text-foreground/60'
                          : 'text-muted-foreground',
                    )}
                  >
                    {step.title}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <ol className="space-y-20 sm:space-y-28">
          {STEPS.map((step, index) => (
            <StepBlock key={step.step} step={step} index={index} onEnter={onEnter} />
          ))}
        </ol>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------
 * Safety
 * ---------------------------------------------------------------------- */

/** Expanding rings — the SOS broadcast, drawn. */
function SosRings() {
  const reduced = useReducedMotion();

  return (
    <div className="relative mx-auto aspect-square w-full max-w-sm" aria-hidden>
      {[0, 1, 2, 3].map((ring) => (
        <motion.span
          key={ring}
          className="absolute inset-0 rounded-full border border-accent/35"
          initial={reduced ? { opacity: 0.2, scale: 0.4 + ring * 0.2 } : { opacity: 0, scale: 0.3 }}
          animate={reduced ? undefined : { opacity: [0, 0.5, 0], scale: [0.3, 1, 1.08] }}
          transition={{ duration: 4, delay: ring * 1, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      <span className="absolute inset-0 m-auto flex size-20 items-center justify-center rounded-full bg-accent/15 ring-1 ring-inset ring-accent/30 backdrop-blur-sm">
        <LifeBuoy className="size-8 text-accent" />
      </span>
    </div>
  );
}

/**
 * Safety, given its own band.
 *
 * It is the one part of the platform that is never gated, and the one claim
 * that has to be worded carefully: Saarthi reaches nearby drivers, it is not
 * an emergency service. The 112 note appears here and in the footer, on
 * purpose.
 */
export function SafetyBand() {
  return (
    <Section tone="dark" width="wide">
      <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div>
          <SectionHeading
            align="start"
            onDark
            eyebrow="Never gated by a plan"
            title="A safety network, not a button"
            body="One tap reaches nearby Saarthi trucks in expanding rings until somebody answers, and the district association desk sees the same alert. It works on every plan, during a trial, and after a payment has lapsed — because a driver on a dark highway is not a billing event."
          />

          <RevealGroup as="ul" className="mt-12 grid gap-8 sm:grid-cols-3" stagger={0.1}>
            {[
              {
                icon: Radio,
                title: 'Expanding rings',
                body: 'Widens the search radius until a responder accepts.',
              },
              {
                icon: Users,
                title: 'Association desk',
                body: 'District bodies coordinate roadside help on the same alert.',
              },
              {
                icon: PhoneCall,
                title: 'Always reachable',
                body: 'Never blocked by plan or payment state.',
              },
            ].map((item) => (
              <RevealItem as="li" key={item.title}>
                <item.icon className="size-5 text-accent" aria-hidden />
                <p className="mt-3 text-sm font-semibold text-sidebar-foreground">{item.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-sidebar-muted">{item.body}</p>
              </RevealItem>
            ))}
          </RevealGroup>

          <Reveal delay={0.2}>
            <p className="mt-12 max-w-2xl border-l-2 border-accent/40 pl-4 text-xs leading-relaxed text-sidebar-muted">
              Saarthi&rsquo;s network connects nearby drivers who may be able to help. It does not
              replace official emergency services — always call 112 first in a life-threatening
              situation.
            </p>
          </Reveal>
        </div>

        <Reveal direction="left" amount={0.2}>
          <SosRings />
        </Reveal>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------
 * Closing
 * ---------------------------------------------------------------------- */

export function FinalCta() {
  return (
    <Section width="narrow" className="pb-28 pt-8 sm:pb-36">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/50 px-6 py-14 text-center backdrop-blur-sm sm:px-14 sm:py-20">
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
            <div className="absolute -left-24 -top-24 size-80 rounded-full bg-primary/20 blur-[110px]" />
            <div className="absolute -bottom-24 -right-20 size-80 rounded-full bg-accent/20 blur-[110px]" />
          </div>

          <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
            Put your whole operation
            <br className="hidden sm:block" /> on one screen
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-pretty text-sm text-muted-foreground sm:text-base">
            Set up in minutes, in your own language. Add a truck, add a driver, post a load — and
            watch the first trip move across the map.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              size="xl"
              variant="gradient"
              asChild
              className="group w-full rounded-full sm:w-auto"
            >
              <Link to="/register">
                Create your account
                <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button size="xl" variant="outline" asChild className="w-full rounded-full sm:w-auto">
              <Link to="/login">Explore the demo fleet</Link>
            </Button>
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            The demo is a fully seeded fleet — eight trucks, live tracking and a working SOS
            network.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
