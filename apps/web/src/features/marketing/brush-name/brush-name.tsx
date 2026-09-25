import * as React from 'react';
import { useInView } from 'framer-motion';
import { LANGUAGE_CATALOGUE } from '@saarthi/shared';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { DURATION, EASE_OUT } from '../design-system';
import { InkWord } from '@/components/ink/ink-word';
import { erasedIn, planInk } from '@/components/ink/ink-timeline';
import { SAARTHI_IN_SCRIPT } from './saarthi-in-script';
import { useInkArt } from './use-ink-art';

/**
 * What the animation walks.
 *
 * Derived from the catalogue rather than from the spellings, so the order is
 * the product's order and a language with no rendering yet falls back to the
 * Latin spelling instead of dropping out of the rotation.
 */
const ROTATION = LANGUAGE_CATALOGUE.map((language) => ({
  code: language.code,
  direction: language.direction,
  english: language.english,
  text: SAARTHI_IN_SCRIPT[language.code] ?? 'Saarthi',
}));

type RotationEntry = (typeof ROTATION)[number];

/** How long a finished word rests before it is un-written. */
const HOLD_S = 1.8;
/** A breath of clean paper between one word and the next. */
const GAP_S = 0.25;
/** Dwell for an entry that has no art yet and is shown as plain text. */
const PLAIN_S = 2.6;

/*
 * The type ramp the band has always used. The art is drawn in ems, so the
 * same classes size the brushed word and its plain-text fallback identically.
 */
const WORD_SIZE = 'text-4xl sm:text-5xl lg:text-6xl';

function PlainWord({ entry, animate }: { entry: RotationEntry; animate: boolean }) {
  return (
    <motion.p
      lang={entry.code}
      dir={entry.direction}
      className={`font-multilingual font-medium tracking-tight text-white ${WORD_SIZE}`}
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
    >
      {entry.text}
    </motion.p>
  );
}

/**
 * The name, written in each language in turn, as if with a brush.
 *
 * Writing starts the first time the band is properly on screen, so a reader
 * arriving there sees a word being written rather than one already finished,
 * and the rotation pauses whenever the band scrolls away. Each word is written,
 * rests, and is then un-written back along the same strokes before the next
 * begins — nothing is swapped out mid-sentence.
 *
 * Reduced motion gets the Latin spelling, held. Cycling the text without the
 * writing would still be movement nobody asked for. The same still frame is
 * the fallback if the outlines fail to load.
 *
 * Decorative, and marked so: a screen reader would otherwise announce 23
 * partial rewrites in scripts it may have no voice for. The equivalent claim
 * is carried by a visually hidden line and by the prose below the band.
 */
export function BrushName() {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.4 });
  const inView = useInView(ref, { amount: 0.2 });
  const ink = useInkArt(!reduced);
  const [index, setIndex] = React.useState(0);
  const [erasing, setErasing] = React.useState(false);

  const writing = !reduced && ink.status === 'ready';
  const entry = (writing ? ROTATION[index] : undefined) ?? ROTATION[0]!;
  const art = ink.status === 'ready' ? ink.art[entry.text] : undefined;
  const plan = React.useMemo(() => (art ? planInk(art) : null), [art]);

  React.useEffect(() => {
    if (!writing || !seen || !inView) return undefined;

    const advance = (): void => {
      setErasing(false);
      setIndex((current) => (current + 1) % ROTATION.length);
    };

    // A plain-text entry has no strokes to retrace; its presence exit fades it.
    const [wait, step] = !plan
      ? [PLAIN_S, advance]
      : erasing
        ? [erasedIn(plan) + GAP_S, advance]
        : [plan.written + HOLD_S, () => setErasing(true)];

    const timer = window.setTimeout(step, wait * 1000);
    return () => window.clearTimeout(timer);
  }, [writing, seen, inView, index, plan, erasing]);

  // Nothing is shown while the outlines load, rather than plain text that
  // would be swapped out moments later. The row keeps its height either way.
  const showStill = reduced || ink.status === 'failed';

  return (
    <div ref={ref} className="mt-10">
      <p className="sr-only">
        Saarthi, written in each of the {ROTATION.length} languages the platform speaks.
      </p>

      {/*
       * Both rows are fixed in height. The scripts differ by a long way in
       * ascender and descender depth — Devanagari hangs from a headline,
       * Malayalam sits deep, Nastaliq climbs and trails well past the line —
       * and letting the box follow the glyphs would make everything under it
       * shuffle with every word. A word taller than the row is scaled to fit.
       */}
      <div className="flex h-24 items-center justify-center sm:h-28" aria-hidden>
        {showStill ? (
          <PlainWord entry={entry} animate={false} />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {writing && seen ? (
              art && plan ? (
                <InkWord
                  key={entry.code}
                  art={art}
                  plan={plan}
                  erasing={erasing}
                  className={WORD_SIZE}
                />
              ) : (
                <PlainWord key={entry.code} entry={entry} animate />
              )
            ) : null}
          </AnimatePresence>
        )}
      </div>

      {/*
       * The language name leaves with its word — it fades as the un-writing
       * starts — and the next one fades in as its word begins.
       */}
      <div className="h-5" aria-hidden>
        {showStill || (writing && seen) ? (
          <motion.p
            key={entry.code}
            className="text-2xs font-semibold uppercase tracking-[0.16em] text-white/50"
            initial={showStill ? false : { opacity: 0 }}
            animate={{ opacity: erasing ? 0 : 1 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
          >
            {entry.english}
          </motion.p>
        ) : null}
      </div>
    </div>
  );
}
