import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FESTIVAL_KEYS } from '@saarthi/shared';
import {
  FESTIVE_OFF_STORAGE_KEY,
  activeFestival,
  getFestiveState,
  refreshFestiveDay,
  resetFestiveForTests,
  setFestiveLooks,
  subscribeFestive,
  syncFestiveAccount,
} from './festive-state';
import { festiveBandMarkup } from './kit/band-markup';

const root = () => document.documentElement;

describe('festive state', () => {
  beforeEach(() => {
    resetFestiveForTests();
    window.localStorage.clear();
    root().removeAttribute('data-festive');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches itself on in a festival window and paints <html>', () => {
    vi.setSystemTime(new Date(2026, 10, 23, 10, 0));
    expect(activeFestival()).toBe('guru-nanak-jayanti');
    expect(root().getAttribute('data-festive')).toBe('guru-nanak-jayanti');
    expect(root().style.getPropertyValue('--festive-cta-from')).toBe('#F9B949');
    expect(getFestiveState().window?.end).toBe('2026-11-25');
  });

  it('shows nothing on an ordinary day', () => {
    vi.setSystemTime(new Date(2026, 10, 20, 10, 0));
    expect(activeFestival()).toBeNull();
    expect(root().hasAttribute('data-festive')).toBe(false);
  });

  it('remembers "off" on this device and takes the paint away', () => {
    vi.setSystemTime(new Date(2026, 11, 24, 10, 0));
    expect(activeFestival()).toBe('christmas');

    setFestiveLooks(false);
    expect(activeFestival()).toBeNull();
    expect(window.localStorage.getItem(FESTIVE_OFF_STORAGE_KEY)).toBe('1');
    expect(root().hasAttribute('data-festive')).toBe(false);
    expect(root().style.getPropertyValue('--festive-cta-from')).toBe('');

    resetFestiveForTests();
    expect(getFestiveState().on).toBe(false);
  });

  it('follows the account once the session is known, and ignores anything but a boolean', () => {
    vi.setSystemTime(new Date(2026, 11, 24, 10, 0));
    syncFestiveAccount(undefined);
    expect(getFestiveState().on).toBe(true);
    syncFestiveAccount(false);
    expect(getFestiveState().on).toBe(false);
    syncFestiveAccount(true);
    expect(getFestiveState().on).toBe(true);
    expect(window.localStorage.getItem(FESTIVE_OFF_STORAGE_KEY)).toBeNull();
  });

  it('picks up a new festival when the day is checked again', () => {
    vi.setSystemTime(new Date(2026, 10, 21, 23, 59));
    expect(activeFestival()).toBeNull();
    const listener = vi.fn();
    subscribeFestive(listener);

    vi.setSystemTime(new Date(2026, 10, 22, 0, 0, 2));
    refreshFestiveDay();
    expect(activeFestival()).toBe('guru-nanak-jayanti');
    expect(listener).toHaveBeenCalledTimes(1);

    refreshFestiveDay();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('festive garland', () => {
  it('draws every festival as a repeating, self-contained SVG pattern', () => {
    for (const key of FESTIVAL_KEYS) {
      const markup = festiveBandMarkup(key, ':r1:');
      expect(markup.startsWith('<svg')).toBe(true);
      expect(markup).toContain('<pattern id="festive-band-r1"');
      expect(markup).toContain('fill="url(#festive-band-r1)"');
      expect(markup, key).not.toMatch(/undefined|NaN/);
    }
  });
});
