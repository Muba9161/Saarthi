import * as React from 'react';
import { LANGUAGE_CATALOGUE } from '@saarthi/shared';
import { motion, useReducedMotion } from '@/components/motion';
import { Section } from './marketing-chrome';
import { Reveal } from './motion-extras';
import { Backdrop, MARKETING_IMAGE, STAGE } from './imagery';
import { cn } from '@/lib/utils';

/**
 * The name, written out in every language the product speaks.
 *
 * The page's one moment of pure assertion. It sits immediately after the
 * capability explorer on purpose: that section asks the reader to scan
 * forty-eight rows, and whatever follows it has to be something the eye can
 * rest on.
 *
 * The lockup is filled with the logo's own sweep rather than the `--primary`
 * token — see `.brand-logo-gradient`, sampled from the navy of the V and the
 * saffron of the X in `vorldx-mark.png`.
 *
 * Underneath, "Saarthi" writes itself in each of the 23 scripts in turn. The
 * word is not a phonetic invention in most of them: सारथि is Sanskrit for the
 * one who drives the chariot, and it is a real loanword in nearly every
 * catalogue below. Writing the name in the reader's own script is a stronger
 * claim about a multilingual product than a sentence saying it supports 23
 * languages, and it is the same claim the app makes on its first screen.
 */

const BRAND = 'VorldX Saarthi';

/**
 * "Saarthi", in the script of each locale the product offers.
 *
 * Keyed by locale code so it is checked against `LANGUAGE_CATALOGUE` rather
 * than sitting alongside it in a parallel array that silently falls out of
 * order. `marketing.test.tsx` asserts every catalogue entry is covered, which
 * is what turns adding a 24th language into a failing test rather than a
 * silent gap.
 *
 * Kept here and not in `packages/shared`: this is brand copy, and the shared
 * language catalogue is product data that the API and both mobile apps also
 * read. A rendering of a trade name does not belong in it.
 *
 * The Devanagari, Bengali-Assamese, Gujarati, Gurmukhi, Kannada, Malayalam,
 * Odia, Tamil, Telugu and Urdu forms are standard. The Meitei Mayek, Ol Chiki,
 * Kashmiri and Sindhi forms are transliterations that a native reader should
 * confirm before this goes in front of customers — see the note in
 * docs/MARKETING_VISUAL_DIRECTION.md.
 */
export const SAARTHI_IN_SCRIPT: Record<string, string> = {
  'en-IN': 'Saarthi',
  'as-IN': 'সাৰথি',
  'bn-IN': 'সারথি',
  'brx-IN': 'सारथी',
  'doi-IN': 'सारथी',
  'gu-IN': 'સારથિ',
  'hi-IN': 'सारथी',
  'kn-IN': 'ಸಾರಥಿ',
  'ks-IN': 'سارتھی',
  'kok-IN': 'सारथी',
  'mai-IN': 'सारथी',
  'ml-IN': 'സാരഥി',
  'mni-IN': 'ꯁꯥꯔꯊꯤ',
  'mr-IN': 'सारथी',
  'ne-IN': 'सारथी',
  'or-IN': 'ସାରଥି',
  'pa-IN': 'ਸਾਰਥੀ',
  'sa-IN': 'सारथि',
  'sat-IN': 'ᱥᱟᱨᱛᱷᱤ',
  'sd-IN': 'سارٿي',
  'ta-IN': 'சாரதி',
  'te-IN': 'సారథి',
  'ur-IN': 'سارتھی',
};

/**
 * What the animation walks.
 *
 * Derived from the catalogue rather than from the map above, so the order is
 * the product's order and a language with no rendering yet falls back to the
 * Latin spelling instead of dropping out of the rotation.
 */
const ROTATION = LANGUAGE_CATALOGUE.map((language) => ({
  code: language.code,
  direction: language.direction,
  english: language.english,
  text: SAARTHI_IN_SCRIPT[language.code] ?? 'Saarthi',
}));

const TYPE_MS = 105;
const ERASE_MS = 45;
const HOLD_MS = 1600;

/**
 * Split for writing, by grapheme cluster rather than by character.
 *
 * This is the whole reason the animation is not two lines of `slice()`. In
 * Devanagari, `सारथी` is five code points but three things a reader would call
 * letters — slicing between a consonant and its matra renders a detached vowel
 * sign and a dotted circle, and Tamil, Bengali, Odia and Ol Chiki all break the
 * same way. `Intl.Segmenter` knows where the real boundaries are.
 *
 * The fallback splits by code point, which is still correct for the Latin
 * entry and merely imperfect for the others — every browser this app supports
 * has had `Segmenter` since 2022, so it is a floor, not a path anyone travels.
 */
function splitGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (entry) => entry.segment);
  }
  return Array.from(text);
}

type Phase = 'typing' | 'holding' | 'erasing';

/**
 * The name, writing and rewriting itself.
 *
 * Decorative, and marked so: a screen reader following this letter by letter
 * would hear a stream of partial words in scripts it may have no voice for.
 * The equivalent claim is carried by a visually hidden line and by the prose
 * below the band.
 */
function NameTypewriter() {
  const reduced = useReducedMotion();
  const [index, setIndex] = React.useState(0);
  const [shown, setShown] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>('typing');

  const entry = ROTATION[index] ?? ROTATION[0]!;
  const glyphs = React.useMemo(() => splitGraphemes(entry.text), [entry.text]);

  React.useEffect(() => {
    // Reduced motion gets the Latin spelling, held. Cycling the text without
    // the writing would still be movement nobody asked for.
    if (reduced) return undefined;

    const advance = (): void => {
      if (phase === 'typing') {
        if (shown < glyphs.length) setShown(shown + 1);
        else setPhase('holding');
        return;
      }
      if (phase === 'holding') {
        setPhase('erasing');
        return;
      }
      if (shown > 0) {
        setShown(shown - 1);
        return;
      }
      setIndex((current) => (current + 1) % ROTATION.length);
      setPhase('typing');
    };

    const delay = phase === 'holding' ? HOLD_MS : phase === 'typing' ? TYPE_MS : ERASE_MS;
    const timer = window.setTimeout(advance, delay);
    return () => window.clearTimeout(timer);
  }, [phase, shown, glyphs.length, reduced]);

  const text = reduced ? entry.text : glyphs.slice(0, shown).join('');

  return (
    <div className="mt-10">
      <p className="sr-only">
        Saarthi, written in each of the {ROTATION.length} languages the platform speaks.
      </p>

      {/*
       * Both rows are fixed in height. The scripts differ by a long way in
       * ascender and descender depth — Devanagari hangs from a headline,
       * Malayalam sits deep, Urdu trails below the line — and letting the box
       * follow the glyphs makes everything under it shuffle every two seconds.
       */}
      <div className="flex h-24 items-center justify-center sm:h-28" aria-hidden>
        <p
          lang={entry.code}
          dir={entry.direction}
          className="font-multilingual text-4xl font-medium tracking-tight text-white sm:text-5xl lg:text-6xl"
        >
          {text}
          <motion.span
            className="ml-1.5 inline-block h-[1.05em] w-[3px] translate-y-[0.12em] rounded-full bg-accent align-middle"
            animate={reduced ? undefined : { opacity: [1, 1, 0, 0] }}
            transition={{ duration: 1.05, times: [0, 0.5, 0.5, 1], repeat: Infinity }}
          />
        </p>
      </div>

      <p
        className="h-5 text-2xs font-semibold uppercase tracking-[0.16em] text-white/50"
        aria-hidden
      >
        {entry.english}
      </p>
    </div>
  );
}

export function KnockoutBand() {
  const reduced = useReducedMotion();

  return (
    <Section
      width="wide"
      stage
      className={cn('relative isolate overflow-hidden py-24 sm:py-28', STAGE)}
    >
      {/*
       * A night yard of mixed vehicles, behind the name.
       *
       * The band's copy is centred, so there is no safe side to hide behind
       * and the `full` scrim is a vignette rather than a one-sided wash.
       * Making this a fixed dark stage also breaks the long token-driven
       * stretch between the hero and the safety band — five bands that were
       * all the same ground.
       */}
      <Backdrop src={MARKETING_IMAGE.brandYard} scrim="full" objectPosition="center 58%" />

      <div className="relative text-center">
        <Reveal direction="none" duration={0.5}>
          <p className="flex items-center justify-center gap-2.5 text-2xs font-semibold uppercase tracking-[0.16em] text-accent">
            <span className="h-px w-6 bg-accent/50" aria-hidden />
            Built for the roads you actually run
          </p>
        </Reveal>

        {/*
         * Sized in viewport width rather than on the type scale: one lockup
         * that has to span the band at every width, where a fixed ramp would
         * leave a gutter on a wide screen and wrap on a narrow one. The upper
         * bound keeps fourteen glyphs inside `max-w-7xl`; the vw figure keeps
         * them clear of the gutters on a 360px phone.
         *
         * `text-balance` rather than `whitespace-nowrap`: if a viewport does
         * defeat the clamp, two balanced lines is a better failure than a
         * lockup running off the side of the page.
         */}
        <motion.h2
          className="brand-logo-gradient-on-dark mt-4 text-balance select-none font-semibold leading-[0.85] tracking-[-0.04em]"
          style={{ fontSize: 'clamp(2.25rem, 11vw, 9.5rem)' }}
          initial={reduced ? false : { opacity: 0, scale: 0.97 }}
          whileInView={reduced ? undefined : { opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          {BRAND}
        </motion.h2>

        <NameTypewriter />

        <Reveal delay={0.15}>
          <p className="mx-auto mt-8 max-w-2xl text-pretty text-base leading-relaxed text-white/70 sm:text-lg">
            A saarthi is the one who drives, and the one who guides. The platform is built the same
            way - it moves the load, and it tells everyone who is waiting on it where the load is.
            In {LANGUAGE_CATALOGUE.length} languages, on the phone the driver already owns.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
