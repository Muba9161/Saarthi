import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../domain/languages';
import {
  FESTIVALS,
  FESTIVAL_KEYS,
  FESTIVE_KITS,
  FESTIVE_SIGNATURE,
  FESTIVE_WISHES,
  activeFestivalOn,
  festiveGreeting,
  festiveRgba,
  festiveSignature,
  festiveWindows,
  festiveWish,
  isFestivalKey,
  localYmd,
  msUntilNextLocalDay,
  shiftDay,
  upcomingFestiveWindows,
} from './index';

describe('festive calendar', () => {
  it('shifts calendar days across month and year ends', () => {
    expect(shiftDay('2026-11-08', -2)).toBe('2026-11-06');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('shows a festival from two days early until the day after', () => {
    expect(activeFestivalOn('2026-11-21')).toBeNull();
    expect(activeFestivalOn('2026-11-22')).toBe('guru-nanak-jayanti');
    expect(activeFestivalOn('2026-11-24')).toBe('guru-nanak-jayanti');
    expect(activeFestivalOn('2026-11-25')).toBe('guru-nanak-jayanti');
    expect(activeFestivalOn('2026-11-26')).toBeNull();
    expect(activeFestivalOn('2026-12-23')).toBe('christmas');
    expect(activeFestivalOn('2026-12-30')).toBe('new-year');
  });

  it('keeps Eid one more day for the moon sighting', () => {
    expect(activeFestivalOn('2027-03-12')).toBe('eid-al-fitr');
    expect(activeFestivalOn('2027-03-13')).toBeNull();
  });

  it('follows the Government of India list for 2027', () => {
    const dayOf = (key: string, year: string) =>
      FESTIVALS.find((festival) => festival.key === key)?.days.find((day) => day.startsWith(year));
    expect(dayOf('guru-nanak-jayanti', '2027')).toBe('2027-11-14');
    expect(dayOf('eid-al-fitr', '2027')).toBe('2027-03-10');
    expect(dayOf('holi', '2027')).toBe('2027-03-23');
    expect(dayOf('raksha-bandhan', '2027')).toBe('2027-08-17');
    expect(dayOf('diwali', '2027')).toBe('2027-10-29');
  });

  it('lets the festival whose own day it is win, then the one still to come', () => {
    expect(activeFestivalOn('2027-08-14')).toBe('independence-day');
    expect(activeFestivalOn('2027-08-15')).toBe('independence-day');
    expect(activeFestivalOn('2027-08-16')).toBe('raksha-bandhan');
    expect(activeFestivalOn('2028-08-13')).toBe('janmashtami');
    expect(activeFestivalOn('2028-08-14')).toBe('independence-day');
  });

  it('has dates for every festival at least twelve months ahead', () => {
    const horizon = shiftDay(localYmd(), 365);
    for (const festival of FESTIVALS) {
      const last = festival.days[festival.days.length - 1] ?? '';
      expect(last >= horizon, `${festival.name}: add dates after ${last}`).toBe(true);
      for (const day of festival.days) expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('lists every key exactly once and sorts windows by start', () => {
    expect(new Set(FESTIVALS.map((festival) => festival.key))).toEqual(new Set(FESTIVAL_KEYS));
    const starts = festiveWindows().map((window) => window.start);
    expect([...starts].sort()).toEqual(starts);
    expect(isFestivalKey('holi')).toBe(true);
    expect(isFestivalKey('easter')).toBe(false);
  });

  it('sends only windows that have not ended, with a day of slack', () => {
    const upcoming = upcomingFestiveWindows('2026-11-26');
    expect(upcoming[0]?.key).toBe('guru-nanak-jayanti');
    expect(upcomingFestiveWindows('2026-11-27')[0]?.key).toBe('christmas');
  });

  it('waits until just after the next local midnight', () => {
    expect(msUntilNextLocalDay(new Date(2026, 10, 20, 23, 59, 0))).toBe(61_000);
  });
});

describe('festive kits', () => {
  it('gives every festival a complete look', () => {
    for (const key of FESTIVAL_KEYS) {
      const kit = FESTIVE_KITS[key];
      expect(kit.fxColors.length).toBeGreaterThan(0);
      if (kit.motif === 'toran') expect(kit.drop).toBeDefined();
      for (const colour of [
        kit.cta.from,
        kit.cta.to,
        kit.cta.ink,
        kit.wishOnDark,
        kit.wishOnLight,
      ]) {
        expect(colour).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });

  it('turns a glow into rgba', () => {
    expect(festiveRgba('#EE8A1A', 0.36)).toBe('rgba(238, 138, 26, 0.36)');
    expect(() => festiveRgba('orange', 1)).toThrow();
  });
});

describe('festive wishes', () => {
  it('has a wish for every festival in every language Saarthi offers', () => {
    expect(Object.keys(FESTIVE_WISHES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(Object.keys(FESTIVE_SIGNATURE).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of FESTIVAL_KEYS) {
        expect(FESTIVE_WISHES[locale]?.[key]?.trim(), `${locale} ${key}`).toBeTruthy();
      }
      expect(FESTIVE_SIGNATURE[locale]).toContain('VorldX Saarthi');
    }
  });

  it('reads the wish in the person’s language and falls back to English', () => {
    expect(festiveWish('guru-nanak-jayanti', 'pa-IN')).toBe('ਗੁਰਪੁਰਬ ਦੀਆਂ ਲੱਖ-ਲੱਖ ਵਧਾਈਆਂ');
    expect(festiveWish('diwali', 'hi')).toBe('शुभ दीपावली');
    expect(festiveWish('christmas', 'fr-FR')).toBe('Merry Christmas');
    expect(festiveWish('holi', null)).toBe('Happy Holi');
    expect(festiveSignature('ta-IN')).toBe('VorldX Saarthi குடும்பத்தின் சார்பாக');
  });

  it('addresses the greeting by first name only, and never by an email address', () => {
    expect(festiveGreeting('guru-nanak-jayanti', 'en-IN', 'Aarav Sharma')).toBe(
      'Happy Gurpurab, Aarav!',
    );
    expect(festiveGreeting('eid-al-fitr', 'ur-IN', 'Imran')).toBe('عید مبارک، Imran!');
    expect(festiveGreeting('holi', 'en-IN', 'me@example.com')).toBe('Happy Holi');
    expect(festiveGreeting('holi', 'en-IN', '   ')).toBe('Happy Holi');
  });
});
