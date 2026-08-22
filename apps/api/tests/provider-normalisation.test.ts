import { describe, expect, it } from 'vitest';
import { normalizeWay2ApiRecord } from '../src/providers/vehicle-rc/way2api-rc.provider';
import { normalizeSsrStation } from '../src/providers/petrol-stations/ssr-petrol-station.provider';

/**
 * Provider → Saarthi field mapping.
 *
 * These are the translation layer's unit tests: no server, no database, no
 * network. They pin the exact behaviour that a provider payload can never
 * smuggle past — invented values, string-typed numbers, or a blank standing in
 * for a real answer.
 */

describe('Way2API RC record mapping', () => {
  const payload = {
    rc_number: 'UP32AB1234',
    registration_date: '2022-03-20',
    rc_status: 'ACTIVE',
    less_info: false,
    latest_by: '2026-08-11',
    owner_name: 'SNEHA MOHANTY',
    father_name: '',
    owner_number: '1',
    mobile_number: '',
    present_address: 'Jagatsinghapur, 754119',
    permanent_address: 'Jagatsinghapur, 754119',
    vehicle_category: 'LMV',
    vehicle_category_description: 'Motor Car(LMV)',
    vehicle_chasi_number: 'ME1AB1234C5678901',
    vehicle_engine_number: 'G3AB1C234567',
    maker_description: 'MARUTI SUZUKI INDIA LTD',
    maker_model: 'SWIFT VXI',
    variant: null,
    body_type: 'SALOON',
    fuel_type: 'PETROL',
    color: 'PEARL ARCTIC WHITE',
    norms_type: 'BHARAT STAGE VI',
    manufacturing_date: '1/2022',
    manufacturing_date_formatted: '2022-01',
    cubic_capacity: '1197.00',
    no_cylinders: '4',
    seat_capacity: '5',
    sleeper_capacity: '0',
    standing_capacity: '0',
    wheelbase: '2450',
    unladen_weight: '875',
    vehicle_gross_weight: '1355',
    registered_at: 'LUCKNOW RTO, Uttar Pradesh',
    rto_code: '',
    fit_up_to: '2037-03-19',
    tax_upto: '2037-03-19',
    tax_paid_upto: '2037-03-19',
    financed: true,
    financer: 'EXAMPLE CAPITAL LTD',
    insurance_company: 'Example General Insurance Co. Ltd.',
    insurance_policy_number: '3410/12345678/000/00',
    insurance_upto: '2029-03-18',
    pucc_number: 'UP12345678901234',
    pucc_upto: '2026-11-02',
    permit_number: '',
    permit_type: '',
    permit_issue_date: null,
    permit_valid_from: null,
    permit_valid_upto: null,
    national_permit_number: '',
    national_permit_upto: null,
    national_permit_issued_by: null,
    non_use_status: null,
    blacklist_status: '',
    noc_details: '',
    challan_details: null,
    response_metadata: { masked_chassis: false, masked_engine: false, masked_owner_name: false },
    pdf_url: 'https://docs.example.test/rc.pdf',
  };

  it('maps the provider payload onto the normalised record', () => {
    const record = normalizeWay2ApiRecord(payload);

    expect(record.registrationNumber).toBe('UP32AB1234');
    expect(record.registrationStatus).toBe('ACTIVE');
    expect(record.maker).toBe('MARUTI SUZUKI INDIA LTD');
    expect(record.model).toBe('SWIFT VXI');
    expect(record.vehicleClass).toBe('Motor Car(LMV)');
    expect(record.owner?.name).toBe('SNEHA MOHANTY');
    expect(record.engineNumber).toBe('G3AB1C234567');
    expect(record.chassisNumber).toBe('ME1AB1234C5678901');
    expect(record.rto).toBe('LUCKNOW RTO, Uttar Pradesh');
    expect(record.financed).toBe(true);
    expect(record.financer).toBe('EXAMPLE CAPITAL LTD');
  });

  it('converts string-typed numerics to numbers', () => {
    const record = normalizeWay2ApiRecord(payload);

    expect(record.cubicCapacity).toBe(1197);
    expect(record.cylinders).toBe(4);
    expect(record.seatingCapacity).toBe(5);
    expect(record.sleeperCapacity).toBe(0);
    expect(record.wheelbaseMm).toBe(2450);
    expect(record.unladenWeight).toBe(875);
    expect(record.grossVehicleWeight).toBe(1355);
  });

  it('turns blanks and placeholders into null rather than empty strings', () => {
    const record = normalizeWay2ApiRecord(payload);

    expect(record.rtoCode).toBeNull();
    expect(record.owner?.fatherName).toBeNull();
    expect(record.owner?.mobileNumber).toBeNull();
    expect(record.permit.number).toBeNull();
    expect(record.permit.type).toBeNull();
    expect(record.permit.national.number).toBeNull();
    expect(record.blacklistStatus).toBeNull();
    expect(record.nocDetails).toBeNull();
    expect(record.challanDetails).toBeNull();
    expect(record.variant).toBeNull();
  });

  it('groups validity dates and keeps them ISO', () => {
    const record = normalizeWay2ApiRecord(payload);

    expect(record.insuranceValidUntil).toBe('2029-03-18');
    expect(record.puccValidUntil).toBe('2026-11-02');
    expect(record.fitnessValidUntil).toBe('2037-03-19');
    expect(record.tax).toEqual({ validUntil: '2037-03-19', paidUntil: '2037-03-19' });
    expect(record.dataAsOf).toBe('2026-08-11');
  });

  it('drops a date it cannot parse instead of guessing one', () => {
    const record = normalizeWay2ApiRecord({ ...payload, insurance_upto: 'sometime next year' });
    expect(record.insuranceValidUntil).toBeNull();
  });

  it('yields an all-null record for an empty payload without throwing', () => {
    const record = normalizeWay2ApiRecord({});

    expect(record.registrationNumber).toBeNull();
    expect(record.maker).toBeNull();
    expect(record.cubicCapacity).toBeNull();
    expect(record.tax).toEqual({ validUntil: null, paidUntil: null });
    expect(record.permit.national).toEqual({ number: null, validUntil: null, issuedBy: null });
    expect(record.maskedByProvider).toEqual({
      ownerName: false,
      chassisNumber: false,
      engineNumber: false,
    });
  });

  it('carries the provider masking flags through', () => {
    const record = normalizeWay2ApiRecord({
      ...payload,
      response_metadata: { masked_chassis: true, masked_engine: false, masked_owner_name: true },
    });

    expect(record.maskedByProvider).toEqual({
      ownerName: true,
      chassisNumber: true,
      engineNumber: false,
    });
  });

  it('ignores provider fields the normalised model does not define', () => {
    const record = normalizeWay2ApiRecord({ ...payload, some_future_field: 'surprise' });
    expect(JSON.stringify(record)).not.toContain('surprise');
  });
});

describe('SSR petrol station mapping', () => {
  const station = {
    id: 81233,
    pump_name: 'U. P. PETROL SERVICE STATION',
    name: 'U. P. PETROL SERVICE STATION',
    company: 'BPCL',
    latitude: '26.84615900',
    longitude: '80.94555700',
    address: 'NEAR CAPITOL CINEMA, HAZRATGANJ',
    city: 'HAZRATGANJ',
    district: 'Lucknow',
    state: 'Uttar Pradesh',
    petrol_price: '94.73',
    diesel_price: '87.86',
    has_petrol: true,
    has_diesel: true,
    has_cng: false,
    station_timing: '24 Hours',
    direction_link: 'https://maps.google.com/maps?q=26.846159,80.945557',
  };

  it('maps a station and coerces its string fields', () => {
    const result = normalizeSsrStation(station)!;

    expect(result.externalId).toBe('81233');
    expect(result.name).toBe('U. P. PETROL SERVICE STATION');
    expect(result.company).toBe('BPCL');
    expect(result.latitude).toBeCloseTo(26.846159, 6);
    expect(result.longitude).toBeCloseTo(80.945557, 6);
    expect(result.petrolPrice).toBe(94.73);
    expect(result.dieselPrice).toBe(87.86);
    expect(result.timings).toBe('24 Hours');
    expect(result.directionsUrl).toContain('maps.google.com');
  });

  it('keeps the raw record for replay', () => {
    const result = normalizeSsrStation(station)!;
    expect(result.raw).toMatchObject({ id: 81233, company: 'BPCL' });
  });

  it('reports a missing fuel without inventing a price', () => {
    const result = normalizeSsrStation(station)!;
    expect(result.hasCng).toBe(false);
    expect(result.cngPrice).toBeNull();
  });

  it('treats a zero price as not published', () => {
    const result = normalizeSsrStation({ ...station, petrol_price: '0.00' })!;
    expect(result.petrolPrice).toBeNull();
  });

  it('nulls the directory placeholder text', () => {
    const result = normalizeSsrStation({ ...station, address: 'Address not available' })!;
    expect(result.address).toBeNull();
  });

  it('falls back to `name` when `pump_name` is blank', () => {
    const result = normalizeSsrStation({ ...station, pump_name: '', name: 'Fallback Pump' })!;
    expect(result.name).toBe('Fallback Pump');
  });

  it('rejects records that cannot be placed on a map', () => {
    // No id — nothing to key an idempotent import on.
    expect(normalizeSsrStation({ ...station, id: undefined })).toBeNull();
    // Null island: the directory's stand-in for an unmapped station.
    expect(normalizeSsrStation({ ...station, latitude: '0', longitude: '0' })).toBeNull();
    // Missing or out-of-range coordinates.
    expect(normalizeSsrStation({ ...station, latitude: null })).toBeNull();
    expect(normalizeSsrStation({ ...station, latitude: '999' })).toBeNull();
    expect(normalizeSsrStation({ ...station, longitude: 'not a number' })).toBeNull();
  });
});
