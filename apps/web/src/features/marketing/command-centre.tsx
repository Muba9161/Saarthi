import * as React from 'react';
import { Activity, FileCheck2, Gauge, MapPin, Send, Truck } from 'lucide-react';
import { useInView } from 'framer-motion';
import { FEATURE_CATALOGUE, Feature } from '@saarthi/shared';
import { useReducedMotion } from '@/components/motion';
import { useMediaQuery } from './motion-extras';
import { STAGE } from './imagery';
import { ScrollTrigger } from './scroll-engine';
import { cn } from '@/lib/utils';

/**
 * The command centre - the page's one set piece.
 *
 * Everywhere else the site *describes* the product. Here it demonstrates the
 * loop the product actually closes: a vehicle is tracked, opened, measured,
 * and then something is done about it. TRACK, MANAGE, ANALYSE, ACT. Those four
 * words are the argument for buying one system instead of four, and a reader
 * who scrolls this section has been shown it rather than told it.
 *
 * ## Why this and not a screenshot carousel
 *
 * Four screenshots in a slider is the default answer, and it fails three ways
 * at once: it dates the moment any screen changes, it needs a light and a dark
 * cut of every frame to survive the theme toggle, and a static image cannot
 * show the one thing that matters here, which is that these are four views of
 * the *same* record rather than four separate products. The instrument below
 * is built from the same design tokens as the running app, so it follows the
 * visitor's theme for free and cannot go stale - and the vehicle stays on
 * screen through all four beats, which is the whole point.
 *
 * ## How the scene is driven, and why it is not a GSAP timeline
 *
 * ScrollTrigger reports progress; everything visible is then ordinary React
 * state and CSS transitions. The first version of this section was a scrubbed
 * GSAP timeline animating nodes found by `querySelector`, and it failed in the
 * worst way a scroll scene can: the section pinned correctly, the lane drew
 * itself, and the beats never advanced. A timeline built from queried nodes
 * and tween-authored opacity has a dozen ways to half-work - a selector that
 * matches nothing animates nothing and reports no error, and a trigger
 * measured before the hero's photograph decodes is measuring a page that no
 * longer exists.
 *
 * State cannot half-work. If `progress` moves, `active` moves, and if `active`
 * moves the beat changes, because the beat is a function of it. ScrollTrigger
 * is left doing the one job it is genuinely irreplaceable for - turning a
 * sticky section's travel into a number - and nothing else.
 *
 * `position: sticky` holds the view rather than GSAP's `pin`, for the same
 * reason: pinning rewrites layout and injects a spacer that has to be unwound
 * when this lazily routed page unmounts. Sticky is the browser's own
 * compositor doing it with no DOM surgery and nothing to leak.
 *
 * ## Where the held scene does not run
 *
 * Below `lg`, and under `prefers-reduced-motion` at any width, the section
 * becomes the same four beats as a plain stacked list. A held view needs a
 * viewport tall enough for a heading, a beat and an instrument at once, and a
 * phone is not - the held version overflowed its own box, cut the heading off
 * the top, and still charged the reader three screens of scrolling for it.
 *
 * Nothing is lost either way, because every claim the scene makes is already
 * text. That is the test a scroll scene has to pass before it earns its place:
 * if the section cannot be written as a list, the animation was carrying
 * meaning that was never in the words.
 */

/* -------------------------------------------------------------------------
 * Content
 *
 * Capability names are resolved out of `FEATURE_CATALOGUE` by key rather than
 * typed here, for the same reason the rest of the page does it: renaming a
 * feature in `packages/shared` renames it on the site, and removing one
 * removes it here instead of leaving a dead claim behind.
 * ---------------------------------------------------------------------- */

const CATALOGUE_BY_KEY = new Map(FEATURE_CATALOGUE.map((entry) => [entry.key, entry]));

/** A capability's shipped name, or nothing if it has been withdrawn. */
function featureName(key: Feature): string | null {
  return CATALOGUE_BY_KEY.get(key)?.name ?? null;
}

interface Beat {
  id: string;
  verb: string;
  title: string;
  body: string;
  features: readonly Feature[];
}

const BEATS: readonly Beat[] = [
  {
    id: 'track',
    verb: 'Track',
    title: 'Every vehicle, where it actually is',
    body: 'Positions and ETAs pushed over a socket as they change, not polled on a timer. Route deviation and delay raise themselves, and the whole history of a trip can be replayed afterwards.',
    features: [Feature.TRACKING_LIVE, Feature.ROUTE_INTELLIGENCE, Feature.TRACKING_REPLAY],
  },
  {
    id: 'manage',
    verb: 'Manage',
    title: 'Open the vehicle, not a spreadsheet',
    body: 'One record carries the driver on it, the load inside it, the permit that expires next month, the EMI due on the 5th and the FASTag balance that will stop it at the next plaza.',
    features: [Feature.FLEET_BASIC, Feature.DOCUMENTS_BASIC, Feature.TOLL_FASTAG],
  },
  {
    id: 'analyse',
    verb: 'Analyse',
    title: 'Numbers that come from the same records',
    body: 'Utilisation, running cost and driver scores are read from the trips that produced them. Nothing is re-keyed into a monthly spreadsheet, which is the only reason two screens agree.',
    features: [Feature.FLEET_ANALYTICS, Feature.REPORTS_ADVANCED, Feature.DRIVER_SCORING],
  },
  {
    id: 'act',
    verb: 'Act',
    title: 'Decide, and it is already done',
    body: 'Assign the return load, start the permit renewal, warn the customer that the ETA moved. The action writes to the same record you were just reading, and everyone watching it sees the change.',
    features: [Feature.ORDERS_MARKETPLACE, Feature.DOCUMENTS_AUTOMATION, Feature.ALERTS_SMART],
  },
] as const;

const LAST = BEATS.length - 1;

/**
 * The panel ground.
 *
 * A flat rgba rather than `bg-white/[0.07]` over a backdrop blur, and rather
 * than an opacity modifier on an arbitrary colour. Backdrop filters were
 * costing a full-frame repaint each on the slowest-scrolling part of the page
 * for a blur of a flat near-black ground - nothing was behind them to blur.
 * And `bg-[hsl(...)]/95` is the one Tailwind form that can silently generate
 * no rule at all, which on a panel that has to stay legible over a moving lane
 * is not a risk worth taking.
 */
const PANEL = 'border border-white/12 bg-[rgba(20,20,24,0.92)]';

/* -------------------------------------------------------------------------
 * The instrument
 * ---------------------------------------------------------------------- */

/** The lane the vehicle runs, shared by every beat so the subject never moves. */
const LANE = 'M32 214 C 118 214, 150 96, 250 110 S 404 178, 496 58';

const STOPS = [
  { x: 32, y: 214 },
  { x: 250, y: 110 },
  { x: 496, y: 58 },
] as const;

/** How a beat's layer is shown or put away. One rule, four panels. */
function layer(active: boolean): string {
  return cn(
    'transition-all duration-500 ease-smooth motion-reduce:transition-none',
    active ? 'opacity-100 translate-y-0' : 'pointer-events-none translate-y-4 opacity-0',
  );
}

/**
 * The surface all four beats happen on.
 *
 * Layered rather than swapped: the lane and its stops are drawn once and stay
 * for the whole scene, and each beat's own panel fades in over them. That is
 * what makes it read as one record being examined four ways instead of four
 * unrelated pictures - and it is also cheaper, because nothing remounts.
 *
 * `laneRef` is handed in rather than queried, so the one element the scroll
 * handler writes to every frame is a reference the compiler has checked
 * rather than a selector that can quietly match nothing.
 */
function Instrument({
  active,
  laneRef,
}: {
  active: number;
  laneRef?: React.Ref<SVGPathElement>;
}) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-overlay sm:aspect-[16/11]">
      {/* Chrome. A thin technical header, not a fake browser window - the
          traffic lights were the one detail that made the old hero panel read
          as a mockup rather than as an instrument. */}
      <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
        <MapPin className="size-3.5 text-white/40" aria-hidden />
        <span className="text-2xs font-medium uppercase tracking-[0.16em] text-white/45">
          MH-12-DK-8421
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-2xs font-medium text-success">
          <span className="live-dot" aria-hidden />
          Live
        </span>
      </div>

      <div className="relative h-[calc(100%-2.8rem)]">
        <div className="absolute inset-0 bg-grid-subtle bg-grid opacity-[0.12]" aria-hidden />

        <svg
          className="absolute inset-0 size-full"
          viewBox="0 0 528 264"
          /*
           * `meet`, not `slice`.
           *
           * `slice` fills the box by cropping, and this lane runs corner to
           * corner - so on any container wider than 2:1 the first and last
           * stops were cropped straight off the edges, leaving a single dot
           * stranded in the middle of an empty grid. `meet` keeps the whole
           * lane in frame at every aspect the card takes.
           */
          preserveAspectRatio="xMidYMid meet"
          fill="none"
          aria-hidden
        >
          <path
            d={LANE}
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="2"
            strokeDasharray="3 7"
            strokeLinecap="round"
          />
          {/*
           * The travelled lane. `pathLength="1"` normalises the path so the
           * dash and the offset are both fractions of it, whatever the
           * geometry - which is what lets the scroll handler write a 0-to-1
           * progress straight into `strokeDashoffset` with no measuring.
           *
           * Rendered fully drawn. Every reader who is not being scrubbed -
           * reduced motion, a failed script, a crawler - sees the finished
           * lane rather than an empty grid.
           */}
          <path
            ref={laneRef}
            d={LANE}
            stroke="hsl(var(--primary))"
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={0}
          />

          {STOPS.map((stop) => (
            <circle
              key={`${stop.x}-${stop.y}`}
              cx={stop.x}
              cy={stop.y}
              r="4"
              fill="hsl(var(--primary))"
              stroke="hsl(240 6% 7%)"
              strokeWidth="2.5"
            />
          ))}
        </svg>

        {/* Beat 1 - the live readout floating on the lane. */}
        <div
          className={cn(
            'absolute inset-x-4 bottom-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl px-4 py-3',
            PANEL,
            layer(active === 0),
          )}
        >
          {[
            { label: 'Speed', value: '58 km/h' },
            { label: 'ETA', value: '2h 40m' },
            { label: 'Deviation', value: 'None' },
          ].map((item) => (
            <div key={item.label} className="flex items-baseline gap-2">
              <span className="text-2xs uppercase tracking-[0.14em] text-white/40">
                {item.label}
              </span>
              <span className="tabular text-sm font-medium text-white/90">{item.value}</span>
            </div>
          ))}
        </div>

        {/* Beat 2 - the record behind the dot. */}
        <div
          className={cn('absolute inset-x-4 bottom-4 rounded-xl p-4', PANEL, layer(active === 1))}
        >
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary ring-1 ring-inset ring-primary/25">
              <Truck className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">Tata LPT 3118 · 31 t</p>
              <p className="truncate text-2xs text-white/50">
                Driver: R. Kulkarni · Score 782 · Pune to Nagpur
              </p>
            </div>
          </div>

          <ul className="mt-3 grid grid-cols-3 gap-2">
            {[
              { label: 'Permit', value: '42 days', tone: 'text-success' },
              { label: 'EMI due', value: '5 Oct', tone: 'text-warning' },
              { label: 'FASTag', value: '₹1,240', tone: 'text-white/85' },
            ].map((item) => (
              <li key={item.label} className="rounded-lg bg-white/[0.06] px-2.5 py-2">
                <p className="text-2xs uppercase tracking-[0.12em] text-white/40">{item.label}</p>
                <p className={cn('tabular mt-0.5 text-xs font-semibold', item.tone)}>
                  {item.value}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* Beat 3 - the same record, counted. */}
        <div
          className={cn('absolute inset-x-4 bottom-4 rounded-xl p-4', PANEL, layer(active === 2))}
        >
          <div className="flex items-center gap-2">
            <Gauge className="size-3.5 text-white/40" aria-hidden />
            <p className="text-2xs uppercase tracking-[0.14em] text-white/45">
              This vehicle, last 30 days
            </p>
          </div>

          <ul className="mt-3 space-y-2.5">
            {[
              { label: 'Utilisation', value: 74 },
              { label: 'On-time arrivals', value: 88 },
              { label: 'Fuel vs fleet average', value: 61 },
            ].map((bar, index) => (
              <li key={bar.label}>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xs text-white/55">{bar.label}</span>
                  <span className="tabular text-2xs font-semibold text-white/85">{bar.value}%</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                  {/*
                   * Grows to its value as the beat arrives. A bar already at
                   * 74% is a picture of a bar; one that travels there is a
                   * measurement, which is the difference between decoration
                   * and the thing this section is claiming.
                   */}
                  <span
                    className="block h-full rounded-full bg-logo-gradient transition-[width] duration-700 ease-smooth motion-reduce:transition-none"
                    style={{
                      width: active === 2 ? `${bar.value}%` : '0%',
                      transitionDelay: `${index * 110}ms`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Beat 4 - what the reading was for. */}
        <div className={cn('absolute inset-x-4 bottom-4 space-y-2', layer(active === 3))}>
          {[
            { icon: Send, text: 'Return load assigned · Nagpur to Pune', tone: 'text-primary' },
            { icon: FileCheck2, text: 'Permit renewal started', tone: 'text-success' },
            { icon: Activity, text: 'Customer notified: ETA moved to 18:40', tone: 'text-accent' },
          ].map((row, index) => (
            <div
              key={row.text}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3.5 py-2.5',
                PANEL,
                'transition-transform duration-500 ease-smooth motion-reduce:transition-none',
                active === 3 ? 'translate-x-0' : 'translate-x-5',
              )}
              style={{ transitionDelay: `${index * 110}ms` }}
            >
              <row.icon className={cn('size-4 shrink-0', row.tone)} aria-hidden />
              <p className="truncate text-xs text-white/85">{row.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Beat copy
 * ---------------------------------------------------------------------- */

function BeatCopy({ beat, index }: { beat: Beat; index: number }) {
  const names = beat.features.map(featureName).filter((name): name is string => name !== null);

  return (
    <div>
      <p className="flex items-center gap-3 text-2xs font-semibold uppercase tracking-[0.2em] text-accent">
        <span className="tabular">{String(index + 1).padStart(2, '0')}</span>
        <span className="h-px w-6 bg-accent/40" aria-hidden />
        {beat.verb}
      </p>

      <h3 className="mt-4 text-balance text-xl font-semibold leading-[1.16] tracking-[-0.02em] text-white sm:text-2xl lg:text-[1.75rem]">
        {beat.title}
      </h3>

      <p className="mt-4 max-w-lg text-pretty text-sm leading-relaxed text-white/60 sm:text-base">
        {beat.body}
      </p>

      <ul className="mt-6 flex flex-wrap gap-2">
        {names.map((name) => (
          <li
            key={name}
            className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1 text-2xs font-medium text-white/65"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The section's standing header.
 *
 * Inside the held view rather than above it, and that is a layout fix as much
 * as a design one.
 *
 * A tall intro block above a `sticky h-screen` scene leaves a half-screen of
 * nothing on the way in: until the sticky element's top reaches the viewport
 * top it is an ordinary box, and its content is centred inside a full viewport
 * height that begins wherever the intro ended. The reader scrolls past the
 * heading into an empty stage and assumes the page is broken. Folding the
 * header into the scene removes the gap by removing the thing above it.
 *
 * It earns its place independently: with the beats changing underneath, a
 * standing heading is the only thing telling the reader which section they are
 * still in.
 */
function SceneHeader() {
  return (
    <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
      <div>
        <p className="flex items-center gap-2.5 text-2xs font-semibold uppercase tracking-[0.16em] text-accent">
          <span className="h-px w-6 bg-accent/50" aria-hidden />
          The loop
        </p>
        <h2 className="mt-4 max-w-2xl text-balance text-2xl font-semibold leading-[1.14] tracking-[-0.03em] text-white sm:text-3xl lg:text-[2.125rem]">
          Track it, open it, measure it, and do something about it
        </h2>
      </div>

      <p className="max-w-sm text-pretty text-sm leading-relaxed text-white/55 lg:shrink-0 lg:text-right">
        Four views of one record, not four products - which is why a delay on the road reaches the
        customer, the driver's score and the month's analytics without anybody typing it twice.
      </p>
    </div>
  );
}

/** The rail beside the copy. Decorative - the numerals say the same in text. */
function Rail({ active }: { active: number }) {
  return (
    <div className="relative hidden w-3 shrink-0 sm:block" aria-hidden>
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10" />
      <span
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 origin-top bg-accent/60 transition-transform duration-500 ease-smooth motion-reduce:transition-none"
        style={{ transform: `translateX(-50%) scaleY(${(active + 1) / BEATS.length})` }}
      />
      {BEATS.map((beat, index) => (
        <span
          key={beat.id}
          className={cn(
            'absolute left-1/2 size-2 -translate-x-1/2 rounded-full transition-all duration-500 ease-smooth motion-reduce:transition-none',
            index <= active ? 'scale-[1.35] bg-accent' : 'bg-white/25',
          )}
          style={{ top: `${(index / LAST) * 100}%` }}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * The scene
 * ---------------------------------------------------------------------- */

/**
 * The scroll-driven version.
 *
 * One ScrollTrigger, one `onUpdate`, and everything downstream is state. The
 * lane is written to directly rather than through React, because it changes on
 * every frame and a `setState` per frame to move a dashed line is sixty
 * renders a second of the entire section.
 */
function ScrubbedScene() {
  const sceneRef = React.useRef<HTMLDivElement>(null);
  const laneRef = React.useRef<SVGPathElement>(null);
  const [active, setActive] = React.useState(0);

  React.useLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;

    const trigger = ScrollTrigger.create({
      trigger: scene,
      start: 'top top',
      end: 'bottom bottom',
      /*
       * Re-measured whenever ScrollTrigger refreshes.
       *
       * The landing page is lazily routed, so this trigger is created before
       * the hero's photograph has decoded - and every band below it moves when
       * it does. Without this the scene would hold start and end positions
       * describing a page that no longer exists, which looks exactly like the
       * scene being stuck: sticky still works, the reader still scrolls, and
       * the progress never moves.
       */
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const { progress } = self;

        /*
         * The lane draws across the first beat and then stays. Written
         * straight to the element: it changes every frame, and routing that
         * through React would re-render the whole section sixty times a
         * second to move a dashed line.
         */
        const lane = laneRef.current;
        if (lane) {
          const drawn = Math.min(progress * BEATS.length, 1);
          lane.style.strokeDashoffset = String(1 - drawn);
        }

        /*
         * Which beat the reader is in. Floor of the progress across the beats,
         * clamped so the final beat holds the last frame rather than falling
         * off the end when progress reaches exactly 1.
         */
        const index = Math.min(Math.floor(progress * BEATS.length), LAST);
        setActive((current) => (current === index ? current : index));
      },
    });

    /*
     * One refresh after layout settles, and another when the last image lands.
     *
     * ScrollTrigger measures on creation. This component is mounted by a lazy
     * route, so at that moment the page is shorter than it will be a second
     * later - the two refreshes are what make the measurement describe the
     * finished page rather than the loading one.
     */
    const frame = requestAnimationFrame(() => ScrollTrigger.refresh());
    const onLoad = (): void => ScrollTrigger.refresh();
    window.addEventListener('load', onLoad);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('load', onLoad);
      trigger.kill();
    };
  }, []);

  return (
    <div
      ref={sceneRef}
      /*
       * Four beats plus a hold, expressed as viewport heights. The sticky
       * child is one of them, so the scene has `height - 100vh` of travel -
       * 220vh here, or about 55vh of scrolling per beat.
       *
       * That number is a budget rather than a taste. A held view is the one
       * place on a page where the reader's scrollbar stops doing what they
       * expect, and past roughly three and a half screens of it people stop
       * believing the page is responding. Four beats is what fits inside that,
       * which is why the section has four.
       */
      className="relative h-[320vh]"
    >
      {/*
       * `justify-center` on the column, so the whole block — header and scene
       * together — sits in the middle of the held view. The header is part of
       * what is held; see `SceneHeader` for why it is not above it.
       */}
      <div className="sticky top-0 flex h-screen flex-col justify-center px-5 sm:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <SceneHeader />

          <div className="mt-10 grid items-center gap-10 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-14">
            <div className="flex gap-6 sm:gap-8">
              <Rail active={active} />

              {/* Stacked in one grid cell so the beats cross-fade in place.
                  Without the shared cell each would claim its own row and the
                  column would be four screens tall. */}
              <div className="grid flex-1 [&>*]:col-start-1 [&>*]:row-start-1">
                {BEATS.map((beat, index) => (
                  <div key={beat.id} className={layer(active === index)}>
                    <BeatCopy beat={beat} index={index} />
                  </div>
                ))}
              </div>
            </div>

            <Instrument active={active} laneRef={laneRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The same four beats, stacked.
 *
 * What a visitor gets on a phone or a tablet, and under
 * `prefers-reduced-motion` at any width. It is not a degraded version so much
 * as the same content without the choreography, and on a small screen it is
 * the better design outright.
 *
 * A held scene needs a viewport tall enough to hold a heading, a beat and an
 * instrument at once. A 360x640 phone is not, so the held version overflowed
 * its own box and cut the heading off the top - while still charging the
 * reader 320vh of scrolling to see four beats that barely moved. That is the
 * worst of both: a scene that feels stuck *and* loses content.
 *
 * Stacked, each beat carries its own instrument directly beneath it, which
 * reads better on a narrow column than one panel far from the words
 * describing it. From `lg` up, where there is room beside the text, the
 * instrument becomes a single sticky panel that follows whichever beat is on
 * screen instead of repeating four times.
 */
function StackedScene() {
  const [active, setActive] = React.useState(0);

  return (
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <SceneHeader />

      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-14">
        <ol className="space-y-16 lg:space-y-24">
          {BEATS.map((beat, index) => (
            <StackedBeat key={beat.id} beat={beat} index={index} onEnter={setActive} />
          ))}
        </ol>

        {/*
         * The following panel, for wide screens only. Below `lg` each beat
         * has its own instrument inline, so rendering this as well would put
         * a fifth copy at the foot of the list with nothing beside it.
         */}
        <div className="hidden lg:sticky lg:top-28 lg:block lg:h-fit">
          <Instrument active={active} />
        </div>
      </div>
    </div>
  );
}

/**
 * One beat in the stacked list, claiming the following panel while on screen.
 *
 * Half the block must be showing before it claims the panel, so the instrument
 * changes once per beat rather than flickering between two - the same rule the
 * lifecycle rail in `story-sections` uses.
 */
function StackedBeat({
  beat,
  index,
  onEnter,
}: {
  beat: Beat;
  index: number;
  onEnter: (index: number) => void;
}) {
  const ref = React.useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { amount: 0.5 });

  React.useEffect(() => {
    if (inView) onEnter(index);
  }, [inView, index, onEnter]);

  return (
    <li ref={ref}>
      <BeatCopy beat={beat} index={index} />

      {/* This beat's own instrument, on the widths where there is no room for
          a panel beside the text. */}
      <div className="mt-8 lg:hidden">
        <Instrument active={index} />
      </div>
    </li>
  );
}

export function CommandCentre() {
  const reduced = useReducedMotion();
  /*
   * The held scene is desktop-only, and the breakpoint decides structure
   * rather than styling — whether a 320vh container and a ScrollTrigger are
   * built at all. A Tailwind breakpoint could only have hidden them.
   */
  const wide = useMediaQuery('(min-width: 1024px)');
  const held = wide && !reduced;

  return (
    <section
      id="command"
      data-stage
      /*
       * No `overflow-hidden` on this section, and it is load-bearing rather
       * than a style choice.
       *
       * `position: sticky` resolves against its nearest scrollable ancestor,
       * and an ancestor with `overflow: hidden` counts as one - a scroll
       * container that cannot scroll. The sticky child then has nothing to
       * stick within and behaves as a static element: the scene scrolls past
       * at full height and leaves three empty screens of black stage behind
       * it. Anything here that needs clipping clips itself, in its own box.
       */
      className={cn('relative isolate py-16 sm:py-20', STAGE)}
    >
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        {/*
         * A radial gradient, not a blurred circle.
         *
         * `blur-[150px]` on a 46rem element is a 150px Gaussian over roughly
         * half a million pixels, re-evaluated by the compositor on every frame
         * the band is on screen - which, for a scene held across three
         * viewport heights, is every frame of the slowest part of the page. A
         * gradient paints the same pool of light once, for free.
         */}
        <div
          className="absolute left-1/2 top-0 h-[46rem] w-[46rem] -translate-x-1/2"
          style={{
            background:
              'radial-gradient(circle, hsl(var(--primary) / 0.16) 0%, hsl(var(--primary) / 0.05) 42%, transparent 68%)',
          }}
        />
      </div>

      {held ? <ScrubbedScene /> : <StackedScene />}
    </section>
  );
}
