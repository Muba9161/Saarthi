import { describe, expect, it } from 'vitest';
import {
  FUEL_DIRECTORY_PRICE_NOTE,
  fuelOfferingText,
  stationFuelOffering,
  type PetrolStation,
} from './petrol-stations';

/**
 * The fuel directory's data, as observed rather than as documented.
 *
 * Two behaviours drive everything here, both measured against the live service
 * on 2026-08-31:
 *
 *  * The prices are unusable. One city figure repeated onto every station — 38
 *    of 40 around Gurugram, 100 of 100 around Delhi — and years out of date:
 *    Gurugram petrol came back at 95.44 against a real 102.97, and diesel at
 *    87.90 against 95.64. No timestamp is published, so staleness cannot even
 *    be disclosed. Saarthi therefore renders no rate from this source.
 *  * `has_petrol` and `has_diesel` are `true` on every record — 140 of 140
 *    sampled, including outlets named "Indraprastha Gas Limited CNG Station".
 *    They are schema defaults. `has_cng` does vary and tracks the directory's
 *    own `fuel_type` filter, so it is trusted.
 */

function station(overrides: Partial<PetrolStation> = {}): PetrolStation {
  return {
    id: 'ssr:1',
    externalId: '1',
    source: 'ssr',
    name: 'M/s HP S S Filling Station',
    company: 'HPCL',
    latitude: 28.4726,
    longitude: 77.0309,
    address: 'Sector 12A',
    city: 'Gurugram',
    district: 'Gurgaon',
    state: 'Haryana',
    hasPetrol: true,
    hasDiesel: true,
    hasCng: false,
    petrolPrice: 95.44,
    dieselPrice: 87.9,
    cngPrice: null,
    timings: 'Open 24 Hours',
    directionsUrl: null,
    distanceKm: 1.53,
    direction: 'N',
    ...overrides,
  };
}

describe('stationFuelOffering', () => {
  it('trusts an oil marketing brand for petrol and diesel', () => {
    for (const company of ['HPCL', 'BPCL', 'IOCL', 'Jio-bp', 'Indian Oil', 'Shell']) {
      const subject = station({ company });
      expect(stationFuelOffering(subject, 'petrol')).toBe('sold');
      expect(stationFuelOffering(subject, 'diesel')).toBe('sold');
    }
  });

  it('refuses to sell petrol at a gas outlet, whatever the flags say', () => {
    // Exactly the record the directory publishes, defaults and all.
    const subject = station({
      name: 'Indraprastha Gas Limited CNG Station',
      company: 'Unknown',
      hasPetrol: true,
      hasDiesel: true,
      hasCng: true,
    });

    expect(stationFuelOffering(subject, 'petrol')).toBe('not-sold');
    expect(stationFuelOffering(subject, 'diesel')).toBe('not-sold');
    expect(stationFuelOffering(subject, 'cng')).toBe('sold');
  });

  it('recognises a city gas distributor by name', () => {
    const subject = station({ name: 'Haryana City Gas CNG Station', company: 'Unknown' });
    expect(stationFuelOffering(subject, 'petrol')).toBe('not-sold');
    expect(stationFuelOffering(subject, 'cng')).toBe('sold');
  });

  it('lets a branded forecourt sell CNG alongside liquid fuel', () => {
    // Observed: "Lotus Automobiles [IOCL]" appears under the CNG filter.
    const subject = station({ name: 'Lotus Automobiles', company: 'IOCL', hasCng: true });
    expect(stationFuelOffering(subject, 'petrol')).toBe('sold');
    expect(stationFuelOffering(subject, 'cng')).toBe('sold');
  });

  it('says it does not know rather than guessing for an unbranded pump', () => {
    const subject = station({ name: 'Shri Ram Filling Point', company: null });
    expect(stationFuelOffering(subject, 'petrol')).toBe('unknown');
    expect(stationFuelOffering(subject, 'diesel')).toBe('unknown');
  });

  it('never words an offering as live availability', () => {
    for (const offering of ['sold', 'not-sold', 'unknown'] as const) {
      const text = fuelOfferingText(offering).toLowerCase();
      expect(text).not.toContain('available');
      expect(text).not.toContain('in stock');
    }
  });
});

describe('FUEL_DIRECTORY_PRICE_NOTE', () => {
  it('explains the absence without implying a rate exists', () => {
    expect(FUEL_DIRECTORY_PRICE_NOTE).toMatch(/no price is shown/i);
    // No figure, no currency symbol, no false promise of a live reading.
    expect(FUEL_DIRECTORY_PRICE_NOTE).not.toMatch(/[₹\d]/);
    expect(FUEL_DIRECTORY_PRICE_NOTE.toLowerCase()).not.toContain('available');
  });
});
