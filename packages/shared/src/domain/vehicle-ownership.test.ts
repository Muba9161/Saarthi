import { describe, expect, it } from 'vitest';
import { maskRcRecord, ownerNamesMatch, type VehicleRcRecord } from '../index';

/**
 * The RC owner's name against a verified name on the account. A "yes" hands
 * over a vehicle's owner details and lets it be claimed from another account,
 * so these pin what must not match as firmly as what must.
 */

describe('ownerNamesMatch', () => {
  it.each([
    ['SNEHA MOHANTY', 'Sneha Mohanty'],
    ['MOHANTY SNEHA', 'SNEHA MOHANTY'],
    ['RAJESH SHARMA', 'RAJESH KUMAR SHARMA'],
    ['R KUMAR SHARMA', 'RAJESH KUMAR SHARMA'],
    ['SHRI RAJESH KUMAR', 'Rajesh Kumar'],
    ['RAJESH KUMAR S/O SURESH PRASAD', 'RAJESH KUMAR'],
    ['MOHD IRFAN KHAN', 'MOHAMMAD IRFAN KHAN'],
    ['M/S SHARMA ROADWAYS PVT LTD', 'SHARMA ROADWAYS PRIVATE LIMITED'],
    ['SHARMA ROADWAYS', 'M/S. SHARMA ROADWAYS PRIVATE LIMITED'],
  ])('matches %s with %s', (rcName, verifiedName) => {
    expect(ownerNamesMatch(rcName, verifiedName)).toBe(true);
  });

  it.each([
    // A shared surname or first name is not the same person.
    ['KUMAR', 'AMIT KUMAR'],
    ['RAJESH', 'RAJESH KUMAR'],
    ['AMIT KUMAR', 'RAJESH KUMAR'],
    // An initial must stand for a word the other side actually has.
    ['R KUMAR SHARMA', 'AMIT KUMAR SHARMA'],
    ['A KUMAR SHARMA', 'KUMAR SHARMA'],
    // Every word of the shorter name must be accounted for.
    ['AMIT KUMAR VERMA', 'AMIT KUMAR SHARMA'],
    // Legal-form words carry no identity.
    ['XYZ PRIVATE LIMITED', 'ABC PRIVATE LIMITED'],
    ['LOGISTICS PRIVATE LIMITED', 'ABC TRANSPORT PRIVATE LIMITED'],
    ['', 'SNEHA MOHANTY'],
    ['M/S', 'M/S'],
  ])('does not match %s with %s', (rcName, verifiedName) => {
    expect(ownerNamesMatch(rcName, verifiedName)).toBe(false);
  });

  it('is symmetric', () => {
    expect(ownerNamesMatch('RAJESH KUMAR SHARMA', 'R KUMAR SHARMA')).toBe(true);
    expect(ownerNamesMatch('AMIT KUMAR SHARMA', 'R KUMAR SHARMA')).toBe(false);
  });
});

/**
 * What anyone short of full access sees of an RC. The fixture carries only the
 * fields masking touches; the rest of the record passes through untouched.
 */
describe('maskRcRecord', () => {
  const record = {
    maker: 'TATA MOTORS LTD',
    owner: {
      name: 'SNEHA MOHANTY',
      fatherName: 'RAJESH MOHANTY',
      serialNumber: '1',
      mobileNumber: '+91 98765 43210',
      presentAddress: '12 Station Road, Jagatsinghapur, 754119',
      permanentAddress: null,
    },
    engineNumber: 'G3AB1C234567',
    chassisNumber: 'ME1AB1234C5678901',
    insurancePolicyNumber: '3410/12345678/000/00',
    redacted: false,
  } as unknown as VehicleRcRecord;

  it('keeps enough to recognise the vehicle and too little to find the person', () => {
    const masked = maskRcRecord(record);

    expect(masked.maker).toBe('TATA MOTORS LTD');
    expect(masked.owner?.name).toBe('SNEHA M.');
    expect(masked.owner?.mobileNumber).toBe('98******10');
    expect(masked.owner?.presentAddress).toBe('PIN 754119');
    expect(masked.owner?.permanentAddress).toBeNull();
    expect(masked.chassisNumber).toMatch(/^\*+8901$/);
    expect(masked.engineNumber).toMatch(/4567$/);
    expect(masked.redacted).toBe(true);
    expect(JSON.stringify(masked)).not.toMatch(/Station Road|98765 43210|MOHANTY/);
  });
});
