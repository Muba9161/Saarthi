/**
 * The shape of one word, ready to be written with a brush.
 *
 * Produced by `tools/generate-ink-art.mjs`. Coordinates are thousandths of
 * an em, so a word drawn at `1em` per 1000 units sits at the same size as the
 * surrounding type would have set it.
 */

/** One closed contour of a glyph — a single movement of the brush. */
export interface InkStroke {
  /** SVG path data, absolute and closed. */
  readonly d: string;
  /** Approximate length in the same units, used to pace the stroke. */
  readonly len: number;
}

/** One shaped glyph. Its contours together are the shape that fills with ink. */
export interface InkGlyph {
  readonly strokes: readonly InkStroke[];
}

export interface InkArt {
  /** SVG viewBox: x, y, width, height. */
  readonly box: readonly [number, number, number, number];
  /** Glyphs in writing order — right to left for the Arabic-script entries. */
  readonly glyphs: readonly InkGlyph[];
}
