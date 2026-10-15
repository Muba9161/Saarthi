import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// The request is held encrypted until the payment settles. Set before any
// application module loads its config.
vi.hoisted(() => {
  process.env.IDENTITY_ENCRYPTION_KEY = 'test-identity-encryption-key-0123456789abcdef';
});
import {
  OrganizationType,
  PlanTier,
  RoleName,
  VehicleRcService,
  VerificationChargeStatus,
  type VehicleLookupResult,
  type VehicleRcPrefill,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { normalizeWay2ApiRecord } from '../src/providers/vehicle-rc';
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
import { jsonResponse, pdfResponse, successEnvelope } from './way2api-rc-fixture';

/**
 * Full vehicle details for ₹20, through Pay & Verify.
 *
 * Bought while adding a vehicle (the account pays and names the plate) or from
 * a vehicle already on the account (its own plate, typed by nobody). The tests
 * worth having are the money ones: what is charged and when, what is never
 * charged, and that what is paid for is never thinner than the free record.
 * Way2API is stubbed at `fetch` and the mock gateway settles in-process.
 */

const CHECKS_URL = '/api/v1/verification-center/checks';
const PLATE = 'UP32AB1234';

type Service = 'lite' | 'text-pdf' | 'advanced';

// Shaped like what Way2API returned for a real car on 2026-10-15.
const advancedAnswer = () =>
  jsonResponse(
    successEnvelope({
      maker_description: 'TATA MOTORS PASSENGER VEHICLES LTD',
      maker_model: 'CURVV CRTV + S TC',
      registered_at: '',
      seat_capacity: '',
    }),
  );
const liteFields = {
  maker_description: '',
  maker_model: '',
  registered_at: 'TRANS GOMTI ARTO LUCKNOW (UP321)',
  seat_capacity: '5',
  pdf_url: undefined,
};
const liteAnswer = () => jsonResponse(successEnvelope(liteFields));
const backendDown = () =>
  jsonResponse(
    { status: 'FAILED', success: false, charged: false, message_code: 'REQUEST_FAILED', message: 'Backend Down.' },
    400,
  );
const noRecord = () =>
  jsonResponse({ success: false, charged: true, message_code: 'NO_RECORD_FOUND', message: 'No record found' }, 422);

/** Answers each RC service as `answers` says, and any certificate download with a PDF. */
function stubRc(answers: Partial<Record<Service, () => Response>>) {
  const serviceOf = (url: string) => url.replace(/^.*\/api\/v1\/rc\//, '');
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (!url.includes('/api/v1/rc/')) return pdfResponse();
    const answer = answers[serviceOf(url) as Service];
    return answer ? answer() : new Response('unexpected', { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    asked: () =>
      fetchMock.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.includes('/api/v1/rc/'))
        .map(serviceOf),
  };
}

interface StartResult {
  mode: string;
  state: string;
  charge: { status: string; amount: number; freeRetryAvailable: boolean } | null;
}

let fleet: TestOrganization;
let otherFleet: TestOrganization;
let owner: TestUser;

const buyForPlate = (registrationNumber = PLATE) =>
  request<StartResult>({
    method: 'POST',
    url: CHECKS_URL,
    user: owner,
    payload: {
      kind: 'VEHICLE_RC_DETAILS',
      subjectType: 'ORGANIZATION',
      subjectId: fleet.id,
      registrationNumber,
    },
  });

const buyForVehicle = (vehicleId: string) =>
  request<StartResult>({
    method: 'POST',
    url: CHECKS_URL,
    user: owner,
    payload: { kind: 'VEHICLE_RC_DETAILS', subjectType: 'TRUCK', subjectId: vehicleId },
  });

const addTruck = (organizationId: string) =>
  prisma.truck.create({
    data: { organizationId, registrationNumber: PLATE, capacityTons: 12 },
    select: { id: true },
  });

beforeAll(async () => {
  await getApp();
});

afterAll(async () => {
  await closeApp();
});

beforeEach(async () => {
  await resetDatabase();
  fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
  otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
  owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('full vehicle details while adding a vehicle', () => {
  it('charges ₹20, merges Advanced with Lite, and fills the add form from the result', async () => {
    const stub = stubRc({ advanced: advancedAnswer, lite: liteAnswer });

    const bought = await buyForPlate();

    expect(bought.status, JSON.stringify(bought.body)).toBe(200);
    expect(bought.body.data.state).toBe('VERIFIED');
    expect(bought.body.data.charge?.amount).toBe(20);
    expect(bought.body.data.charge?.status).toBe(VerificationChargeStatus.VERIFIED);
    // No basic record was held, so Lite was asked to complete the full one.
    expect(stub.asked()).toEqual(['advanced', 'lite']);

    const stored = await prisma.vehicleLookup.findFirstOrThrow({ where: { registrationNumber: PLATE } });
    expect(stored.service).toBe(VehicleRcService.ADVANCED);
    expect(stored.pdfStorageKey).not.toBeNull();

    const form = await request<VehicleRcPrefill>({
      method: 'GET',
      url: `/api/v1/vehicles/rc-prefill/stored?registrationNumber=${PLATE}`,
      user: owner,
    });
    expect(form.body.data.detailLevel).toBe('FULL');
    expect(form.body.data.draft.manufacturer).toBe('TATA MOTORS PASSENGER VEHICLES LTD');
  });

  it('charges nothing for full details the account already holds', async () => {
    stubRc({ advanced: advancedAnswer, lite: liteAnswer });
    await buyForPlate();
    const stub = stubRc({ advanced: advancedAnswer, lite: liteAnswer });

    const again = await buyForPlate();

    expect(again.body.data.mode).toBe('COMPLETED_FREE');
    expect(again.body.data.charge).toBeNull();
    expect(stub.asked()).toEqual([]);
    expect(await prisma.verificationCharge.count()).toBe(1);
  });

  it('refuses a plate already on the account before asking for any payment', async () => {
    await addTruck(fleet.id);
    const stub = stubRc({ advanced: advancedAnswer, lite: liteAnswer });

    const bought = await buyForPlate();

    expect(bought.status).toBe(409);
    expect(stub.asked()).toEqual([]);
    expect(await prisma.verificationCharge.count()).toBe(0);
  });
});

describe('full vehicle details from a vehicle on the account', () => {
  it("uses the vehicle's own plate and keeps the basic record's fields", async () => {
    const truck = await addTruck(fleet.id);
    // The free record fetched when the vehicle was added.
    await prisma.vehicleLookup.create({
      data: {
        registrationNumber: PLATE,
        organizationId: fleet.id,
        service: VehicleRcService.LITE,
        responseData: normalizeWay2ApiRecord(
          successEnvelope(liteFields).data.result as Record<string, unknown>,
        ) as unknown as object,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const stub = stubRc({ advanced: advancedAnswer });

    const bought = await buyForVehicle(truck.id);

    expect(bought.body.data.charge?.amount).toBe(20);
    expect(bought.body.data.state).toBe('VERIFIED');
    // The basic record was already held, so Lite was not asked again.
    expect(stub.asked()).toEqual(['advanced']);

    const shown = await request<VehicleLookupResult>({
      method: 'GET',
      url: `/api/v1/vehicles/lookups/latest?registrationNumber=${PLATE}`,
      user: owner,
    });
    expect(shown.body.data.detailLevel).toBe('FULL');
    expect(shown.body.data.vehicle.maker).toBe('TATA MOTORS PASSENGER VEHICLES LTD');
    expect(shown.body.data.vehicle.rto).toBe('TRANS GOMTI ARTO LUCKNOW (UP321)');
    expect(shown.body.data.pdfAvailable).toBe(true);
  });

  it("will not sell another account's vehicle, and charges nothing", async () => {
    const theirs = await addTruck(otherFleet.id);
    const stub = stubRc({ advanced: advancedAnswer });

    const bought = await buyForVehicle(theirs.id);

    expect(bought.status).toBe(404);
    expect(stub.asked()).toEqual([]);
    expect(await prisma.verificationCharge.count()).toBe(0);
  });
});

describe('who may buy full details', () => {
  it("will not charge one account in another account's name", async () => {
    const stub = stubRc({ advanced: advancedAnswer, lite: liteAnswer });

    const bought = await request<StartResult>({
      method: 'POST',
      url: CHECKS_URL,
      user: owner,
      payload: {
        kind: 'VEHICLE_RC_DETAILS',
        subjectType: 'ORGANIZATION',
        subjectId: otherFleet.id,
        registrationNumber: PLATE,
      },
    });

    expect(bought.status).toBe(404);
    expect(stub.asked()).toEqual([]);
    expect(await prisma.verificationCharge.count()).toBe(0);
  });

  it('refuses a role that may not look up registrations, before any payment', async () => {
    const driver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
    const stub = stubRc({ advanced: advancedAnswer, lite: liteAnswer });

    const bought = await request<StartResult>({
      method: 'POST',
      url: CHECKS_URL,
      user: driver,
      payload: {
        kind: 'VEHICLE_RC_DETAILS',
        subjectType: 'ORGANIZATION',
        subjectId: fleet.id,
        registrationNumber: PLATE,
      },
    });

    expect(bought.status).toBe(403);
    expect(stub.asked()).toEqual([]);
    expect(await prisma.verificationCharge.count()).toBe(0);
  });
});

describe('when full details cannot be had (the ₹10 rules)', () => {
  it('keeps the ₹20 as a free retry when Way2API cannot answer at all', async () => {
    const stub = stubRc({ advanced: backendDown, 'text-pdf': backendDown });

    const bought = await buyForPlate();

    expect(stub.asked()).toEqual(['advanced', 'text-pdf']);
    expect(bought.body.data.charge?.status).toBe(VerificationChargeStatus.RETRY_REQUIRED);
    expect(bought.body.data.charge?.freeRetryAvailable).toBe(true);
  });

  it('uses the attempt up when the RTO answers that it has no record', async () => {
    stubRc({ advanced: noRecord });

    const bought = await buyForPlate();

    expect(bought.body.data.charge?.status).toBe(VerificationChargeStatus.FAILED);
    expect(bought.body.data.charge?.freeRetryAvailable).toBe(false);
  });
});
