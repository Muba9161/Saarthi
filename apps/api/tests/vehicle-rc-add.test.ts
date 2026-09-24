import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationType, RoleName, VehicleType, type VehicleRcPrefill } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Adding a vehicle from its RC number: the details are fetched to fill the
 * form, and the saved vehicle is verified against that same record — one
 * provider call, no charge. `fetch` is stubbed, so nothing is ever spent.
 */

const PLATE = 'UP32CD5678';

function rcEnvelope() {
  return {
    status: 'SUCCESS',
    status_code: 200,
    charged: true,
    success: true,
    message: '',
    message_code: 'OK',
    order_id: 'W2A-ADD-1',
    data: {
      order_id: 'W2A-ADD-1',
      result: {
        rc_number: PLATE,
        registration_date: '2022-03-20',
        rc_status: 'ACTIVE',
        less_info: false,
        latest_by: '2026-08-11',
        owner_name: 'SNEHA MOHANTY',
        father_name: '',
        owner_number: '1',
        masked_name: false,
        mobile_number: '9800000000',
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
        financed: false,
        financer: '',
        insurance_company: 'Example General Insurance Co. Ltd.',
        insurance_policy_number: '3410/12345678/000/00',
        insurance_upto: '2029-03-18',
        pucc_number: 'UP12345678901234',
        pucc_upto: '2027-11-02',
        permit_number: '',
        permit_type: '',
        permit_issue_date: null,
        permit_valid_from: null,
        permit_valid_upto: null,
        national_permit_number: '',
        national_permit_upto: null,
        national_permit_issued_by: null,
        non_use_status: null,
        non_use_from: null,
        non_use_to: null,
        blacklist_status: '',
        noc_details: '',
        challan_details: null,
        response_metadata: { masked_chassis: false, masked_engine: false, masked_owner_name: false },
        pdf_url: null,
      },
    },
  };
}

function stubProvider() {
  const fetchMock = vi.fn(async (input: unknown) => {
    if (String(input).includes('/api/v1/rc/text-pdf')) {
      return new Response(JSON.stringify(rcEnvelope()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not stubbed', { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const rcCalls = (fetchMock: ReturnType<typeof stubProvider>) =>
  fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/v1/rc/text-pdf')).length;

describe('adding a vehicle from its RC number', () => {
  let fleet: TestOrganization;
  let owner: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await cache.clear();
    // A travel business, which runs cars — the RC below is a car.
    fleet = await createOrganization(OrganizationType.MOBILITY_PROVIDER);
    owner = await createUser({ role: RoleName.MOBILITY_PROVIDER, organizationId: fleet.id });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fills in the vehicle from the RC, without the owner’s personal details', async () => {
    stubProvider();
    const { status, body } = await request<VehicleRcPrefill>({
      method: 'POST',
      url: '/api/v1/vehicles/rc-prefill',
      user: owner,
      payload: { registrationNumber: 'up32 cd 5678' },
    });

    expect(status).toBe(200);
    expect(body.data.registrationNumber).toBe(PLATE);
    expect(body.data.draft).toMatchObject({
      vehicleType: VehicleType.CAR,
      manufacturer: 'MARUTI SUZUKI INDIA LTD',
      model: 'SWIFT VXI',
      year: 2022,
      fuelType: 'PETROL',
      passengerCapacity: 5,
    });

    const wire = JSON.stringify(body);
    expect(wire).not.toContain('SNEHA');
    expect(wire).not.toContain('9800000000');
    expect(wire).not.toContain('ME1AB1234C5678901');
  });

  it('refuses a number already on Saarthi before spending a lookup', async () => {
    const fetchMock = stubProvider();
    await prisma.truck.create({ data: { organizationId: fleet.id, registrationNumber: PLATE, capacityTons: 0 } });

    const { status } = await request({
      method: 'POST',
      url: '/api/v1/vehicles/rc-prefill',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(status).toBe(409);
    expect(rcCalls(fetchMock)).toBe(0);
  });

  it('saves the vehicle verified against that record, with one provider call in all', async () => {
    const fetchMock = stubProvider();
    const prefill = await request<VehicleRcPrefill>({
      method: 'POST',
      url: '/api/v1/vehicles/rc-prefill',
      user: owner,
      payload: { registrationNumber: PLATE },
    });
    expect(prefill.status).toBe(200);

    const created = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/fleet/vehicles',
      user: owner,
      payload: {
        registrationNumber: PLATE,
        vehicleType: VehicleType.CAR,
        manufacturer: 'MARUTI SUZUKI INDIA LTD',
        model: 'SWIFT VXI',
        fuelType: 'PETROL',
        passengerCapacity: 5,
        rcLookupId: prefill.body.data.lookupId,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const vehicle = await prisma.truck.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(vehicle.verificationStatus).toBe('VERIFIED');
    expect(rcCalls(fetchMock)).toBe(1);
  });

  it('leaves a vehicle unverified when the lookup was for a different plate', async () => {
    stubProvider();
    const prefill = await request<VehicleRcPrefill>({
      method: 'POST',
      url: '/api/v1/vehicles/rc-prefill',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    const created = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/fleet/vehicles',
      user: owner,
      payload: {
        registrationNumber: 'UP32ZZ0001',
        vehicleType: VehicleType.CAR,
        fuelType: 'PETROL',
        passengerCapacity: 5,
        rcLookupId: prefill.body.data.lookupId,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const vehicle = await prisma.truck.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(vehicle.verificationStatus).toBe('PENDING');
  });
});
