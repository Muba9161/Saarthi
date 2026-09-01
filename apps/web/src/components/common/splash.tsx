import * as React from 'react';
import { languageByCode } from '@saarthi/shared';
import { motion } from '@/components/motion';
// The module rather than the feature barrel: the barrel re-exports the locale
// splash, which imports this file, and going through it would be a cycle.
import { useLocale } from '@/features/i18n/locale-context';
import { cn } from '@/lib/utils';
import { SaarthiLockup } from './logo';

/**
 * Full-screen brand splash.
 *
 * One surface, two occasions: waiting for the session to resolve, and
 * confirming a language switch. They used to look different, which meant a
 * user who changed language on the sign-in screen saw two unrelated
 * interstitials in a row.
 *
 * The hero is a greeting in the user's own language rather than a status
 * line — on the boot path it is the first thing the product says, and saying
 * it in Malayalam to a Malayalam speaker is worth more than "Loading".
 *
 * The loading indicator is a road with a dash travelling down it, because the
 * logo has one running through the V. A generic spinner would have done the
 * job, but this is the one screen every user sees on every visit, and it costs
 * nothing to make it belong to this product rather than any product.
 *
 * Kept deliberately in step with the boot splash inlined in `index.html`,
 * which runs before this bundle exists. If you retune one, retune both.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

export interface SplashSurfaceProps {
  /** Large, in the language's own script. */
  greeting: string;
  /** BCP-47 tag for the greeting, so it is spoken and shaped correctly. */
  greetingLang: string;
  greetingDir: 'ltr' | 'rtl';
  /** The quiet line beneath the greeting. */
  caption?: React.ReactNode;
  /**
   * Fill the bar once over this many milliseconds instead of looping. Used
   * where the wait has a known end; omitted while waiting on the network.
   */
  fillMs?: number;
  className?: string;
}

/**
 * The shared visual. Holds no opinion about *why* it is on screen, which is
 * what lets the boot path and the language switch share it.
 */
export function SplashSurface({
  greeting,
  greetingLang,
  greetingDir,
  caption,
  fillMs,
  className,
}: SplashSurfaceProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 overflow-hidden',
        'bg-[radial-gradient(120%_90%_at_50%_18%,hsl(var(--card))_0%,hsl(var(--background))_62%)]',
        className,
      )}
    >
      {/* Ambient wash in the brand's saffron and green, drifting slowly. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-1/3 opacity-70 motion-safe:animate-[splash-drift_14s_ease-in-out_infinite_alternate]"
        style={{
          background:
            'radial-gradient(38% 30% at 22% 30%, rgba(254,93,9,.16), transparent 70%),' +
            'radial-gradient(40% 32% at 78% 68%, rgba(2,120,63,.16), transparent 70%)',
        }}
      />

      <SaarthiLockup className="relative w-[min(190px,42vw)] opacity-90 motion-safe:animate-[splash-rise_900ms_cubic-bezier(.16,1,.3,1)_both]" />

      <div className="relative flex flex-col items-center gap-3 px-6 text-center">
        <motion.p
          lang={greetingLang}
          dir={greetingDir}
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.46, ease: EASE, delay: 0.08 }}
          className="gradient-text text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
        >
          {greeting}
        </motion.p>

        {caption ? (
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.46, ease: EASE, delay: 0.2 }}
            className="text-sm text-muted-foreground"
          >
            {caption}
          </motion.p>
        ) : null}
      </div>

      <div
        aria-hidden
        className="relative h-1 w-[min(220px,48vw)] overflow-hidden rounded-full bg-primary/10"
      >
        {fillMs === undefined ? (
          // No known end: the dash travels the road until the wait is over.
          <div className="absolute inset-y-0 left-0 w-[42%] rounded-full bg-[linear-gradient(90deg,#fe5d09,#011c45_52%,#02783f)] motion-safe:animate-[splash-travel_1500ms_cubic-bezier(.65,0,.35,1)_infinite] motion-reduce:w-full" />
        ) : (
          <motion.div
            className="h-full rounded-full bg-[linear-gradient(90deg,#fe5d09,#011c45_52%,#02783f)]"
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: fillMs / 1000, ease: 'linear' }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Shown while the session resolves — the moment after the bundle has loaded
 * but before the app knows who is signed in. The boot splash in `index.html`
 * covers the gap before that; this takes over so the two read as one
 * continuous screen rather than a flash of brand, a flash of blank, then the
 * app.
 */
export function SplashScreen({ label, className }: { label?: string; className?: string }) {
  const { locale, t } = useLocale();
  const language = languageByCode(locale);

  return (
    <div role="status" aria-live="polite" aria-label={label ?? t('Getting your fleet ready')}>
      <SplashSurface
        greeting={language.greeting}
        greetingLang={language.code}
        greetingDir={language.direction}
        caption={label ?? t('Getting your fleet ready')}
        {...(className ? { className } : {})}
      />
    </div>
  );
}
