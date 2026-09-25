import * as React from 'react';
import { motion } from '@/components/motion';
import type { InkArt } from '@/components/ink/ink-art.types';
import type { InkPlan } from '@/components/ink/ink-timeline';
import { InkWord } from '@/components/ink/ink-word';
// The module rather than the feature barrel: the barrel re-exports the locale
// splash, which imports this file, and going through it would be a cycle.
import { useLocale } from '@/features/i18n/locale-context';
import { cn } from '@/lib/utils';
import { holdBootSplash, isBootSplashShowing } from './boot-splash';
import { SplashLogo } from './splash-logo/splash-logo';

/**
 * Full-screen brand splash.
 *
 * There is exactly one per occasion. At boot it is the splash inlined in
 * `index.html`, held up until the session resolves (see `SplashScreen`), so a
 * visitor sees one screen from first byte to first page — not a boot screen
 * handing over to a second, different one. On a language switch it is
 * `SplashSurface` with a greeting in the language just chosen.
 *
 * There is no separate loading indicator: the logo is the loader, drawn in by
 * hand and flooded with colour (`SplashLogo`). A generic spinner would have
 * done the job, but this is the one screen every user sees on every visit,
 * and it costs nothing to make it belong to this product rather than any
 * product.
 *
 * Kept deliberately in step with the boot splash in `index.html`, which runs
 * before this bundle exists. If you retune one, retune both.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

export interface SplashSurfaceProps {
  /** Large, in the language's own script. Omitted, the logo stands alone. */
  greeting?: string;
  /** BCP-47 tag for the greeting, so it is spoken and shaped correctly. */
  greetingLang?: string;
  greetingDir?: 'ltr' | 'rtl';
  /**
   * The greeting as brush outlines, written in rather than faded in. Without
   * it the greeting is set as text — which is also what happens if the
   * outlines have not arrived yet.
   */
  greetingInk?: { art: InkArt; plan: InkPlan; erasing: boolean };
  /** The quiet line beneath the logo. */
  caption?: React.ReactNode;
  /**
   * Draw the logo once over this many milliseconds instead of looping. Used
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
  greetingInk,
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

      <SplashLogo
        drawInMs={fillMs}
        className={cn(
          'motion-safe:animate-[splash-rise_900ms_cubic-bezier(.16,1,.3,1)_both]',
          greeting ? 'w-[min(190px,42vw)]' : 'w-[min(268px,58vw)]',
        )}
      />

      {greeting || caption ? (
        <div className="relative flex flex-col items-center gap-3 px-6 text-center">
          {greeting && greetingInk ? (
            // The type classes size the ink, which is drawn in ems. The text
            // stays in the document for anything that reads it; the drawing
            // is only a picture of it.
            <p lang={greetingLang} dir={greetingDir} className="text-4xl sm:text-5xl">
              <span className="sr-only">{greeting}</span>
              <InkWord
                art={greetingInk.art}
                plan={greetingInk.plan}
                erasing={greetingInk.erasing}
                ink="brand"
              />
            </p>
          ) : greeting ? (
            <motion.p
              lang={greetingLang}
              dir={greetingDir}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.46, ease: EASE, delay: 0.08 }}
              className="brand-logo-gradient text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
            >
              {greeting}
            </motion.p>
          ) : null}

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
      ) : null}
    </div>
  );
}

/**
 * Shown while the session resolves — the moment after the bundle has loaded
 * but before the app knows who is signed in.
 *
 * At boot the splash from `index.html` is still up, so this renders nothing
 * and simply keeps that one on screen until it unmounts: one continuous
 * splash, its drawing never restarted. Only when there is no boot splash left
 * to hold does it draw its own.
 */
export function SplashScreen({ label, className }: { label?: string; className?: string }) {
  const { t } = useLocale();
  const holdingBoot = useHoldBootSplash();

  if (holdingBoot) return null;

  const text = label ?? t('Getting your fleet ready');
  return (
    <div role="status" aria-live="polite" aria-label={text}>
      <SplashSurface caption={text} {...(className ? { className } : {})} />
    </div>
  );
}

/**
 * Keep the boot splash on screen while the caller is mounted, if it is still
 * showing, and say whether it is — in which case the caller should draw
 * nothing of its own. For anything that is a loading screen at boot: the
 * session check, or the first page's code still downloading. Without it, the
 * splash would lift onto a spinner.
 */
export function useHoldBootSplash(): boolean {
  // Decided once: a boot splash that has already lifted is not coming back.
  const [holding] = React.useState(isBootSplashShowing);

  // Layout effect, so the hold is taken in the same commit as the first
  // paint — before the boot splash's own two-frame dismissal check runs.
  React.useLayoutEffect(() => (holding ? holdBootSplash() : undefined), [holding]);

  return holding;
}
