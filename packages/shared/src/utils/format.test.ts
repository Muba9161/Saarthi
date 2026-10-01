import { describe, expect, it } from 'vitest';
import { relativeTimeFrom } from './format';

describe('relativeTimeFrom', () => {
  const now = new Date('2026-10-01T12:00:00Z');

  it('describes a moment relative to now', () => {
    expect(relativeTimeFrom('2026-10-01T09:00:00Z', now)).toBe('3 hours ago');
    expect(relativeTimeFrom(new Date('2026-10-03T12:00:00Z'), now)).toBe('in 2 days');
  });

  it('shows a dash for a date that is missing or unreadable, instead of throwing', () => {
    // It runs during render, so a throw here replaced the whole screen.
    expect(relativeTimeFrom(null, now)).toBe('—');
    expect(relativeTimeFrom(undefined, now)).toBe('—');
    expect(relativeTimeFrom('not a date', now)).toBe('—');
  });
});
