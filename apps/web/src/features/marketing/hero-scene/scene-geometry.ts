import { BACKDROP_OVERSCAN } from '../imagery';

/**
 * Where the truck is in the hero photograph, and where that lands on screen.
 *
 * The target lock has to sit *on* the vehicle, and the vehicle's screen
 * position is not fixed: the frame is `object-fit: cover`ed into an overscanned
 * box whose shape changes with every viewport. Rather than guess per
 * breakpoint, this reproduces the browser's own cover arithmetic, so the lock
 * follows the truck at any width the layer is shown at.
 *
 * Everything here is registered to `hero-highway.webp` as shipped. Replacing
 * that file means re-measuring `HERO_SUBJECT` — the numbers are normalised to
 * the image, so a new frame with the truck elsewhere will put the brackets
 * around empty road.
 */

/** The landscape hero file: 1672 × 940, and the point the crop holds on to. */
const HERO_FRAME = {
  aspect: 1672 / 940,
  anchor: { x: 0.72, y: 0.62 },
} as const;

/** The same anchor, in the form `object-position` takes. */
export const HERO_OBJECT_POSITION = `${HERO_FRAME.anchor.x * 100}% ${HERO_FRAME.anchor.y * 100}%`;

/** The truck, normalised to the image: its body, and the rear lamp cluster. */
const HERO_SUBJECT = {
  box: { left: 0.678, top: 0.218, right: 0.972, bottom: 0.64 },
  beacon: { x: 0.82, y: 0.518 },
} as const;

export interface Point {
  x: number;
  y: number;
}

export interface SubjectLayout {
  /** The layer's own size — the band's box. */
  width: number;
  height: number;
  /** The vehicle's bounds, in px from the band's top-left. May overhang it. */
  box: { left: number; top: number; right: number; bottom: number };
  /** The point the leader line ends on. */
  beacon: Point;
}

/**
 * Projects the truck into a band of the given size.
 *
 * `null` for an empty box, which is what a `display: none` layer measures —
 * there is nothing to place, and the caller should render nothing.
 */
export function projectSubject(width: number, height: number): SubjectLayout | null {
  if (width <= 0 || height <= 0) return null;

  const frameHeight = height + BACKDROP_OVERSCAN * 2;
  // `cover`: whichever axis is short is scaled to fit, the other overhangs.
  const wider = width / frameHeight > HERO_FRAME.aspect;
  const coverWidth = wider ? width : frameHeight * HERO_FRAME.aspect;
  const coverHeight = wider ? width / HERO_FRAME.aspect : frameHeight;

  // `object-position` percentages align that point of the image with that
  // point of the box, which is an offset of (box − image) × p.
  const originX = (width - coverWidth) * HERO_FRAME.anchor.x;
  const originY = (frameHeight - coverHeight) * HERO_FRAME.anchor.y - BACKDROP_OVERSCAN;

  const toX = (u: number): number => originX + u * coverWidth;
  const toY = (v: number): number => originY + v * coverHeight;
  const { box, beacon } = HERO_SUBJECT;

  return {
    width,
    height,
    box: { left: toX(box.left), top: toY(box.top), right: toX(box.right), bottom: toY(box.bottom) },
    beacon: { x: toX(beacon.x), y: toY(beacon.y) },
  };
}
