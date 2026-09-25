import * as React from 'react';
import { createPortal } from 'react-dom';
import { languageByCode } from '@saarthi/shared';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { SplashSurface } from '@/components/common/splash';
import type { InkArt } from '@/components/ink/ink-art.types';
import { erasedIn, planInk } from '@/components/ink/ink-timeline';
import { useGreetingInk } from './greeting-ink';
import { useLocale } from './locale-context';

/**
 * The screen that greets you in the language you just chose.
 *
 * Switching language changes every string at once. Doing that under the user's
 * cursor reads as a glitch; doing it behind a splash that says "नमस्ते" reads
 * as the product acknowledging them. It is also the one moment in the app
 * where a flourish is unambiguously worth the time it costs — a deliberate,
 * infrequent choice, not something on the path to getting work done.
 *
 * It *is* the boot splash — `SplashSurface` from `components/common/splash` —
 * given a greeting and a logo that draws in once rather than looping. Sharing
 * the surface is the point: someone who changes language on the sign-in screen
 * would otherwise meet two unrelated interstitials back to back.
 *
 * The greeting is a real greeting, not the word "Welcome" translated. See
 * `LanguageDefinition.greeting` in the shared catalogue.
 *
 * It is written in with the same brush as the name on the marketing site
 * (`components/ink`), held, and then un-written back along its strokes before
 * the splash lifts. If the outlines have not loaded yet, the greeting is set as
 * text on the original timing instead.
 */

/** Enter, hold, leave, for a greeting set as text. */
const ENTER_MS = 460;
const HOLD_MS = 1500;
const EXIT_MS = 420;

/**
 * The brushed greeting writes faster than the marketing band: this is a
 * takeover the user is waiting through, not a band they are resting on.
 */
const INK_TRACE_S = 1;
/** How long the finished greeting is left to be read before it un-writes. */
const INK_HOLD_MS = 900;

const EASE = [0.16, 1, 0.3, 1] as const;

interface Showing {
  code: string;
  /**
   * Decided when the splash opens and kept for its whole run, so outlines
   * that arrive mid-splash never swap text for a drawing under the reader.
   */
  art: InkArt | undefined;
}

export function LocaleSplash() {
  const { locale, switchNonce } = useLocale();
  const reduced = useReducedMotion();
  const greetingInk = useGreetingInk();

  const [showing, setShowing] = React.useState<Showing | null>(null);
  const [erasing, setErasing] = React.useState(false);
  /** The only part of this a screen reader receives; the splash is decorative. */
  const [announcement, setAnnouncement] = React.useState('');

  const dismiss = React.useCallback(() => setShowing(null), []);

  React.useEffect(() => {
    // The nonce starts at zero and only a deliberate switch moves it, so this
    // never fires on first paint, and never when a session simply restores the
    // language somebody already chose.
    if (switchNonce === 0) return;

    const language = languageByCode(locale);
    setAnnouncement(`${language.greeting} - ${language.english}`);

    // Reduced motion gets the announcement and nothing else: a full-screen
    // takeover is exactly the kind of movement that setting asks us to skip.
    if (reduced) return;

    setErasing(false);
    setShowing({ code: locale, art: greetingInk?.[language.greeting] });

    // `locale` is deliberately not a dependency: the nonce already moves with
    // it, and depending on both would replay the splash when the same language
    // is merely re-resolved. `greetingInk` is read, not watched, for the same
    // reason — its arrival is not a language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchNonce, reduced]);

  const plan = React.useMemo(
    () => (showing?.art ? planInk(showing.art, { traceS: INK_TRACE_S }) : null),
    [showing],
  );

  // Text: enter, hold, leave. Ink: write, hold, un-write, then leave.
  const visibleMs = plan
    ? plan.written * 1000 + INK_HOLD_MS + erasedIn(plan) * 1000
    : ENTER_MS + HOLD_MS;

  React.useEffect(() => {
    if (!showing) return undefined;

    const [wait, step] = !plan
      ? [ENTER_MS + HOLD_MS, dismiss]
      : erasing
        ? [erasedIn(plan) * 1000, dismiss]
        : [plan.written * 1000 + INK_HOLD_MS, () => setErasing(true)];

    const timer = window.setTimeout(step, wait);
    return () => window.clearTimeout(timer);
  }, [showing, plan, erasing, dismiss]);

  // Any key gets you out early. A two-second takeover is short, but it is still
  // the app refusing input, and there should always be a way past it.
  React.useEffect(() => {
    if (!showing) return undefined;
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [showing, dismiss]);

  const language = showing ? languageByCode(showing.code) : null;

  const overlay = (
    <>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

      <AnimatePresence>
        {language ? (
          <motion.div
            key={language.code}
            // Not `pointer-events-none`: the app underneath is hidden, and a
            // click landing on a control nobody can see would be worse than a
            // click that dismisses this.
            onClick={dismiss}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: EXIT_MS / 1000, ease: EASE }}
            className="fixed inset-0 z-[100]"
            aria-hidden
          >
            <SplashSurface
              greeting={language.greeting}
              greetingLang={language.code}
              greetingDir={language.direction}
              {...(showing?.art && plan
                ? { greetingInk: { art: showing.art, plan, erasing } }
                : {})}
              fillMs={visibleMs}
              caption={
                <>
                  <span lang={language.code} dir={language.direction} className="font-medium">
                    {language.endonym}
                  </span>
                  {language.endonym === language.english ? null : (
                    <span dir="ltr"> · {language.english}</span>
                  )}
                </>
              }
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(overlay, document.body);
}
