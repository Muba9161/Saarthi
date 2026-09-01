import { describe, expect, it } from 'vitest';
import {
  FUEL_RATE_BANDS,
  describeFuelRate,
  formatFuelRate,
  fuelRateUnit,
  hasAnyFuelRate,
  isPlausibleFuelRate,
  type CityFuelRate,
} from './fuel-rates';

/**
 * Fuel rate presentation and validation.
 *
 * These exist because of a concrete failure: a rate that was years stale, was a
 * city figure dressed as a pump price, and carried no date, was shown as
 * current. Every rule below is one of the ways that happened.
 */

function rate(overrides: Partial<CityFuelRate> = {}): CityFuelRate {
  return {
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    petrol: { price: 102.31, unit: 'litre' },
    diesel: { price: 95.79, unit: 'litre' },
    cng: { price: 99.5, unit: 'kg' },
    publishedOn: '2026-08-31',
    source: 'CarDekho',
    retrievedAt: '2026-08-31T09:00:00.000Z',
    cached: false,
    ...overrides,
  };
}

describe('fuelRateUnit', () => {
  it('sells CNG by weight and liquid fuel by volume', () => {
    expect(fuelRateUnit('petrol')).toBe('litre');
    expect(fuelRateUnit('diesel')).toBe('litre');
    // A CNG figure quoted per litre is a different number entirely.
    expect(fuelRateUnit('cng')).toBe('kg');
  });
});

describe('isPlausibleFuelRate', () => {
  it('accepts real Indian retail rates', () => {
    // Measured across cities on 2026-08-31.
    expect(isPlausibleFuelRate('petrol', 102.31)).toBe(true);
    expect(isPlausibleFuelRate('petrol', 111.68)).toBe(true);
    expect(isPlausibleFuelRate('diesel', 95.79)).toBe(true);
    expect(isPlausibleFuelRate('cng', 107.98)).toBe(true);
    expect(isPlausibleFuelRate('cng', 86)).toBe(true);
  });

  it('rejects a number that is plainly not a price', () => {
    // The failure mode: a layout change hands the parser a year, a page number
    // or a phone digit, and it publishes it as a rate.
    expect(isPlausibleFuelRate('petrol', 2026)).toBe(false);
    expect(isPlausibleFuelRate('petrol', 20)).toBe(false);
    expect(isPlausibleFuelRate('diesel', 0)).toBe(false);
    expect(isPlausibleFuelRate('cng', 5)).toBe(false);
  });

  it('rejects anything that is not a finite number', () => {
    expect(isPlausibleFuelRate('petrol', Number.NaN)).toBe(false);
    expect(isPlausibleFuelRate('petrol', Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('leaves headroom on both sides of the observed market', () => {
    // Wide by intent: the job is catching a bad parse, not forecasting prices.
    expect(FUEL_RATE_BANDS.petrol.min).toBeLessThan(95);
    expect(FUEL_RATE_BANDS.petrol.max).toBeGreaterThan(120);
  });
});

describe('formatFuelRate', () => {
  it('states the unit the fuel is actually sold in', () => {
    expect(formatFuelRate({ price: 102.31, unit: 'litre' })).toBe('₹102.31/L');
    expect(formatFuelRate({ price: 99.5, unit: 'kg' })).toBe('₹99.50/kg');
  });

  it('shows a dash rather than a zero when there is no rate', () => {
    expect(formatFuelRate(null)).toBe('—');
  });

  it('always shows two decimals, so 99.5 does not read as 99.05', () => {
    expect(formatFuelRate({ price: 99.5, unit: 'litre' })).toBe('₹99.50/L');
    expect(formatFuelRate({ price: 100, unit: 'litre' })).toBe('₹100.00/L');
  });
});

describe('hasAnyFuelRate', () => {
  it('is true when at least one fuel has a figure', () => {
    expect(hasAnyFuelRate(rate())).toBe(true);
    expect(hasAnyFuelRate(rate({ petrol: null, diesel: null }))).toBe(true);
  });

  it('is false for a rate carrying nothing at all', () => {
    expect(hasAnyFuelRate(rate({ petrol: null, diesel: null, cng: null }))).toBe(false);
    expect(hasAnyFuelRate(null)).toBe(false);
    expect(hasAnyFuelRate(undefined)).toBe(false);
  });
});

describe('describeFuelRate', () => {
  it('names the place and the publisher date', () => {
    expect(describeFuelRate(rate())).toBe('Lucknow, Uttar Pradesh — published 2026-08-31');
  });

  it('says the date is unstated rather than implying today', () => {
    // The old source published a 2024 figure with no date and it read as
    // current. An absent date must be visible, never filled in from the clock.
    const described = describeFuelRate(rate({ publishedOn: null }));
    expect(described).toMatch(/date not stated/i);
    expect(described).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('copes with a city whose state is unknown', () => {
    expect(describeFuelRate(rate({ state: null }))).toBe('Lucknow — published 2026-08-31');
  });
});
