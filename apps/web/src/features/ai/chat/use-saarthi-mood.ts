import * as React from 'react';
import type { SaarthiMood } from './saarthi-avatar';

/** How long Mitra keeps a reaction before settling back. */
const REACTION_MS = 3200;
/** A little wink now and then, so an idle face still feels alive. */
const WINK_EVERY_MS = 17_000;
const WINK_MS = 700;
/** Left alone this long, Mitra gets drowsy. Any activity wakes it. */
const SLEEPY_AFTER_MS = 60_000;

/**
 * Mitra's mood, from what is happening on the page.
 *
 * Working beats talking beats reacting beats listening beats resting: while a
 * question is out it thinks, while its reply is written out it talks, then it
 * shows how that went for a moment. It waves when the chat opens, raises a
 * brow at a question being typed, winks now and then while idle, and nods off
 * if nobody has said anything for a minute.
 */
export function useSaarthiMood({
  thinking,
  speaking,
  draft,
  focused,
  activity,
}: {
  thinking: boolean;
  speaking: boolean;
  /** What is in the message box right now. */
  draft: string;
  focused: boolean;
  /** Changes whenever the conversation does, to reset the drowsiness timer. */
  activity: unknown;
}): { mood: SaarthiMood; react: (reaction: SaarthiMood) => void } {
  const [reaction, setReaction] = React.useState<SaarthiMood | null>('waving');
  const [winking, setWinking] = React.useState(false);
  const [sleepy, setSleepy] = React.useState(false);

  React.useEffect(() => {
    if (!reaction) return;
    const timer = window.setTimeout(() => setReaction(null), REACTION_MS);
    return () => window.clearTimeout(timer);
  }, [reaction]);

  const busy = thinking || speaking || reaction !== null || draft.length > 0;

  React.useEffect(() => {
    setSleepy(false);
    if (busy) return;
    const timer = window.setTimeout(() => setSleepy(true), SLEEPY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [busy, activity, focused]);

  React.useEffect(() => {
    if (busy || sleepy) return;
    let closing: number | undefined;
    const timer = window.setInterval(() => {
      setWinking(true);
      closing = window.setTimeout(() => setWinking(false), WINK_MS);
    }, WINK_EVERY_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(closing);
    };
  }, [busy, sleepy]);

  const react = React.useCallback((next: SaarthiMood) => setReaction(next), []);

  const typing = focused && draft.trim().length > 0;
  const mood: SaarthiMood = thinking
    ? 'thinking'
    : speaking
      ? 'speaking'
      : (reaction ??
        (typing
          ? draft.includes('?')
            ? 'curious'
            : 'listening'
          : sleepy
            ? 'sleepy'
            : winking
              ? 'wink'
              : 'idle'));

  return { mood, react };
}
