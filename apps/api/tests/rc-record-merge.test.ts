import { describe, expect, it } from 'vitest';
import { normalizeWay2ApiRecord } from '../src/providers/vehicle-rc';
import { mergeRcRecords } from '../src/modules/vehicle-lookup/rc-record-merge';
import { successEnvelope } from './way2api-rc-fixture';

/**
 * The paid full record never shows less than the free one.
 *
 * The two records here are shaped like what Way2API returned for one real car
 * on 2026-10-15: Advanced had the maker, model and fuel that Lite left blank,
 * and left blank the RTO, seats and owner's address that Lite had, with its
 * chassis number partly masked where Lite's was whole.
 */

const record = (overrides: Record<string, unknown>) =>
  normalizeWay2ApiRecord(successEnvelope(overrides).data.result as Record<string, unknown>);

const advanced = record({
  maker_description: 'TATA MOTORS PASSENGER VEHICLES LTD',
  maker_model: 'CURVV CRTV + S TC',
  fuel_type: 'PETROL(E20)',
  registered_at: '',
  seat_capacity: '',
  present_address: '',
  father_name: '',
  vehicle_chasi_number: 'MAT6XXXXXXXXX1234',
  financed: true,
  response_metadata: { masked_chassis: true, masked_engine: false, masked_owner_name: false },
});

const lite = record({
  maker_description: '',
  maker_model: '',
  fuel_type: '',
  registered_at: 'TRANS GOMTI ARTO LUCKNOW (UP321)',
  seat_capacity: '5',
  present_address: 'Lucknow, 226010',
  father_name: 'RAKESH MOHANTY',
  vehicle_chasi_number: 'MAT612345678901234',
  financed: false,
  response_metadata: { masked_chassis: false, masked_engine: false, masked_owner_name: false },
});

describe('merging the paid record with the free one', () => {
  const merged = mergeRcRecords(advanced, lite);

  it("keeps what only the paid record has", () => {
    expect(merged.maker).toBe('TATA MOTORS PASSENGER VEHICLES LTD');
    expect(merged.model).toBe('CURVV CRTV + S TC');
    expect(merged.fuelType).toBe('PETROL(E20)');
  });

  it('fills what the paid record left blank from the free one', () => {
    expect(merged.rto).toBe('TRANS GOMTI ARTO LUCKNOW (UP321)');
    expect(merged.seatingCapacity).toBe(5);
    expect(merged.owner?.presentAddress).toBe('Lucknow, 226010');
    expect(merged.owner?.fatherName).toBe('RAKESH MOHANTY');
  });

  it('prefers a whole chassis number to one the provider masked', () => {
    expect(merged.chassisNumber).toBe('MAT612345678901234');
    expect(merged.maskedByProvider.chassisNumber).toBe(false);
  });

  it('lets the paid record win where both have a value', () => {
    expect(merged.financed).toBe(true);
  });

  it('keeps a masked value when there is nothing better to put in its place', () => {
    const alone = mergeRcRecords(advanced, record({ vehicle_chasi_number: '' }));

    expect(alone.chassisNumber).toBe('MAT6XXXXXXXXX1234');
    expect(alone.maskedByProvider.chassisNumber).toBe(true);
  });
});
