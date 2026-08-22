import { describe, expect, it } from 'vitest';
import {
  fuelOfferingLabel,
  isAlwaysOpen,
  isPlausibleIndianRegistration,
  normalizeRegistrationNumber,
  rcValidity,
} from '../index';

/**
 * Pure rules behind the two directory integrations.
 *
 * These run with no network, no database and no API key — they are the
 * cheapest place to pin down behaviour that would otherwise only be observable
 * through a paid provider call.
 */

describe('registration number normalisation', () => {
  it('collapses the ways a plate is typed into one canonical form', () => {
    for (const input of [
      'UP32AB1234',
      'up32ab1234',
      '  up32 ab 1234 ',
      'UP-32-AB-1234',
      'up 32-ab 1234',
    ]) {
      expect(normalizeRegistrationNumber(input)).toBe('UP32AB1234');
    }
  });

  it('accepts the registration formats actually issued in India', () => {
    const valid = [
      'UP32AB1234', // state series
      'DL3CAB1234', // Delhi, three-letter series
      'MH12A1234', // single-letter series
      'KA01F0001',
      'TN22BC4567',
      '22BH1234AA', // Bharat series
      '09A123456X', // defence
    ];
    for (const plate of valid) {
      expect(isPlausibleIndianRegistration(plate), plate).toBe(true);
    }
  });

  it('rejects input that cannot be a plate', () => {
    const invalid = [
      '', // empty
      'ABC', // too short
      '1234567', // digits only
      'ABCDEFG', // letters only
      'UP32AB1234567890', // too long
      'HELLO WORLD', // normalisation would leave a space
    ];
    for (const plate of invalid) {
      expect(isPlausibleIndianRegistration(plate), plate).toBe(false);
    }
  });

  it('validates the normalised form, not the raw input', () => {
    expect(isPlausibleIndianRegistration('up32 ab 1234')).toBe(false);
    expect(isPlausibleIndianRegistration(normalizeRegistrationNumber('up32 ab 1234'))).toBe(true);
  });
});

describe('RC document validity', () => {
  const now = new Date('2026-08-22T00:00:00.000Z');

  it('bands a date by how far away it is', () => {
    expect(rcValidity('2027-01-01', { now }).validity).toBe('VALID');
    expect(rcValidity('2026-09-05', { now }).validity).toBe('EXPIRING_SOON');
    expect(rcValidity('2026-08-01', { now }).validity).toBe('EXPIRED');
  });

  it('reports the days remaining', () => {
    expect(rcValidity('2026-08-30', { now }).daysRemaining).toBe(8);
    expect(rcValidity('2026-08-20', { now }).daysRemaining).toBe(-2);
  });

  it('never presents a missing or unparseable date as valid', () => {
    for (const value of [null, undefined, '', 'not-a-date']) {
      const result = rcValidity(value, { now });
      expect(result.validity).toBe('UNKNOWN');
      expect(result.daysRemaining).toBeNull();
    }
  });

  it('treats the expiry day itself as still valid', () => {
    expect(rcValidity('2026-08-22', { now }).validity).toBe('EXPIRING_SOON');
    expect(rcValidity('2026-08-22', { now }).daysRemaining).toBe(0);
  });
});

describe('fuel offering labels', () => {
  it('never claims live availability', () => {
    // The directory records what a station sells, not what is in its tanks.
    expect(fuelOfferingLabel(true)).toBe('Offered here');
    expect(fuelOfferingLabel(false)).toBe('Not listed');
    expect(fuelOfferingLabel(null)).toBe('Not listed');

    for (const value of [true, false, null] as const) {
      expect(fuelOfferingLabel(value).toLowerCase()).not.toContain('available');
    }
  });

  it('recognises round-the-clock stations from published timings', () => {
    expect(isAlwaysOpen('24 Hours')).toBe(true);
    expect(isAlwaysOpen('Open 24 Hours')).toBe(true);
    expect(isAlwaysOpen('24 hrs')).toBe(true);
    expect(isAlwaysOpen('Open until 10:00 PM')).toBe(false);
    expect(isAlwaysOpen(null)).toBe(false);
  });
});
