import { describe, expect, it } from 'vitest';
import {
  LIVE_RIDE_POLL_MS,
  displaySpeed,
  liveRidePath,
  liveRidePhase,
  liveRidePollInterval,
  updatedAgo,
  updatedAgoMessage,
} from './live-ride-status';

const POSITION = {
  latitude: 26.85,
  longitude: 80.95,
  speedKph: 42.4,
  heading: 90,
  recordedAt: '2026-10-23T10:00:00.000Z',
};
const RECORDED = Date.parse(POSITION.recordedAt);

describe('live ride phase', () => {
  it('is live while sharing with a fix, waiting while sharing without one', () => {
    expect(liveRidePhase({ status: 'SHARING', position: POSITION })).toBe('live');
    expect(liveRidePhase({ status: 'SHARING', position: null })).toBe('waiting');
  });

  it('is ended once sharing stops, whatever else arrives', () => {
    expect(liveRidePhase({ status: 'ENDED', position: null })).toBe('ended');
    // The API withholds the position once ended; the page must not trust one anyway.
    expect(liveRidePhase({ status: 'ENDED', position: POSITION })).toBe('ended');
  });
});

describe('live ride polling', () => {
  it('polls every ten seconds while the ride may still move', () => {
    expect(liveRidePollInterval(undefined, false)).toBe(LIVE_RIDE_POLL_MS);
    expect(liveRidePollInterval({ status: 'SHARING' }, false)).toBe(10_000);
  });

  it('stops for an ended ride or a link that does not exist', () => {
    expect(liveRidePollInterval({ status: 'ENDED' }, false)).toBe(false);
    expect(liveRidePollInterval(undefined, true)).toBe(false);
    expect(liveRidePollInterval({ status: 'SHARING' }, true)).toBe(false);
  });
});

describe('updated ago', () => {
  it('reads "just now" for a fresh fix and for a phone clock running ahead', () => {
    expect(updatedAgo(POSITION.recordedAt, RECORDED + 4_999)).toEqual({ unit: 'now' });
    expect(updatedAgo(POSITION.recordedAt, RECORDED - 30_000)).toEqual({ unit: 'now' });
  });

  it('counts whole seconds, then minutes, then hours', () => {
    expect(updatedAgo(POSITION.recordedAt, RECORDED + 20_400)).toEqual({
      unit: 'seconds',
      count: 20,
    });
    expect(updatedAgo(POSITION.recordedAt, RECORDED + 59_999)).toEqual({
      unit: 'seconds',
      count: 59,
    });
    expect(updatedAgo(POSITION.recordedAt, RECORDED + 60_000)).toEqual({
      unit: 'minutes',
      count: 1,
    });
    expect(updatedAgo(POSITION.recordedAt, RECORDED + 3_599_000)).toEqual({
      unit: 'minutes',
      count: 59,
    });
    expect(updatedAgo(POSITION.recordedAt, RECORDED + 2 * 3_600_000 + 5)).toEqual({
      unit: 'hours',
      count: 2,
    });
  });

  it('says nothing for a timestamp that does not parse', () => {
    expect(updatedAgo('not a date', RECORDED)).toBeNull();
  });

  it('maps each unit onto its catalogue line', () => {
    expect(updatedAgoMessage({ unit: 'now' })).toEqual({ key: 'Updated just now' });
    expect(updatedAgoMessage({ unit: 'seconds', count: 20 })).toEqual({
      key: 'Updated {count} s ago',
      values: { count: 20 },
    });
    expect(updatedAgoMessage({ unit: 'minutes', count: 3 }).key).toBe('Updated {count} min ago');
    expect(updatedAgoMessage({ unit: 'hours', count: 1 }).key).toBe('Updated {count} h ago');
  });
});

describe('speed and link', () => {
  it('shows whole km/h, and nothing when the phone sent no speed', () => {
    expect(displaySpeed(42.4)).toBe(42);
    expect(displaySpeed(0)).toBe(0);
    expect(displaySpeed(-1)).toBe(0);
    expect(displaySpeed(null)).toBeNull();
    expect(displaySpeed(Number.NaN)).toBeNull();
  });

  it('builds the public page path with the token escaped', () => {
    expect(liveRidePath('abc123')).toBe('/live/abc123');
    expect(liveRidePath('a/b?c')).toBe('/live/a%2Fb%3Fc');
  });
});
