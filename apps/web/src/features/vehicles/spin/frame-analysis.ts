/**
 * Choosing a spin's frames from a walk-around video.
 *
 * Pure arithmetic over small greyscale samples, kept apart from the browser
 * plumbing that produces them so it can be tested without a video element.
 * Two questions are answered here:
 *
 *  - Which frame in each step of the walk is sharpest? A phone carried at
 *    walking pace smears every few frames; the frame beside a smeared one is
 *    usually clean, so sampling more than needed and keeping the best is the
 *    cheapest real improvement available.
 *  - Where does the walk come back to where it started? People rarely stop
 *    exactly on the spot they began from, and a spin that overshoots jumps
 *    backwards every time it passes the front.
 */

/** Rec. 601 luma of RGBA pixels, one value per pixel on a 0–255 scale. */
export function toLuma(rgba: Uint8ClampedArray): Float32Array {
  const luma = new Float32Array(rgba.length / 4);
  for (let pixel = 0, offset = 0; pixel < luma.length; pixel += 1, offset += 4) {
    luma[pixel] =
      0.299 * (rgba[offset] ?? 0) +
      0.587 * (rgba[offset + 1] ?? 0) +
      0.114 * (rgba[offset + 2] ?? 0);
  }
  return luma;
}

/**
 * Variance of the Laplacian — the standard focus measure. Edges make it large;
 * motion blur flattens them and drives it towards zero.
 */
export function sharpness(luma: Float32Array, width: number, height: number): number {
  let sum = 0;
  let sumOfSquares = 0;
  let samples = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const laplacian =
        4 * (luma[at] ?? 0) -
        (luma[at - 1] ?? 0) -
        (luma[at + 1] ?? 0) -
        (luma[at - width] ?? 0) -
        (luma[at + width] ?? 0);
      sum += laplacian;
      sumOfSquares += laplacian * laplacian;
      samples += 1;
    }
  }

  if (samples === 0) return 0;
  const mean = sum / samples;
  return sumOfSquares / samples - mean * mean;
}

/** How different two same-sized greyscale samples look, 0 for identical. */
export function meanAbsoluteDifference(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  }
  return total / length;
}

export interface LoopClosureOptions {
  /** Only look for the return in this trailing share of the walk. */
  searchFrom?: number;
  /** A match must be at least this much closer to the start than a typical view. */
  maxRatio?: number;
}

/** Fewer samples than this cannot say anything reliable about a loop. */
const MIN_SAMPLES_FOR_LOOP = 8;

/**
 * The sample at which the walk arrives back at its starting view, or `null`
 * when it never clearly does (the walk stopped short, or the light changed).
 *
 * Measured against the typical difference from the start rather than a fixed
 * threshold, because "similar" depends on the vehicle, the light and the
 * background — a white van on a white wall differs from every angle by less
 * than a red car in a car park does from one step to the next.
 */
export function findLoopClosure(
  samples: readonly Float32Array[],
  { searchFrom = 0.6, maxRatio = 0.6 }: LoopClosureOptions = {},
): number | null {
  const first = samples[0];
  if (!first || samples.length < MIN_SAMPLES_FOR_LOOP) return null;

  const differences = samples.map((sample) => meanAbsoluteDifference(first, sample));
  const typical = [...differences.slice(1)].sort((a, b) => a - b);
  const median = typical[Math.floor(typical.length / 2)] ?? 0;
  if (median === 0) return null;

  let best = -1;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let index = Math.floor(samples.length * searchFrom); index < samples.length; index += 1) {
    const difference = differences[index] ?? Number.POSITIVE_INFINITY;
    if (difference < bestDifference) {
      best = index;
      bestDifference = difference;
    }
  }

  return best > 0 && bestDifference < median * maxRatio ? best : null;
}

export interface FrameCandidate {
  /** Seconds into the video. */
  time: number;
  sharpness: number;
}

/**
 * The sharpest candidate's time in each of `slots` equal steps of the walk.
 *
 * A step with no candidate in it — possible once the end has been trimmed —
 * falls back to its own midpoint, so the spin never loses an angle.
 */
export function pickSharpestPerSlot(
  candidates: readonly FrameCandidate[],
  start: number,
  end: number,
  slots: number,
): number[] {
  const span = (end - start) / slots;
  const picks: number[] = [];

  for (let slot = 0; slot < slots; slot += 1) {
    const from = start + slot * span;
    const to = from + span;
    let best: FrameCandidate | null = null;
    for (const candidate of candidates) {
      if (candidate.time < from || candidate.time >= to) continue;
      if (!best || candidate.sharpness > best.sharpness) best = candidate;
    }
    picks.push(best ? best.time : from + span / 2);
  }

  return picks;
}
