import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PlayCircle, ShieldCheck } from 'lucide-react';
import { useScroll, useTransform } from 'framer-motion';
import { FEATURE_CATALOGUE, LANGUAGE_CATALOGUE } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { AnimatedNumber, motion, useReducedMotion } from '@/components/motion';
import { Marquee, Reveal, RevealGroup, RevealItem } from './motion-extras';
import { Backdrop, CutOut, MARKETING_IMAGE, STAGE } from './imagery';
import { ROLE_SHOWCASE, TOTAL_DESTINATIONS } from './feature-catalogue';
import { FleetCanvas, type FleetTelemetry } from './fleet-canvas';
import { Magnetic } from './magnetic';
import { gsap, useGsapScope } from './scroll-engine';
import { DURATION, STAGGER } from './design-system';
import { cn } from '@/lib/utils';

/**
 * The first screen.
 *
 * One idea holds this composition together: **the photograph is the road, and
 * the network drawn over it is what Saarthi sees.** The frame underneath is a
 * real highway at night; the lanes, nodes and moving vehicles above it are the
 * same road as the platform holds it — as a graph with positions, histories
 * and arrival times on it. Scrolling pulls the two apart slightly, so the
 * visibility layer reads as sitting *above* reality rather than being printed
 * on it.
 *
 * That is the entire product proposition stated before a word is read, and it
 * is the reason this hero is not the usual arrangement of a headline beside a
 * screenshot of an app. A screenshot shows what the software looks like. This
 * shows what the software is *for*.
 *
 * The band stays a fixed near-black in both themes, like every other
 * photographic band on the page — see the long note in `imagery.tsx`. And it
 * degrades in the right order: with no photograph the network still sits on a
 * lit dark stage, and with neither the headline is still a headline on a dark
 * ground. Nothing here depends on an asset being present.
 */

/* -------------------------------------------------------------------------
 * Headline
 * ---------------------------------------------------------------------- */

/**
 * The hero headline, assembled line by line out of a clipping mask.
 *
 * GSAP rather than the page's Framer-Motion `WordsReveal`, and the difference
 * is the point: this is the one piece of typography on the site that gets a
 * timeline instead of a transition. The lines overlap by two-thirds of their
 * own duration, so the headline arrives as a single movement with weight to it
 * rather than as three separate animations that happen to be staggered. That
 * overlap is expressible in one timeline and genuinely awkward to express in
 * per-element transitions, which is the rule this page follows for choosing
 * between the two libraries.
 *
 * Each line is a `block` inside `overflow-hidden`, with the padding trick the
 * rest of the site uses: at `leading-[0.95]` the clip box is shorter than the
 * font's own vertical extent, so descenders would be shaved off the bottom
 * without the extra room. The wrapper gives that room back as negative margin
 * so nothing on the page moves.
 *
 * The accessible text is the ordinary text content of the `h1`. No line is
 * hidden from assistive technology, and under reduced motion the whole
 * mechanism is skipped and the words are simply there.
 */
function HeroHeadline({ lines }: { lines: readonly (readonly [string, string?])[] }) {
  const scope = useGsapScope<HTMLHeadingElement>((context) => {
    const targets = context.scope.querySelectorAll('[data-hero-line]');

    gsap.fromTo(
      targets,
      { yPercent: 115, opacity: 0 },
      {
        yPercent: 0,
        opacity: 1,
        duration: DURATION.slow,
        ease: 'power3.out',
        // A third of the line duration, so line two starts while line one is
        // still settling. Consecutive rather than simultaneous, but only just.
        stagger: DURATION.slow / 3,
        delay: 0.15,
      },
    );
  });

  return (
    <h1
      ref={scope}
      className="mt-7 text-balance text-[2.6rem] font-semibold leading-[0.98] tracking-[-0.04em] text-white sm:text-6xl lg:text-[4.5rem] lg:leading-[0.95]"
    >
      {lines.map(([text, accent], index) => (
        <span key={text} className="-mb-[0.16em] block overflow-hidden pb-[0.02em]">
          <span
            data-hero-line
            className={cn('block pb-[0.16em]', accent)}
            // The static state. GSAP overwrites both properties on the first
            // frame of its timeline, and under reduced motion it never runs -
            // so the words must already be in place here rather than starting
            // hidden and waiting for an animation that will not come.
            style={{ willChange: index < 3 ? 'transform' : undefined }}
          >
            {text}
          </span>
        </span>
      ))}
    </h1>
  );
}

/* -------------------------------------------------------------------------
 * Live readout
 * ---------------------------------------------------------------------- */

/**
 * The focused vehicle's telemetry, in words.
 *
 * The canvas beside it is `aria-hidden`, so this strip is where the scene
 * becomes information rather than decoration: it is real text, it updates four
 * times a second because the dot on screen moved, and it says plainly that the
 * fleet is a sample. That last part is not a disclaimer bolted on - the page
 * refuses to print a customer count or an uptime figure anywhere for the same
 * reason, and a hero quietly implying live customer traffic would be the one
 * dishonest thing on it.
 *
 * `aria-live` is deliberately absent. A region that re-announces a changing
 * speed four times a second is unusable with a screen reader; the label says
 * what the strip is, and the numbers are supporting texture.
 */
function LiveReadout({ telemetry }: { telemetry: FleetTelemetry | null }) {
  const eta = telemetry ? `${Math.floor(telemetry.eta / 60)}h ${telemetry.eta % 60}m` : '- -';

  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-white/70 sm:gap-x-8">
      <div className="flex items-center gap-2">
        <span className="live-dot" aria-hidden />
        <dt className="sr-only">Status</dt>
        <dd className="text-2xs font-medium uppercase tracking-[0.16em] text-white/50">
          Sample fleet, moving
        </dd>
      </div>

      <div className="flex items-baseline gap-2">
        <dt className="text-2xs uppercase tracking-[0.16em] text-white/40">Vehicle</dt>
        <dd className="tabular text-sm font-medium text-white/85">MH-12-DK-8421</dd>
      </div>

      <div className="flex items-baseline gap-2">
        <dt className="text-2xs uppercase tracking-[0.16em] text-white/40">Speed</dt>
        <dd className="tabular text-sm font-medium text-white/85">
          {telemetry ? `${telemetry.speed} km/h` : '- -'}
        </dd>
      </div>

      <div className="flex items-baseline gap-2">
        <dt className="text-2xs uppercase tracking-[0.16em] text-white/40">ETA</dt>
        <dd className="tabular text-sm font-medium text-white/85">{eta}</dd>
      </div>
    </dl>
  );
}

/* -------------------------------------------------------------------------
 * Hero
 * ---------------------------------------------------------------------- */

const HEADLINE = [
  ['The operating system'],
  ['for everything', undefined],
  ['you move', 'brand-logo-gradient-on-dark'],
] as const;

export function Hero() {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const [telemetry, setTelemetry] = React.useState<FleetTelemetry | null>(null);

  /*
   * The two layers come apart as the page moves.
   *
   * The photograph drifts down and the network layer drifts up, so the
   * visibility layer separates from the road it describes rather than sliding
   * with it. Small numbers on purpose - it is a depth cue, and past about
   * 60px it stops reading as distance and starts reading as the layer being
   * loose.
   */
  const washY = useTransform(scrollYProgress, [0, 1], [0, 140]);
  const netY = useTransform(scrollYProgress, [0, 1], [0, -64]);
  const netOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  return (
    <section
      ref={ref}
      data-stage
      className={cn(
        /*
         * `isolate` so the layers below resolve against this section's own
         * ground rather than punching through to the page.
         *
         * `overflow-hidden` is safe again here, and it was not before: the old
         * hero hung a command panel across its bottom edge, and any clip would
         * have guillotined it. The network layer is now contained, which is
         * both a simpler box and the reason the band below no longer needs
         * padding to dodge an overhanging object.
         */
        'relative isolate flex min-h-[46rem] flex-col justify-center overflow-hidden px-5 pb-20 sm:px-8 lg:min-h-[52rem]',
        /*
         * Slides up under the sticky header, whose 4.5rem height this must
         * match. The header is transparent until the page scrolls, which only
         * means anything if there is something behind it; the top padding puts
         * the same air back below it that the negative margin takes away.
         */
        '-mt-[4.5rem] pt-[9rem] sm:pt-[11rem]',
        STAGE,
      )}
    >
      {/*
       * Behind the photograph, so the brand's light reads as being *in* the
       * scene rather than laid over the top of it.
       *
       * Radial gradients rather than `blur-[140px]` on a solid circle. The two
       * look near enough identical and cost nothing alike: a 140px Gaussian
       * over a 42rem box is re-evaluated by the compositor on every frame this
       * layer moves, and this layer moves the whole time the hero is on screen
       * because it is parallaxed. Above a canvas that is also drawing every
       * frame, that was the single most expensive thing on the first screen.
       */}
      <motion.div
        className="pointer-events-none absolute inset-0 -z-30"
        aria-hidden
        style={reduced ? undefined : { y: washY }}
      >
        <div
          className="absolute -left-40 -top-48 size-[42rem]"
          style={{
            background:
              'radial-gradient(circle, hsl(var(--primary) / 0.34) 0%, hsl(var(--primary) / 0.12) 40%, transparent 68%)',
          }}
        />
        <div
          className="absolute -right-32 top-16 size-[34rem]"
          style={{
            background:
              'radial-gradient(circle, hsl(var(--accent) / 0.22) 0%, hsl(var(--accent) / 0.07) 42%, transparent 68%)',
          }}
        />
      </motion.div>

      {/*
       * The road itself.
       *
       * Held back to two-thirds strength, which is a change from every other
       * photographic band on the page - those run the frame at full strength
       * and let the scrim do the protecting. Here a second luminous layer sits
       * on top of it, and at full exposure the highway's own lights compete
       * with the network's nodes for the same part of the eye. Dimming the
       * photograph is what lets the two read as separate planes.
       */}
      <Backdrop
        src={MARKETING_IMAGE.hero}
        portraitSrc={MARKETING_IMAGE.heroPortrait}
        priority
        opacity={0.66}
        // Holds the truck in frame as the 16:9 gets cropped to taller
        // viewports - the subject sits right of centre and low.
        objectPosition="72% 62%"
        className="-z-20"
      />

      {/*
       * What Saarthi sees.
       *
       * Full-bleed rather than boxed into a panel beside the copy. A network
       * in a rounded card is a picture of a network; a network running off
       * every edge of the screen is the one you are inside. The mask keeps it
       * out of the reading column on the left and fades it at the top and
       * bottom edges so it has no visible frame at all.
       */}
      <motion.div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden
        style={reduced ? undefined : { y: netY, opacity: netOpacity }}
      >
        <div
          className="size-full opacity-70 sm:opacity-90"
          style={{
            maskImage:
              'radial-gradient(120% 100% at 78% 50%, #000 12%, rgba(0,0,0,0.55) 48%, transparent 82%)',
            WebkitMaskImage:
              'radial-gradient(120% 100% at 78% 50%, #000 12%, rgba(0,0,0,0.55) 48%, transparent 82%)',
          }}
        >
          <FleetCanvas onTelemetry={setTelemetry} />
        </div>
      </motion.div>

      <div className="relative mx-auto w-full max-w-7xl">
        <div className="max-w-3xl">
          <Reveal direction="none" duration={DURATION.quick}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-2xs font-semibold uppercase tracking-[0.2em] text-white/50">
                VorldX Saarthi
              </p>
              <span className="hidden h-px w-8 bg-white/20 sm:block" aria-hidden />
              <Link
                to="/register"
                className="group inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs text-white/80 backdrop-blur transition-colors duration-200 hover:border-primary/50 hover:bg-white/10 hover:text-white"
              >
                <span className="live-dot" aria-hidden />
                <span className="font-medium">
                  {FEATURE_CATALOGUE.length} capabilities · {ROLE_SHOWCASE.length} kinds of account
                </span>
                <ArrowRight className="size-3 text-white/50 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </Reveal>

          <HeroHeadline lines={HEADLINE} />

          <Reveal delay={0.2}>
            <p className="mt-7 max-w-xl text-pretty text-base leading-relaxed text-white/70 sm:text-lg">
              Fleet owners, drivers, suppliers and customers on one record - from posting a load to
              watching it arrive. Freight or passengers, one truck or two hundred. No phone calls,
              no WhatsApp groups, no paper register.
            </p>
          </Reveal>

          <Reveal delay={0.3}>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Magnetic className="w-full sm:w-auto">
                <Button
                  size="xl"
                  variant="gradient"
                  asChild
                  className="group w-full rounded-full sm:w-auto"
                >
                  <Link to="/register">
                    Start free - no card needed
                    <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </Button>
              </Magnetic>

              {/* `outline` is built for a light page - its ring and card ground
                  vanish on the stage, so both are restated here rather than a
                  new variant being added for one button. */}
              <Magnetic className="w-full sm:w-auto" strength={0.2}>
                <Button
                  size="xl"
                  variant="outline"
                  asChild
                  className="w-full rounded-full bg-white/10 text-white shadow-none ring-white/25 backdrop-blur hover:bg-white/20 hover:ring-white/40 sm:w-auto"
                >
                  <Link to="/login">
                    <PlayCircle className="size-4" />
                    Explore the demo fleet
                  </Link>
                </Button>
              </Magnetic>
            </div>
          </Reveal>

          <Reveal delay={0.4} direction="none">
            <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/55">
              <li>30-day trial on every paid feature</li>
              <li className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-success" aria-hidden />
                SOS is never gated by a plan
              </li>
              <li>Your data stays yours</li>
            </ul>
          </Reveal>
        </div>

        {/* The scene's caption. Sits on the band's own baseline rather than
            floating over the network, so it never lands on a moving vehicle. */}
        <Reveal delay={0.55} direction="none">
          <div className="mt-16 border-t border-white/10 pt-5 sm:mt-20">
            <LiveReadout telemetry={telemetry} />
          </div>
        </Reveal>
      </div>
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
 * typed in, so none of it can drift from what ships - and there is no customer
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
    <div className="px-5 py-14 sm:px-8 sm:py-16">
      <RevealGroup
        as="ul"
        className="mx-auto grid max-w-5xl grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4"
        stagger={STAGGER.loose}
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

      {/*
       * Under the figures, not behind them.
       *
       * This sat as a background wash at low opacity, and it was a mistake in
       * two directions at once: too faint to be seen as a photograph, and
       * still solid enough to put wheels and windows through the middle of
       * four large numerals. Given its own row it can be read properly, and
       * the numbers get their contrast back.
       *
       * A cut-out rather than a framed photo because this band still follows
       * the theme - a rectangle would be a lit slab in the dark theme.
       */}
      <Reveal delay={0.2}>
        <CutOut
          src={MARKETING_IMAGE.fleetLineup}
          alt="A goods truck, tipper, bus, SUV, sedan and auto-rickshaw - the six vehicle classes Saarthi manages."
          aspect="aspect-[3/1]"
          className="mx-auto mt-12 max-w-3xl"
        />
      </Reveal>
    </div>
  );
}
