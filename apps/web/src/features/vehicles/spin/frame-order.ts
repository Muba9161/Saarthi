/**
 * Re-ordering a spin's frames before it is saved.
 *
 * A spin is a loop, so every operation here keeps it one: the first frame is
 * the view it opens on, and "reverse" turns the loop the other way round while
 * keeping that view first.
 */

/** Rotate the loop so the frame at `index` becomes the opening view. */
export function startAt<T>(frames: readonly T[], index: number): T[] {
  if (frames.length === 0) return [];
  const from = ((index % frames.length) + frames.length) % frames.length;
  return [...frames.slice(from), ...frames.slice(0, from)];
}

/** The same loop walked the other way, still opening on the same view. */
export function reverseTurn<T>(frames: readonly T[]): T[] {
  if (frames.length < 3) return [...frames];
  const [first, ...rest] = frames;
  return [first as T, ...rest.reverse()];
}

/** Where the frame at `index` ends up after `reverseTurn`. */
export function reversedIndex(index: number, count: number): number {
  return count === 0 ? 0 : (count - index) % count;
}

/** The loop without one frame — a passer-by, a thumb over the lens. */
export function withoutFrame<T>(frames: readonly T[], index: number): T[] {
  return frames.filter((_, position) => position !== index);
}
