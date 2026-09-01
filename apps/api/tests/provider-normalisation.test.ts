import { describe, expect, it } from 'vitest';
import { NEARBY_CATEGORIES, NearbyCategory } from '@saarthi/shared';
import { normalizeWay2ApiRecord } from '../src/providers/vehicle-rc/way2api-rc.provider';
import { normalizeSsrStation } from '../src/providers/petrol-stations/ssr-petrol-station.provider';
import {
  normalizeOverpassElement,
  resolveRadii,
} from '../src/providers/places/overpass-place.provider';
import {
  normalizeWay2ApiLicence,
  toProviderDate,
} from '../src/providers/driving-licence/way2api-licence.provider';

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

describe('Way2API driving licence mapping', () => {
  const payload = {
    license_number: 'MH0320140001234',
    state: 'Maharashtra',
    name: 'PRIYA PATEL',
    permanent_address: '42 MG ROAD, PUNE, MAHARASHTRA',
    permanent_zip: '411001',
    temporary_address: '42 MG ROAD, PUNE, MAHARASHTRA',
    temporary_zip: '411001',
    citizenship: '',
    ola_name: 'RTO PUNE',
    ola_code: 'MH032',
    gender: 'F',
    father_or_husband_name: 'MAHESH PATEL',
    dob: '1992-06-15',
    doe: '2034-08-10',
    transport_doe: '1800-01-01',
    doi: '2014-08-11',
    transport_doi: '1800-01-01',
    has_image: true,
    blood_group: 'B+',
    vehicle_classes: ['MCWG', 'LMV-NT'],
    less_info: false,
  };

  it('maps the provider payload onto the normalised record', () => {
    const record = normalizeWay2ApiLicence(payload);

    expect(record.licenceNumber).toBe('MH0320140001234');
    expect(record.state).toBe('Maharashtra');
    expect(record.issuingAuthority).toBe('RTO PUNE');
    expect(record.issuingAuthorityCode).toBe('MH032');
    expect(record.issuedOn).toBe('2014-08-11');
    expect(record.validUntil).toBe('2034-08-10');
    expect(record.vehicleClasses).toEqual(['MCWG', 'LMV-NT']);
    expect(record.hasPhotograph).toBe(true);
    expect(record.holder?.name).toBe('PRIYA PATEL');
    expect(record.holder?.bloodGroup).toBe('B+');
  });

  it('treats the provider 1800 sentinel as "no commercial entitlement"', () => {
    const record = normalizeWay2ApiLicence(payload);

    // Rendering 1800-01-01 would tell a fleet manager the transport licence
    // expired two centuries ago.
    expect(record.transportValidUntil).toBeNull();
    expect(record.transportIssuedOn).toBeNull();
  });

  it('keeps a real transport validity date', () => {
    const record = normalizeWay2ApiLicence({
      ...payload,
      transport_doi: '2016-02-01',
      transport_doe: '2029-01-31',
    });

    expect(record.transportIssuedOn).toBe('2016-02-01');
    expect(record.transportValidUntil).toBe('2029-01-31');
  });

  it('turns blanks into null rather than empty strings', () => {
    const record = normalizeWay2ApiLicence(payload);
    expect(record.holder?.citizenship).toBeNull();
  });

  it('yields an all-null record for an empty payload without throwing', () => {
    const record = normalizeWay2ApiLicence({});

    expect(record.licenceNumber).toBeNull();
    expect(record.validUntil).toBeNull();
    expect(record.vehicleClasses).toEqual([]);
    expect(record.holder?.name).toBeNull();
  });

  it('formats the date of birth the way the provider expects', () => {
    // dd/mm/yyyy, zero padded — not ISO, and not the locale's order.
    expect(toProviderDate(new Date('1992-06-15T00:00:00Z'))).toBe('15/06/1992');
    expect(toProviderDate(new Date('2001-01-05T00:00:00Z'))).toBe('05/01/2001');
  });
});

describe('OpenStreetMap place mapping', () => {
  const ALL = NEARBY_CATEGORIES;

  const pump = {
    type: 'node',
    id: 249054695,
    lat: 28.4892384,
    lon: 77.0909884,
    tags: {
      amenity: 'fuel',
      name: 'Indian Oil',
      brand: 'Indian Oil',
      opening_hours: '24/7',
      'addr:city': 'Gurugram',
      'addr:state': 'Haryana',
      'addr:street': 'Golf Course Road',
      'addr:housenumber': '12',
      'contact:phone': '+911244567890',
      'fuel:diesel': 'yes',
      wikipedia: 'en:Indian Oil',
    },
  };

  it('maps a node onto the Saarthi category and fields', () => {
    const place = normalizeOverpassElement(pump, ALL)!;

    expect(place.externalId).toBe('n249054695');
    expect(place.category).toBe(NearbyCategory.FUEL);
    expect(place.name).toBe('Indian Oil');
    expect(place.latitude).toBeCloseTo(28.4892384, 6);
    expect(place.longitude).toBeCloseTo(77.0909884, 6);
    expect(place.address).toBe('12 Golf Course Road, Gurugram');
    expect(place.city).toBe('Gurugram');
    expect(place.state).toBe('Haryana');
    expect(place.phone).toBe('+911244567890');
  });

  it('takes the centre of a way, so a mapped forecourt still has a position', () => {
    const place = normalizeOverpassElement(
      { type: 'way', id: 555, center: { lat: 28.5, lon: 77.1 }, tags: { amenity: 'fuel' } },
      ALL,
    )!;

    expect(place.externalId).toBe('w555');
    expect(place.latitude).toBe(28.5);
    expect(place.longitude).toBe(77.1);
  });

  it('treats only an explicit 24/7 as round-the-clock opening', () => {
    expect(normalizeOverpassElement(pump, ALL)!.open24Hours).toBe(true);

    const restricted = normalizeOverpassElement(
      { ...pump, tags: { ...pump.tags, opening_hours: 'Mo-Sa 06:00-22:00' } },
      ALL,
    )!;
    // "Not stated as always open" must never be reported as always open.
    expect(restricted.open24Hours).toBe(false);
    expect(restricted.openingHours).toBe('Mo-Sa 06:00-22:00');

    const unstated = normalizeOverpassElement(
      { ...pump, tags: { amenity: 'fuel', name: 'Indian Oil' } },
      ALL,
    )!;
    expect(unstated.open24Hours).toBe(false);
    expect(unstated.openingHours).toBeNull();
  });

  it('invents no rating, because OpenStreetMap publishes none', () => {
    // `rating` is absent from the provider place entirely, and the service layer
    // sends null onward — a plausible number here would be a fabrication.
    expect('rating' in normalizeOverpassElement(pump, ALL)!).toBe(false);
  });

  it('keeps only the curated tag subset in attributes', () => {
    const place = normalizeOverpassElement(pump, ALL)!;

    expect(place.attributes['fuel:diesel']).toBe('yes');
    expect(place.attributes.brand).toBe('Indian Oil');
    // Not on the keep-list: mirroring every tag is storage nothing reads.
    expect(place.attributes.wikipedia).toBeUndefined();
  });

  it('names an unnamed pump generically, but drops an unnamed restaurant', () => {
    const anonymousPump = normalizeOverpassElement(
      { type: 'node', id: 1, lat: 28.4, lon: 77.0, tags: { amenity: 'fuel' } },
      ALL,
    )!;
    // You can drive to an unnamed pump and use it.
    expect(anonymousPump.name).toBe('Fuel station');

    // You cannot ask for, phone or recognise an unnamed restaurant.
    expect(
      normalizeOverpassElement(
        { type: 'node', id: 2, lat: 28.4, lon: 77.0, tags: { amenity: 'restaurant' } },
        ALL,
      ),
    ).toBeNull();
  });

  it('falls back through name:en, brand and operator for identity', () => {
    const byOperator = normalizeOverpassElement(
      {
        type: 'node',
        id: 3,
        lat: 28.4,
        lon: 77.0,
        tags: { amenity: 'restaurant', operator: 'Haldiram’s' },
      },
      ALL,
    )!;
    expect(byOperator.name).toBe('Haldiram’s');
  });

  it('never smuggles in a category the caller filtered out', () => {
    // A café inside a fuel station matches two selectors; asking only for food
    // must not return it as a fuel station, or vice versa.
    const forecourtCafe = {
      type: 'node',
      id: 4,
      lat: 28.4,
      lon: 77.0,
      tags: { amenity: 'fuel', name: 'Highway Stop', cuisine: 'coffee_shop' },
    };
    expect(normalizeOverpassElement(forecourtCafe, [NearbyCategory.FOOD])).toBeNull();
    expect(normalizeOverpassElement(forecourtCafe, [NearbyCategory.FUEL])?.category).toBe(
      NearbyCategory.FUEL,
    );
  });

  it('rejects records that cannot be placed on a map', () => {
    const base = { type: 'node', id: 9, tags: { amenity: 'fuel', name: 'X' } };
    // No coordinate at all.
    expect(normalizeOverpassElement(base, ALL)).toBeNull();
    // Null island — never a real place.
    expect(normalizeOverpassElement({ ...base, lat: 0, lon: 0 }, ALL)).toBeNull();
    // Out of range.
    expect(normalizeOverpassElement({ ...base, lat: 999, lon: 77 }, ALL)).toBeNull();
    // No id, so nothing to key an idempotent import on.
    expect(normalizeOverpassElement({ ...base, id: undefined, lat: 28.4, lon: 77 }, ALL)).toBeNull();
    // A tag set matching nothing Saarthi lists.
    expect(
      normalizeOverpassElement({ type: 'node', id: 10, lat: 28.4, lon: 77, tags: { shop: 'books' } }, ALL),
    ).toBeNull();
  });
});

describe('Overpass search radius budget', () => {
  const options = { maxRadiusKm: 25, workBudget: 200 };

  it('spends nothing it does not need on a focused search', () => {
    // One selector, so the caller's full radius fits inside the budget.
    const radii = resolveRadii(25, 0, 1, options);
    expect(radii.sparseKm).toBe(25);
  });

  it('shrinks a whole-category search to what the instance will serve', () => {
    // The measured shape: 10 dense selectors and 11 sparse ones. Left alone
    // that costs ~355 selector-km, which the public instance refuses outright.
    const radii = resolveRadii(25, 10, 11, options);

    expect(10 * radii.denseKm + 11 * radii.sparseKm).toBeLessThanOrEqual(options.workBudget + 1);
    // Sparse categories keep the reach a driver actually needs for them.
    expect(radii.sparseKm).toBeGreaterThan(radii.denseKm);
    expect(radii.sparseKm).toBeGreaterThan(10);
  });

  it('never searches wider than the caller asked for', () => {
    const radii = resolveRadii(3, 10, 11, options);
    expect(radii.denseKm).toBeLessThanOrEqual(3);
    expect(radii.sparseKm).toBeLessThanOrEqual(3);
  });

  it('lets a self-hosted instance search wide by raising the budget', () => {
    const radii = resolveRadii(25, 10, 11, { maxRadiusKm: 25, workBudget: 20_000 });
    expect(radii.sparseKm).toBe(25);
    // Dense categories still stay near — that is about what a driver would
    // travel for a café, not about cost.
    expect(radii.denseKm).toBe(8);
  });
});
