import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PlayCircle, ShieldCheck } from 'lucide-react';
import { useScroll, useTransform } from 'framer-motion';
import { FEATURE_CATALOGUE, LANGUAGE_CATALOGUE } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { AnimatedNumber, motion, useReducedMotion } from '@/components/motion';
import { Marquee, Reveal, RevealGroup, RevealItem } from './motion-extras';
import { ROLE_SHOWCASE, TOTAL_DESTINATIONS } from './feature-catalogue';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as const;

/** The path the marker follows. Declared once so SVG and CSS agree. */
const ROUTE = 'M40 250 C 180 250, 210 96, 380 120 S 620 210, 760 60';

/**
 * The hero's product panel.
 *
 * A stylised command centre, not a screenshot: a screenshot dates the moment
 * the UI moves, needs re-cutting for light and dark, and never matches the
 * viewport it lands in. This is built from the same design tokens as the real
 * thing, so it follows the visitor's theme and stays honest for free.
 *
 * It lifts and settles as it scrolls in. The transform is scroll-linked rather
 * than a one-shot entrance so the panel feels attached to the page rather than
 * dropped onto it.
 */
function CommandPanel({ progress }: { progress: ReturnType<typeof useScroll>['scrollYProgress'] }) {
  const reduced = useReducedMotion();

  // Only ever eases *out* of a slight lift — nothing is hidden at rest, so a
  // visitor who never scrolls still sees the finished panel.
  const y = useTransform(progress, [0, 0.35], [40, 0]);
  const scale = useTransform(progress, [0, 0.35], [0.97, 1]);

  const chips = [
    { label: 'On trip', value: '3 moving', className: 'left-4 top-4 sm:left-6 sm:top-6' },
    {
      label: 'Utilisation',
      value: '62%',
      className: 'right-4 top-4 sm:right-6 sm:top-6',
    },
    {
      label: 'Needs attention',
      value: '4 documents',
      className: 'bottom-4 right-4 sm:bottom-6 sm:right-6',
    },
  ];

  return (
    <motion.div
      className="relative mx-auto mt-16 max-w-5xl sm:mt-20"
      style={reduced ? undefined : { y, scale }}
    >
      {/* The panel's own light, so it reads as lit rather than pasted on. */}
      <div
        className="pointer-events-none absolute -inset-x-8 -bottom-8 -top-4 -z-10 rounded-[2.5rem] bg-gradient-to-b from-primary/10 to-transparent blur-2xl"
        aria-hidden
      />

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-overlay backdrop-blur-xl sm:rounded-3xl">
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3 sm:px-5">
          <span className="size-2.5 rounded-full bg-destructive/50" aria-hidden />
          <span className="size-2.5 rounded-full bg-warning/50" aria-hidden />
          <span className="size-2.5 rounded-full bg-success/50" aria-hidden />
          <span className="ml-3 truncate text-xs text-muted-foreground">Fleet command centre</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-2xs font-medium text-success">
            <span className="live-dot" />
            Live
          </span>
        </div>

        <div className="relative h-64 overflow-hidden bg-gradient-to-br from-secondary/50 via-card/40 to-muted/40 sm:h-[22rem]">
          <div className="absolute inset-0 bg-grid-subtle bg-grid opacity-40" aria-hidden />

          <svg
            className="absolute inset-0 size-full"
            viewBox="0 0 800 320"
            preserveAspectRatio="xMidYMid slice"
            fill="none"
            aria-hidden
          >
            <path
              d={ROUTE}
              stroke="hsl(var(--border-strong))"
              strokeWidth="2"
              strokeDasharray="4 8"
              strokeLinecap="round"
            />
            {reduced ? (
              <path d={ROUTE} stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" />
            ) : (
              <>
                <motion.path
                  d={ROUTE}
                  stroke="hsl(var(--primary))"
                  strokeWidth="3"
                  strokeLinecap="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: [0, 1] }}
                  transition={{ duration: 7, delay: 0.6, repeat: Infinity, ease: 'linear' }}
                />
                <motion.circle
                  r="8"
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--card))"
                  strokeWidth="3"
                  initial={{ offsetDistance: '0%' }}
                  animate={{ offsetDistance: '100%' }}
                  transition={{ duration: 7, delay: 0.6, repeat: Infinity, ease: 'linear' }}
                  style={{ offsetPath: `path("${ROUTE}")` }}
                />
              </>
            )}
          </svg>

          {/* Floating readouts rather than a row of boxed tiles — fewer
              containers, and it looks like a map with an overlay, which is
              what the real screen is. */}
          {chips.map((chip, index) => (
            <motion.div
              key={chip.label}
              className={cn(
                'absolute rounded-xl border border-white/25 bg-white/70 px-3 py-2 shadow-lifted backdrop-blur-md',
                'dark:border-white/10 dark:bg-white/[0.08]',
                chip.className,
              )}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={reduced ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.7 + index * 0.12, ease: EASE }}
            >
              <p className="text-2xs uppercase tracking-wider text-muted-foreground">
                {chip.label}
              </p>
              <p className="tabular mt-0.5 text-sm font-semibold">{chip.value}</p>
            </motion.div>
          ))}

          <span className="absolute bottom-4 left-4 rounded-lg border border-white/25 bg-white/70 px-2.5 py-1.5 text-2xs font-medium shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/[0.08] sm:bottom-6 sm:left-6">
            DL-01-AB-1234 · 58 km/h · ETA 2h 40m
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function Hero() {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });

  // The ambient washes drift the other way from the content as you scroll —
  // the cheapest possible depth cue, and the only parallax on the page.
  const washY = useTransform(scrollYProgress, [0, 1], [0, 140]);

  return (
    <section ref={ref} className="relative overflow-hidden px-5 pb-20 pt-16 sm:px-8 sm:pt-24">
      <motion.div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden
        style={reduced ? undefined : { y: washY }}
      >
        <div className="absolute -left-40 -top-48 size-[42rem] rounded-full bg-primary/25 blur-[140px]" />
        <div className="absolute -right-32 top-16 size-[34rem] rounded-full bg-accent/20 blur-[140px]" />
      </motion.div>

      <div className="mx-auto max-w-4xl text-center">
        <Reveal direction="none" duration={0.5}>
          <Link
            to="/register"
            className="group inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3.5 py-1.5 text-xs backdrop-blur transition-colors duration-200 hover:border-primary/40 hover:bg-card"
          >
            <span className="live-dot" aria-hidden />
            <span className="font-medium">
              {FEATURE_CATALOGUE.length} capabilities · {ROLE_SHOWCASE.length} kinds of account
            </span>
            <ArrowRight className="size-3 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </Reveal>

        <h1 className="mt-8 text-balance text-[2.5rem] font-semibold leading-[1.03] tracking-[-0.035em] sm:text-6xl lg:text-7xl">
          {/* Two lines, animated separately, so the emphasis lands second. */}
          <Reveal duration={0.7}>
            <span className="block">The operating system</span>
          </Reveal>
          <Reveal duration={0.7} delay={0.1}>
            <span className="gradient-text block pb-1">for your trucking business</span>
          </Reveal>
        </h1>

        <Reveal delay={0.2}>
          <p className="mx-auto mt-7 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Fleet owners, drivers, suppliers and customers on one record — from posting a load to
            watching it arrive. No phone calls, no WhatsApp groups, no paper register.
          </p>
        </Reveal>

        <Reveal delay={0.3}>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              size="xl"
              variant="gradient"
              asChild
              className="group w-full rounded-full sm:w-auto"
            >
              <Link to="/register">
                Start free — no card needed
                <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button size="xl" variant="outline" asChild className="w-full rounded-full sm:w-auto">
              <Link to="/login">
                <PlayCircle className="size-4" />
                Explore the demo fleet
              </Link>
            </Button>
          </div>
        </Reveal>

        <Reveal delay={0.4} direction="none">
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <li>30-day trial on every paid feature</li>
            <li className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-success" aria-hidden />
              SOS is never gated by a plan
            </li>
            <li>Your data stays yours</li>
          </ul>
        </Reveal>
      </div>

      <CommandPanel progress={scrollYProgress} />
    </section>
  );
}

/**
 * Every capability, drifting past.
 *
 * The list below lets somebody search 48 things; this says "there are 48
 * things" in a single glance, without asking anyone to read a grid. It is the
 * catalogue itself, so it grows with the product.
 */
export function CapabilityMarquee() {
  return (
    <div className="border-y border-border/60 bg-secondary/30 py-5">
      <p className="mb-4 text-center text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Everything in the platform
      </p>
      <Marquee duration={90}>
        {FEATURE_CATALOGUE.map((definition) => (
          <span key={definition.key} className="flex items-center gap-6 pr-6">
            <span className="whitespace-nowrap text-sm font-medium text-foreground/70">
              {definition.name}
            </span>
            <span className="size-1 shrink-0 rounded-full bg-primary/40" aria-hidden />
          </span>
        ))}
      </Marquee>
    </div>
  );
}

/**
 * The counted facts.
 *
 * Every figure is derived from the catalogues the product runs on rather than
 * typed in, so none of it can drift from what ships — and there is no customer
 * count or uptime figure here, because this codebase cannot substantiate
 * either.
 */
export function ProofStats() {
  const points = [
    { value: FEATURE_CATALOGUE.length, label: 'Platform capabilities' },
    { value: TOTAL_DESTINATIONS, label: 'Screens across every role' },
    { value: LANGUAGE_CATALOGUE.length, label: 'Indian languages' },
    { value: ROLE_SHOWCASE.length, label: 'Kinds of account' },
  ];

  return (
    <div className="px-5 py-20 sm:px-8 sm:py-24">
      <RevealGroup
        as="ul"
        className="mx-auto grid max-w-5xl grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-4"
        stagger={0.1}
      >
        {points.map((point) => (
          <RevealItem as="li" key={point.label} className="text-center">
            <p className="tabular text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
              <AnimatedNumber value={point.value} />
            </p>
            <p className="mx-auto mt-2 max-w-[10rem] text-xs leading-snug text-muted-foreground">
              {point.label}
            </p>
          </RevealItem>
        ))}
      </RevealGroup>
    </div>
  );
}
