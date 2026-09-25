import * as React from 'react';
import type { InkArt } from '@/components/ink/ink-art.types';

type GreetingInk = Readonly<Record<string, InkArt>>;

/**
 * The greeting outlines the language splash writes with a brush.
 *
 * Tens of kilobytes of path data for a moment most sessions never reach, so it
 * is not in the app bundle. It is fetched once the app has gone idle — long
 * before anyone opens the language picker — and the splash never waits on it:
 * if a switch happens first, that splash shows the greeting as text, exactly
 * as it did before the brush existed.
 */

let loaded: GreetingInk | null = null;
let pending: Promise<GreetingInk | null> | null = null;

/**
 * One request, shared by every caller. A failed chunk resolves to `null` and
 * clears itself, so a later mount can try again rather than inheriting the
 * failure for the rest of the session.
 */
function loadGreetingInk(): Promise<GreetingInk | null> {
  pending ??= import('./greeting-ink.generated').then(
    (module) => (loaded = module.GREETING_INK),
    () => {
      pending = null;
      return null;
    },
  );
  return pending;
}

/** How long to wait for an idle moment before fetching anyway. */
const IDLE_TIMEOUT_MS = 4000;

/** The outlines once they have arrived, and `null` until then. Never blocks. */
export function useGreetingInk(): GreetingInk | null {
  const [ink, setInk] = React.useState<GreetingInk | null>(loaded);

  React.useEffect(() => {
    if (ink) return undefined;
    let cancelled = false;

    const start = (): void => {
      void loadGreetingInk().then((result) => {
        if (!cancelled && result) setInk(result);
      });
    };

    // Safari has no `requestIdleCallback`; a timeout is the same promise made
    // less precisely.
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
      };
    }
    const timer = window.setTimeout(start, IDLE_TIMEOUT_MS / 2);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ink]);

  return ink;
}
