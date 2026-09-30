import { describe, expect, it } from 'vitest';
import {
  findLoopClosure,
  meanAbsoluteDifference,
  pickSharpestPerSlot,
  sharpness,
  toLuma,
} from './frame-analysis';
import { reverseTurn, reversedIndex, startAt, withoutFrame } from './frame-order';

/** A flat greyscale sample of one value. */
const flat = (value: number, length = 64): Float32Array => new Float32Array(length).fill(value);

describe('frame analysis', () => {
  it('reads luma from RGBA with the Rec. 601 weights', () => {
    const luma = toLuma(new Uint8ClampedArray([255, 255, 255, 255, 255, 0, 0, 255]));
    expect(luma[0]).toBeCloseTo(255);
    expect(luma[1]).toBeCloseTo(76.245);
  });

  it('scores a sharp edge above a smeared one', () => {
    const width = 8;
    const height = 8;
    const edge = new Float32Array(width * height);
    const smeared = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        edge[y * width + x] = x < 4 ? 0 : 255;
        smeared[y * width + x] = (x / (width - 1)) * 255;
      }
    }
    expect(sharpness(edge, width, height)).toBeGreaterThan(sharpness(smeared, width, height));
    expect(sharpness(flat(128), 8, 8)).toBe(0);
  });

  it('measures how different two samples are', () => {
    expect(meanAbsoluteDifference(flat(10), flat(10))).toBe(0);
    expect(meanAbsoluteDifference(flat(10), flat(30))).toBe(20);
  });

  it('finds where a walk comes back to its starting view', () => {
    // A walk round: the view drifts away from the start and back again, with
    // the return at sample 16 of 20 — the last few samples overshoot.
    const samples = Array.from({ length: 20 }, (_, index) => {
      const distance = index <= 16 ? Math.sin((Math.PI * index) / 16) * 100 : (index - 16) * 20;
      return flat(distance);
    });
    expect(findLoopClosure(samples)).toBe(16);
  });

  it('reports no loop when the walk never returns', () => {
    const samples = Array.from({ length: 20 }, (_, index) => flat(index * 10));
    expect(findLoopClosure(samples)).toBeNull();
    expect(findLoopClosure(samples.slice(0, 4))).toBeNull();
  });

  it('keeps the sharpest candidate from each step and fills empty steps', () => {
    const picks = pickSharpestPerSlot(
      [
        { time: 0.2, sharpness: 5 },
        { time: 0.7, sharpness: 9 },
        { time: 1.1, sharpness: 3 },
        { time: 1.6, sharpness: 1 },
      ],
      0,
      3,
      3,
    );
    expect(picks).toEqual([0.7, 1.1, 2.5]);
  });
});

describe('frame order', () => {
  const frames = ['a', 'b', 'c', 'd', 'e'];

  it('opens the loop on any frame', () => {
    expect(startAt(frames, 2)).toEqual(['c', 'd', 'e', 'a', 'b']);
    expect(startAt(frames, -1)).toEqual(['e', 'a', 'b', 'c', 'd']);
    expect(startAt([], 3)).toEqual([]);
  });

  it('reverses the turn but keeps the opening view', () => {
    const reversed = reverseTurn(frames);
    expect(reversed).toEqual(['a', 'e', 'd', 'c', 'b']);
    // The frame being looked at stays the frame being looked at.
    expect(reversed[reversedIndex(1, frames.length)]).toBe('b');
    expect(reversed[reversedIndex(0, frames.length)]).toBe('a');
  });

  it('drops a single frame', () => {
    expect(withoutFrame(frames, 1)).toEqual(['a', 'c', 'd', 'e']);
  });
});
