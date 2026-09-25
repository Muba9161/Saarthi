import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { SaarthiAvatar } from './saarthi-avatar';

/** What Saarthi says while it works. General on purpose: it does not know yet which records it will read. */
const PHRASES = [
  'Thinking…',
  'Going through your records…',
  'Putting it together…',
  'Almost there…',
];
const PHRASE_MS = 1800;

/** Saarthi at work: its thinking face, bouncing dots, and a line that changes as the wait goes on. */
export function ThinkingBubble() {
  const reduced = useReducedMotion() ?? false;
  const [phrase, setPhrase] = React.useState(0);

  React.useEffect(() => {
    const timer = window.setInterval(
      () => setPhrase((current) => Math.min(current + 1, PHRASES.length - 1)),
      PHRASE_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <motion.div
      role="status"
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="flex items-end gap-2.5"
    >
      <SaarthiAvatar size="sm" mood="thinking" />
      <div className="flex items-center gap-3 rounded-2xl rounded-bl-md border border-border bg-muted/60 px-4 py-3">
        <span className="flex gap-1" aria-hidden>
          {[0, 1, 2].map((dot) => (
            <motion.span
              key={dot}
              className="size-1.5 rounded-full bg-primary"
              animate={reduced ? undefined : { y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: dot * 0.15, ease: 'easeInOut' }}
            />
          ))}
        </span>
        <AnimatePresence mode="wait">
          <motion.span
            key={phrase}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="text-xs text-muted-foreground"
          >
            {PHRASES[phrase]}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
