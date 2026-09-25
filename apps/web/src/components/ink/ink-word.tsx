import * as React from 'react';
import { EASE as EASE_OUT, motion } from '@/components/motion';
import { cn } from '@/lib/utils';
import type { InkArt } from './ink-art.types';
import {
  INK_S,
  TRACE_FADE_S,
  reverseBeat,
  reverseEase,
  type Beat,
  type InkPlan,
} from './ink-timeline';

/**
 * A pen's pace: it gathers speed off the page and slows into the lift. The
 * page's entrance curve starts at full speed, which on a stroke reads as the
 * line being flung rather than drawn.
 */
const PEN_EASE = [0.45, 0, 0.3, 1] as const;

/*
 * Widths in thousandths of an em, the art's own units. The trace must stay
 * under the generator's PAD, or the outermost edge of a stroke is clipped by
 * the viewBox.
 */
const TRACE_WIDTH = 22;
/** A thin stroke on the ink softens the outline's hard vector edge. */
const INK_EDGE = 8;
/** Long enough to hide or reveal a stroke's cap without a visible fade. */
const BLINK_S = 0.01;

/**
 * What the ink is. `white` for a dark stage such as the marketing band.
 * `brand` is the logo's navy-to-saffron sweep, the same one
 * `.brand-logo-gradient` paints on live text; its stops are defined beside
 * that class in `globals.css` so both are retuned in one place.
 */
export type InkColour = 'white' | 'brand';

interface InkWordProps {
  art: InkArt;
  plan: InkPlan;
  /** Run the writing backwards until the paper is clean again. */
  erasing?: boolean;
  ink?: InkColour;
  /** Sizes the word: one em of type is 1000 units of art. */
  className?: string;
}

/**
 * One word, written with a brush.
 *
 * Each glyph goes down in two layers. The first is its outline, traced in the
 * accent colour one contour at a time as a pen would move. The second is the
 * ink: the same shape, filled, flooding in over the outline and swallowing it.
 * Both sit under one displacement filter, which roughens every edge the way
 * ink catches on the grain of paper — the difference between a brush and a
 * plotter.
 *
 * When `erasing` turns on, every layer animates back to where it started along
 * the mirrored timeline from `reverseBeat`, so the word leaves the way it came.
 *
 * Decorative; the caller owns `aria-hidden` and the accessible equivalent.
 */
export function InkWord({ art, plan, erasing = false, ink = 'white', className }: InkWordProps) {
  const [x, y, width, height] = art.box;
  // `useId` returns colons, which are not safe inside `url(#…)`.
  const id = React.useId().replace(/:/g, '');
  const filterId = `ink-grain-${id}`;
  const gradientId = `ink-brand-${id}`;
  const inkPaint =
    ink === 'brand'
      ? { fill: `url(#${gradientId})`, stroke: `url(#${gradientId})` }
      : { className: 'fill-white stroke-white' };

  const inkShapes = React.useMemo(
    () => art.glyphs.map((glyph) => glyph.strokes.map((stroke) => stroke.d).join('')),
    [art],
  );

  const pace = (beat: Beat, ease: readonly [number, number, number, number]) =>
    erasing ? { ...reverseBeat(plan, beat), ease: reverseEase(ease) } : { ...beat, ease };

  return (
    <svg
      viewBox={`${x} ${y} ${width} ${height}`}
      className={cn('block max-h-full max-w-full overflow-visible', className)}
      style={{ height: `${height / 1000}em`, aspectRatio: `${width} / ${height}` }}
    >
      <defs>
        {ink === 'brand' ? (
          // Across the word's own box, so the sweep runs from its first letter
          // to its last whatever the word's length.
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={x}
            y1={y + height / 2}
            x2={x + width}
            y2={y + height / 2}
          >
            <stop offset="0%" className="brand-ink-stop-1" />
            <stop offset="32%" className="brand-ink-stop-2" />
            <stop offset="72%" className="brand-ink-stop-3" />
            <stop offset="100%" className="brand-ink-stop-4" />
          </linearGradient>
        ) : null}
        {/*
         * Frequency and scale are in art units. At a 60px em the grain has a
         * period of about 5px and moves an edge by under 2px — enough to read
         * as ink, not enough to cost legibility.
         */}
        <filter
          id={filterId}
          filterUnits="userSpaceOnUse"
          x={x}
          y={y}
          width={width}
          height={height}
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012"
            numOctaves={2}
            seed={7}
            result="grain"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="grain"
            scale={28}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>

      <g filter={`url(#${filterId})`}>
        {art.glyphs.map((glyph, glyphIndex) => {
          const timing = plan.glyphs[glyphIndex];
          if (!timing) return null;

          return (
            <g key={glyphIndex}>
              <motion.g
                className="stroke-accent"
                fill="none"
                strokeWidth={TRACE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ opacity: 1 }}
                animate={{ opacity: erasing ? 1 : 0 }}
                transition={pace({ delay: timing.fadeDelay, duration: TRACE_FADE_S }, EASE_OUT)}
              >
                {glyph.strokes.map((stroke, strokeIndex) => {
                  const beat = timing.strokes[strokeIndex];
                  if (!beat) return null;
                  return (
                    <motion.path
                      key={strokeIndex}
                      d={stroke.d}
                      // Hidden until its turn: a zero-length path with round
                      // caps still paints a dot where the pen will land.
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={
                        erasing ? { pathLength: 0, opacity: 0 } : { pathLength: 1, opacity: 1 }
                      }
                      transition={{
                        pathLength: pace(beat, PEN_EASE),
                        opacity: pace({ delay: beat.delay, duration: BLINK_S }, EASE_OUT),
                      }}
                    />
                  );
                })}
              </motion.g>

              <motion.path
                d={inkShapes[glyphIndex]}
                {...inkPaint}
                strokeWidth={INK_EDGE}
                strokeLinejoin="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: erasing ? 0 : 1 }}
                transition={pace({ delay: timing.inkDelay, duration: INK_S }, EASE_OUT)}
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
