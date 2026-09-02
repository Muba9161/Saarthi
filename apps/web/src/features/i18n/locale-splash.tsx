import * as React from 'react';
import { createPortal } from 'react-dom';
import { languageByCode } from '@saarthi/shared';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { SplashSurface } from '@/components/common/splash';
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
 * given a different greeting and a bar that fills rather than loops. Sharing
 * the surface is the point: someone who changes language on the sign-in screen
 * would otherwise meet two unrelated interstitials back to back.
 *
 * The greeting is a real greeting, not the word "Welcome" translated. See
 * `LanguageDefinition.greeting` in the shared catalogue.
 */

/** Enter, hold, leave. Tuned so the greeting is readable, not merely glimpsed. */
const ENTER_MS = 460;
const HOLD_MS = 1500;
const EXIT_MS = 420;

const EASE = [0.16, 1, 0.3, 1] as const;

export function LocaleSplash() {
  const { locale, switchNonce } = useLocale();
  const reduced = useReducedMotion();

  const [showing, setShowing] = React.useState<string | null>(null);
  /** The only part of this a screen reader receives; the splash is decorative. */
  const [announcement, setAnnouncement] = React.useState('');

  const dismiss = React.useCallback(() => setShowing(null), []);

  React.useEffect(() => {
    // The nonce starts at zero and only a deliberate switch moves it, so this
    // never fires on first paint, and never when a session simply restores the
    // language somebody already chose.
    if (switchNonce === 0) return undefined;

    const language = languageByCode(locale);
    setAnnouncement(`${language.greeting} — ${language.english}`);

    // Reduced motion gets the announcement and nothing else: a full-screen
    // takeover is exactly the kind of movement that setting asks us to skip.
    if (reduced) return undefined;

    setShowing(locale);
    const timer = window.setTimeout(dismiss, ENTER_MS + HOLD_MS);
    return () => window.clearTimeout(timer);

    // `locale` is deliberately not a dependency: the nonce already moves with
    // it, and depending on both would replay the splash when the same language
    // is merely re-resolved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchNonce, reduced, dismiss]);

  // Any key gets you out early. A two-second takeover is short, but it is still
  // the app refusing input, and there should always be a way past it.
  React.useEffect(() => {
    if (!showing) return undefined;
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [showing, dismiss]);

  const language = showing ? languageByCode(showing) : null;

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
              fillMs={ENTER_MS + HOLD_MS}
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
