import * as React from 'react';
import { useInView } from 'framer-motion';
import { Pause, Play } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { Section, SectionHeading } from '../marketing-chrome';
import { Reveal } from '../motion-extras';
import { STAGE } from '../imagery';
import { cn } from '@/lib/utils';
import { DRIVER_APP_MOMENTS, type DriverAppMoment } from './moments';
import { PhoneFrame } from './phone-frame';

const EASE = [0.16, 1, 0.3, 1] as const;

/** How long each moment holds before the tour moves on by itself. */
const MOMENT_MS = 6000;

const SCREEN_ID = 'driver-app-screen';

/**
 * Humsafar, the driver app, walked through one moment of a shift at a time.
 *
 * The other half of the loop the command centre shows: everything the office
 * sees arrives because a phone in a cab sent it. So the band is about that
 * phone - real screens from the shipping app in a drawn handset, stepped
 * through in the order a shift runs.
 *
 * Deliberately not scroll-linked. The page spends its two scroll set pieces on
 * the hero and the command centre; this tours itself while it is on screen,
 * stops for a hover, a focus or a pause, and stops for good once the reader
 * picks a moment, so it never takes the wheel back from somebody reading.
 */
export function DriverAppSection() {
  const reduced = useReducedMotion();
  // Watched through a span that fills the band, because `Section` does not
  // forward a ref and the band has to know when it is on screen to tour.
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const [index, setIndex] = React.useState(0);
  const [stopped, setStopped] = React.useState(false);
  const [held, setHeld] = React.useState(false);

  const total = DRIVER_APP_MOMENTS.length;
  const active = DRIVER_APP_MOMENTS[index] ?? DRIVER_APP_MOMENTS[0];
  const upcoming = DRIVER_APP_MOMENTS[(index + 1) % total];
  const playing = !reduced && !stopped && !held && inView;

  React.useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setTimeout(() => setIndex((at) => (at + 1) % total), MOMENT_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, total]);

  const choose = React.useCallback((at: number) => {
    setStopped(true);
    setIndex(at);
  }, []);

  if (!active) return null;

  return (
    <Section
      id="driver-app"
      width="wide"
      stage
      className={cn('relative isolate overflow-hidden', STAGE)}
    >
      <span ref={ref} className="absolute inset-0 -z-30" aria-hidden />
      <Ambient />

      {/* Heading, phone, moments in source order, so on a phone the screen
          sits directly above the list that drives it. From `lg` the phone
          moves into a column of its own spanning both rows. */}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:grid-rows-[auto_1fr] lg:gap-x-20 lg:gap-y-0">
        <SectionHeading
          align="start"
          onDark
          eyebrow="Humsafar · the driver app"
          title="Every driver gets a humsafar"
          body="Humsafar means fellow traveller, and that is the job: one app that walks a driver from the yard gate to the last kilometre, while the office sees every step of it."
          className="lg:col-start-1 lg:row-start-1"
        />

        <Reveal
          direction="left"
          amount={0.2}
          className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center"
        >
          <PhoneStage active={active} upcoming={upcoming} />
        </Reveal>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <MomentList index={index} playing={playing} onChoose={choose} onHold={setHeld} />

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            {reduced ? null : (
              <button
                type="button"
                onClick={() => setStopped((value) => !value)}
                className="inline-flex items-center gap-2 rounded-full px-1 text-xs font-medium text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {stopped ? (
                  <Play className="size-3.5" aria-hidden />
                ) : (
                  <Pause className="size-3.5" aria-hidden />
                )}
                {stopped ? 'Play the tour' : 'Pause the tour'}
              </button>
            )}
            <p className="text-xs text-white/45">
              Drivers can sign up on their own and join their fleet later with its joining code.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}

/**
 * The moments, as a tab list that drives the phone.
 *
 * Only the selected moment shows its sentence, so the list stays one tidy
 * column however long the copy runs, and the reader's eye has one place to
 * land. Arrow keys move along it as they do in any tab list.
 */
function MomentList({
  index,
  playing,
  onChoose,
  onHold,
}: {
  index: number;
  playing: boolean;
  onChoose: (at: number) => void;
  onHold: (held: boolean) => void;
}) {
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const total = DRIVER_APP_MOMENTS.length;

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, at: number) => {
    const target =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? (at + 1) % total
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? (at - 1 + total) % total
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? total - 1
              : null;
    if (target === null) return;
    event.preventDefault();
    onChoose(target);
    tabs.current[target]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Moments in a driver's shift"
      aria-orientation="vertical"
      className="border-t border-white/10 lg:mt-12"
      onPointerEnter={() => onHold(true)}
      onPointerLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHold(false);
      }}
    >
      {DRIVER_APP_MOMENTS.map((moment, at) => {
        const selected = at === index;
        return (
          <div key={moment.id} className="relative border-b border-white/10">
            <button
              ref={(node) => {
                tabs.current[at] = node;
              }}
              type="button"
              role="tab"
              id={`driver-app-tab-${moment.id}`}
              aria-selected={selected}
              aria-controls={SCREEN_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChoose(at)}
              onKeyDown={(event) => onKeyDown(event, at)}
              className={cn(
                'group flex w-full items-baseline gap-5 rounded-md py-4 text-left transition-colors duration-300',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                selected ? 'text-white' : 'text-white/45 hover:text-white/80',
              )}
            >
              <span
                className={cn(
                  'w-6 shrink-0 font-mono text-xs tabular-nums transition-colors duration-300',
                  selected ? 'text-accent' : 'text-white/30',
                )}
              >
                {String(at + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-semibold tracking-[-0.01em] sm:text-lg">
                  {moment.title}
                </span>
                {/* Opened with a grid-row transition rather than an animated
                    height: nothing has to be measured, so the list never
                    reflows the page mid-step. Hidden rows are aria-hidden,
                    which keeps them out of the tab's accessible name. */}
                <span
                  aria-hidden={!selected}
                  className={cn(
                    'grid transition-[grid-template-rows,opacity] duration-500 ease-smooth motion-reduce:transition-none',
                    selected ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                  )}
                >
                  <span className="block overflow-hidden">
                    <span className="block max-w-xl pt-2 text-sm leading-relaxed text-white/65">
                      {moment.body}
                    </span>
                  </span>
                </span>
              </span>
            </button>

            {/* How long until the tour moves on; a still line once it stops. */}
            {selected ? (
              <span className="absolute inset-x-0 -bottom-px h-px overflow-hidden" aria-hidden>
                <motion.span
                  key={`${moment.id}-${playing}`}
                  className="block h-full origin-left bg-accent"
                  initial={{ scaleX: playing ? 0 : 1 }}
                  animate={{ scaleX: 1 }}
                  transition={
                    playing ? { duration: MOMENT_MS / 1000, ease: 'linear' } : { duration: 0 }
                  }
                />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The handset, a second one behind it, and the tag that names the moment.
 *
 * The phone behind shows what comes next, which is the one piece of depth
 * here that carries meaning: the shift has a next step and it is already
 * waiting. It is decorative to assistive tech, which hears only the front
 * screen.
 */
function PhoneStage({ active, upcoming }: { active: DriverAppMoment; upcoming?: DriverAppMoment }) {
  const reduced = useReducedMotion();
  const TagIcon = active.tagIcon;

  return (
    <div className="relative mx-auto w-full max-w-[26rem] lg:max-w-none lg:pb-6">
      {upcoming ? (
        <PhoneFrame
          decorative
          src={upcoming.screen}
          alt=""
          screenKey={upcoming.id}
          className="absolute left-[2%] top-[8%] hidden w-[58%] -rotate-[8deg] opacity-45 blur-[0.5px] sm:block"
        />
      ) : null}

      <div
        id={SCREEN_ID}
        role="tabpanel"
        aria-labelledby={`driver-app-tab-${active.id}`}
        className="relative z-10 mx-auto w-[62%] max-w-[19.5rem] sm:ml-auto sm:mr-[6%] sm:w-[72%] lg:w-[78%]"
      >
        <PhoneFrame src={active.screen} alt={active.alt} screenKey={active.id} />

        {/* Under the phone on a narrow screen; from `sm` it hangs off the
            phone's left edge, overlapping only the bezel so it never covers
            the screen it is describing. */}
        <div className="relative z-20 mt-5 flex justify-center sm:absolute sm:right-[calc(100%-0.9rem)] sm:top-[54%] sm:mt-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={active.id}
              initial={reduced ? false : { opacity: 0, y: 10, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={reduced ? undefined : { opacity: 0, y: -8, filter: 'blur(4px)' }}
              transition={{ duration: 0.4, ease: EASE }}
              className="flex items-center gap-2.5 whitespace-nowrap rounded-full border border-white/15 bg-[hsl(240_6%_10%/0.85)] py-2 pl-2 pr-4 text-xs font-medium text-white shadow-[0_18px_40px_-16px_rgba(0,0,0,0.9)] backdrop-blur-md sm:text-sm"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-accent/15 text-accent">
                <TagIcon className="size-3.5" aria-hidden />
              </span>
              {active.tag}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** The two lights every frame on the page is held to: navy behind, one saffron. */
function Ambient() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-20" aria-hidden>
      <div className="absolute right-[6%] top-[12%] size-[30rem] rounded-full bg-[#2360BE]/25 blur-[130px]" />
      <div className="absolute bottom-[4%] right-[24%] size-56 rounded-full bg-[#FF8C2E]/15 blur-[110px]" />
      <div className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_70%_45%,black,transparent_70%)]" />
    </div>
  );
}
