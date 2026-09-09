import { describe, expect, it } from 'vitest';
import { FuelType } from '@saarthi/shared';
import { refuellingCategoriesFor } from '../src/modules/terminal/navigation.service';

/**
 * Which stations a vehicle is actually shown.
 *
 * The terminal's `FUEL` button has always meant "petrol pumps and charging
 * points", for every vehicle. That put diesel pumps in front of an electric van
 * that cannot use one, and car chargers in front of a forty-tonne truck — a
 * driver looking at a list of places that cannot refuel them, which is the
 * complaint this fixes.
 */
describe('refuellingCategoriesFor', () => {
  const both = ['FUEL', 'CHARGING'] as const;

  it('sends an electric vehicle only to charging points', () => {
    expect(refuellingCategoriesFor('FUEL', FuelType.ELECTRIC, both)).toEqual(['CHARGING']);
  });

  it('sends a combustion vehicle only to fuel stations', () => {
    for (const fuel of [FuelType.DIESEL, FuelType.PETROL, FuelType.CNG, FuelType.LNG]) {
      expect(refuellingCategoriesFor('FUEL', fuel, both)).toEqual(['FUEL']);
    }
  });

  it('keeps both for a hybrid, which can use either', () => {
    expect(refuellingCategoriesFor('FUEL', FuelType.HYBRID, both)).toEqual(both);
  });

  it('keeps both when the fleet has not recorded a fuel type', () => {
    // Showing too much is recoverable; hiding the only station the driver can
    // use is not.
    expect(refuellingCategoriesFor('FUEL', null, both)).toEqual(both);
    expect(refuellingCategoriesFor('FUEL', undefined, both)).toEqual(both);
  });

  it('leaves every other service alone', () => {
    // A mechanic or a weighbridge means the same thing whatever the vehicle
    // burns, and narrowing those would be inventing a rule nobody asked for.
    expect(refuellingCategoriesFor('MECHANIC', FuelType.ELECTRIC, ['WORKSHOP'])).toEqual([
      'WORKSHOP',
    ]);
    expect(refuellingCategoriesFor('HOSPITAL', FuelType.DIESEL, ['HOSPITAL', 'PHARMACY'])).toEqual([
      'HOSPITAL',
      'PHARMACY',
    ]);
    expect(refuellingCategoriesFor(null, FuelType.ELECTRIC, both)).toEqual(both);
  });
});
