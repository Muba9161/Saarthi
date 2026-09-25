import type { InkArt } from './ink-art.types';

/**
 * When each movement of the brush happens, in seconds from the start of a word.
 *
 * Pure, so the pacing can be reasoned about and tested without a renderer.
 *
 * The pen travels at one speed across the whole word — each contour takes time
 * in proportion to its length — so a long bowl is drawn slowly and a nukta is
 * a flick. Speed is set per word from a fixed writing time rather than as a
 * global constant: Malayalam's long word and Gujarati's short one both take
 * about as long, which keeps the rotation's rhythm even across every language.
 *
 * Un-writing is not a second choreography. Every movement is mirrored about
 * the moment the word finished and replayed a little faster, so the ink drains
 * from the last glyph first, the outline returns, and the pen lifts back along
 * the path it came in on.
 */

/** Time the pen spends travelling, per word. */
const TRACE_S = 1.8;
/** Each stroke starts before the last has lifted, the way a hand moves on. */
const OVERLAP = 0.2;
/** Dots and marks still read as a deliberate touch, not a blink. */
const MIN_STROKE_S = 0.16;
/** How long ink takes to flood a glyph once its outline is down. */
export const INK_S = 0.6;
/** Ink begins this long before the glyph's last stroke finishes. */
const INK_LEAD_S = 0.25;
/** The traced outline dissolves into the ink over this long. */
export const TRACE_FADE_S = 0.5;
/** Un-writing takes this fraction of the time the writing did. */
const ERASE_RATE = 0.6;

/** One movement: when it starts and how long it takes, in seconds. */
export interface Beat {
  readonly delay: number;
  readonly duration: number;
}

type Ease = readonly [number, number, number, number];

export interface GlyphPlan {
  readonly strokes: readonly Beat[];
  /** When this glyph starts filling with ink. */
  readonly inkDelay: number;
  /** When its traced outline starts to fade under the ink. */
  readonly fadeDelay: number;
}

export interface InkPlan {
  readonly glyphs: readonly GlyphPlan[];
  /** When the last of the ink has settled — the word is fully written. */
  readonly written: number;
}

export interface PlanOptions {
  /**
   * Seconds the pen spends travelling. Defaults to the marketing band's
   * unhurried pace; a screen with a deadline, such as the language splash,
   * writes faster.
   */
  traceS?: number;
}

export function planInk(art: InkArt, { traceS = TRACE_S }: PlanOptions = {}): InkPlan {
  const distance = art.glyphs.reduce(
    (sum, glyph) => sum + glyph.strokes.reduce((inner, stroke) => inner + stroke.len, 0),
    0,
  );
  const secondsPerUnit = distance > 0 ? traceS / distance : 0;

  let pen = 0;
  let written = 0;

  const glyphs = art.glyphs.map((glyph) => {
    let glyphEnd = pen;
    const strokes = glyph.strokes.map((stroke) => {
      const duration = Math.max(stroke.len * secondsPerUnit, MIN_STROKE_S);
      const delay = pen;
      pen += duration * (1 - OVERLAP);
      glyphEnd = Math.max(glyphEnd, delay + duration);
      return { delay, duration };
    });

    const inkDelay = Math.max(glyphEnd - INK_LEAD_S, 0);
    const fadeDelay = inkDelay + INK_S / 2;
    written = Math.max(written, inkDelay + INK_S, fadeDelay + TRACE_FADE_S);
    return { strokes, inkDelay, fadeDelay };
  });

  return { glyphs, written };
}

/** How long a written word takes to un-write itself. */
export function erasedIn(plan: InkPlan): number {
  return plan.written * ERASE_RATE;
}

/**
 * Where a movement from the writing falls when the word is un-written: the
 * last thing to happen becomes the first, and everything runs at the erase
 * rate.
 */
export function reverseBeat(plan: InkPlan, beat: Beat): Beat {
  return {
    delay: Math.max(plan.written - beat.delay - beat.duration, 0) * ERASE_RATE,
    duration: beat.duration * ERASE_RATE,
  };
}

/**
 * The curve that plays a cubic-bezier backwards in time. Without it a stroke
 * would retract with the pen's easing rather than its mirror, and the rewind
 * would not look like the same movement.
 */
export function reverseEase([x1, y1, x2, y2]: Ease): Ease {
  return [1 - x2, 1 - y2, 1 - x1, 1 - y1];
}
