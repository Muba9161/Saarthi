import * as React from 'react';
import { useReducedMotion } from 'framer-motion';

/** Milliseconds between reveals. */
const TICK_MS = 28;
/** A long answer still finishes within about this long. */
const MAX_DURATION_MS = 2600;

/**
 * Reveal text word by word, the way a person types a reply.
 *
 * Presentation only — the whole answer has already arrived. Long answers speed
 * up so none takes more than a few seconds, `skip` shows everything at once,
 * and reduced motion (or `enabled: false`) shows it immediately.
 */
export function useTypewriter(
  text: string,
  enabled: boolean,
): { shown: string; done: boolean; skip: () => void } {
  const reduced = useReducedMotion() ?? false;
  const animate = enabled && !reduced;
  const tokens = React.useMemo(() => text.split(/(\s+)/), [text]);
  const [count, setCount] = React.useState(animate ? 0 : tokens.length);

  React.useEffect(() => {
    if (!animate) {
      setCount(tokens.length);
      return;
    }
    setCount(0);
    const perTick = Math.max(1, Math.ceil(tokens.length / (MAX_DURATION_MS / TICK_MS)));
    const timer = window.setInterval(() => {
      setCount((current) => {
        const next = Math.min(tokens.length, current + perTick);
        if (next >= tokens.length) window.clearInterval(timer);
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [animate, tokens]);

  const skip = React.useCallback(() => setCount(tokens.length), [tokens.length]);

  return {
    shown: count >= tokens.length ? text : tokens.slice(0, count).join(''),
    done: count >= tokens.length,
    skip,
  };
}
