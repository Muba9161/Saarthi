import { LANGUAGE_CATALOGUE } from '@saarthi/shared';
import { motion, useReducedMotion } from '@/components/motion';
import { Section } from './marketing-chrome';
import { Reveal } from './motion-extras';
import { Backdrop, MARKETING_IMAGE, STAGE } from './imagery';
import { BrushName } from './brush-name/brush-name';
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
 * Underneath, "Saarthi" is written with a brush in each offered language in
 * turn — see `brush-name/`. The word is not a phonetic invention in most of
 * them: सारथि is Sanskrit for the one who drives the chariot, and it is a real
 * loanword in nearly every catalogue below. Writing the name in the reader's
 * own script is a stronger claim about a multilingual product than a sentence
 * counting the languages it supports, and it is the same claim the app makes on
 * its first screen.
 */

const BRAND = 'VorldX Saarthi';

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

        <BrushName />

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
