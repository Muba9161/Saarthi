import * as React from 'react';

/**
 * A code-split page that can be fetched before anyone navigates to it.
 *
 * `React.lazy` alone suspends on the first render even when the chunk is
 * already in the browser's cache, so a page fetched ahead of time would still
 * flash its loading fallback. This renders the loaded component directly once
 * `preload` has finished, and only falls back to the lazy path — and its
 * Suspense boundary — when it has not.
 */
export interface PreloadableComponent {
  (): React.ReactElement;
  /** Start fetching the page's code. Safe to call any number of times. */
  preload: () => void;
}

export function lazyWithPreload(
  load: () => Promise<{ default: React.ComponentType }>,
): PreloadableComponent {
  let loaded: React.ComponentType | undefined;
  let pending: Promise<{ default: React.ComponentType }> | undefined;

  const fetchPage = () =>
    (pending ??= load().then(
      (module) => {
        loaded = module.default;
        return module;
      },
      (error: unknown) => {
        // Forget a failed fetch, so the next attempt retries rather than
        // replaying the same rejection.
        pending = undefined;
        throw error;
      },
    ));

  const Lazy = React.lazy(fetchPage);

  function Preloadable() {
    const Loaded = loaded;
    return Loaded ? <Loaded /> : <Lazy />;
  }

  return Object.assign(Preloadable, {
    preload: () => {
      // A failed preload is not an error yet; navigating there will retry and
      // surface it through the route's error boundary.
      fetchPage().catch(() => undefined);
    },
  });
}

/** Long enough to stay out of the way of the current page's own first work. */
const IDLE_TIMEOUT_MS = 2000;

/**
 * Preload pages the visitor is likely to go to next, once the browser is idle
 * — so the current page's own loading is never competing with them.
 *
 * Pass a module-level array: it is the effect's dependency, so a fresh array
 * each render would restart the wait every time.
 */
export function usePreloadWhenIdle(pages: readonly PreloadableComponent[]): void {
  React.useEffect(() => {
    const start = () => pages.forEach((page) => page.preload());

    // Safari has no `requestIdleCallback`; a timeout is the same promise made
    // less precisely.
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(start, IDLE_TIMEOUT_MS / 2);
    return () => window.clearTimeout(timer);
  }, [pages]);
}
