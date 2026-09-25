/**
 * The lockup as line art, ready to be drawn in before its colour floods in.
 *
 * Produced by `tools/trace-logo.mjs`. Coordinates are pixels of
 * `public/vorldx-saarthi.png`, so the drawing overlays the artwork exactly.
 */

/** Which of the brand's inks an outline belongs to; it is drawn in that colour. */
export type LogoInk = 'navy' | 'saffron' | 'green';

/** One closed outline — a single movement of the pen. */
export interface LogoStroke {
  readonly ink: LogoInk;
  /** When the pen reaches it, from 0 (first) to 1 (last). */
  readonly at: number;
  /** SVG path data, absolute and closed. */
  readonly d: string;
}

export interface LogoTrace {
  /** The PNG's width and height — the SVG viewBox. */
  readonly box: readonly [number, number];
  /** In drawing order. */
  readonly strokes: readonly LogoStroke[];
}
