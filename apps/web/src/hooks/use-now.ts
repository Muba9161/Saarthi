import * as React from 'react';

/**
 * The current time, re-read on an interval.
 *
 * For text that has to age while nothing else on the page changes — "updated
 * 20 s ago" must become "21 s ago" without waiting for the next fetch. Keep the
 * component that calls this small: everything it renders repaints each tick.
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);

  return now;
}
