import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleName } from '@saarthi/shared';
import type { VehicleLookupResult } from '@saarthi/shared';
import { config } from '../src/config/env';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  resetDatabase,
  request,
  type TestUser,
} from './helpers';

/**
 * Vehicle RC lookup — integration tests.
 *
 * Every outbound call is stubbed: the suite must never spend a paid provider
 * lookup. `fetch` is the only seam that matters, so stubbing it exercises the
 * real route, guard, service, normaliser, cache and storage code paths.
 */

const PLATE = 'UP32AB1234';
/** Plates registered to the test fleet — anything else must be refused. */
const FLEET_PLATES = ['UP32AB1234', 'DL3CAB1234', 'MH12AB4321'];
/** A real-looking plate that belongs to somebody else. */
const FOREIGN_PLATE = 'KA01AB9999';

/** The provider's documented success envelope, with a plausible RC record. */
function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    status: 'SUCCESS',
    status_code: 200,
    charged: true,
    success: true,
    message: '',
    message_code: 'OK',
    order_id: 'W2A1739512345abcdef01',
    data: {
      order_id: 'W2A1739512345abcdef01',
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
        non_use_from: null,
        non_use_to: null,
        blacklist_status: '',
        noc_details: '',
        challan_details: null,
        response_metadata: {
          masked_chassis: false,
          masked_engine: false,
          masked_owner_name: false,
        },
        pdf_url: 'https://docs.way2api.test/upload/rc2_1786426531.pdf',
        ...overrides,
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A minimal but structurally valid PDF, so magic-byte detection passes. */
function pdfResponse(): Response {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n', 'latin1');
  return new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
}

function isRcLookupCall(input: unknown): boolean {
  return String(input).includes('/api/v1/rc/text-pdf');
}

/** Answers the RC endpoint with `envelope` and any PDF fetch with a real PDF. */
function stubProvider(envelope: unknown, options: { pdfOk?: boolean } = {}) {
  const { pdfOk = true } = options;
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    void init;
    if (isRcLookupCall(input)) return jsonResponse(envelope);
    return pdfOk ? pdfResponse() : new Response('nope', { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('vehicle RC lookup', () => {
  let owner: TestUser;
  let manager: TestUser;

  beforeAll(async () => {
    await getApp();
    await resetDatabase();
    const organization = await createOrganization();
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: organization.id });
    manager = await createUser({ role: RoleName.FLEET_MANAGER, organizationId: organization.id });

    // A lookup is only permitted for a vehicle the fleet actually owns, so the
    // plates these tests use have to exist in it first.
    await prisma.truck.createMany({
      data: FLEET_PLATES.map((registrationNumber) => ({
        organizationId: organization.id,
        registrationNumber,
        capacityTons: 12,
      })),
    });
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await prisma.vehicleLookup.deleteMany({});
    await cache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // --- Normalisation -------------------------------------------------------

  it('returns a normalised record for a valid registration number', async () => {
    stubProvider(successEnvelope());

    const response = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(response.status).toBe(200);
    const { vehicle } = response.body.data;

    expect(response.body.data.registrationNumber).toBe(PLATE);
    expect(vehicle.maker).toBe('MARUTI SUZUKI INDIA LTD');
    expect(vehicle.model).toBe('SWIFT VXI');
    expect(vehicle.fuelType).toBe('PETROL');
    expect(vehicle.registrationStatus).toBe('ACTIVE');
    // Strings on the wire become numbers in our model.
    expect(vehicle.cubicCapacity).toBe(1197);
    expect(vehicle.seatingCapacity).toBe(5);
    expect(vehicle.grossVehicleWeight).toBe(1355);
    expect(vehicle.insuranceValidUntil).toBe('2029-03-18');
    expect(vehicle.fitnessValidUntil).toBe('2037-03-19');
    expect(vehicle.tax.validUntil).toBe('2037-03-19');
    // Blank provider strings must become null, not empty strings.
    expect(vehicle.rtoCode).toBeNull();
    expect(vehicle.permit.number).toBeNull();
    expect(vehicle.blacklistStatus).toBeNull();
  });

  it('normalises a lowercase, spaced and hyphenated registration number', async () => {
    const fetchMock = stubProvider(successEnvelope());

    const response = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: '  up-32 ab 1234 ' },
    });

    expect(response.status).toBe(200);
    expect(response.body.data.registrationNumber).toBe(PLATE);

    // The provider must receive the normalised plate, not the raw input.
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { rc_number: string };
    expect(body.rc_number).toBe(PLATE);
  });

  it('rejects a registration number that is not plausibly Indian', async () => {
    const fetchMock = stubProvider(successEnvelope());

    const response = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: '!!!' },
    });

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('VALIDATION_ERROR');
    // No provider call means no charge for obviously bad input.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // --- Provider failures ---------------------------------------------------

  it('maps a negative verification to VEHICLE_NOT_FOUND', async () => {
    stubProvider({
      status: 'SUCCESS',
      status_code: 422,
      charged: true,
      success: false,
      message: 'No vehicle record was found for the registration number provided.',
      message_code: 'VERIFICATION_FAILED',
      order_id: 'W2A-none',
      data: { order_id: 'W2A-none', error_code: 'no_record' },
    });

    const response = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(response.status).toBe(404);
    expect(response.body.error?.code).toBe('VEHICLE_NOT_FOUND');
  });

  it('maps a provider timeout to PROVIDER_TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      }),
    );

    const response = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(response.status).toBe(504);
    expect(response.body.error?.code).toBe('PROVIDER_TIMEOUT');
  });

  it('maps a provider rate limit to PROVIDER_RATE_LIMITED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: false, message_code: 'RATE_LIMITED', message: 'slow down' }, 429),
      ),
    );

    const response = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(response.status).toBe(429);
    expect(response.body.error?.code).toBe('PROVIDER_RATE_LIMITED');
  });

  it('never leaks a credential problem to the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: false, message_code: 'INVALID_API_KEY', message: 'bad key' }, 401),
      ),
    );

    const response = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(response.status).toBe(503);
    expect(response.body.error?.code).toBe('PROVIDER_UNAVAILABLE');
    expect(response.body.error?.message).not.toMatch(/key/i);
  });

  it('handles a malformed provider response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>gateway error</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );

    const response = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(response.status).toBe(502);
    expect(response.body.error?.code).toBe('PROVIDER_ERROR');
  });

  it('handles a success envelope with no result payload', async () => {
    stubProvider({
      status: 'SUCCESS',
      status_code: 200,
      success: true,
      message_code: 'OK',
      order_id: 'W2A-empty',
      data: { order_id: 'W2A-empty' },
    });

    const response = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(response.status).toBe(502);
    expect(response.body.error?.code).toBe('PROVIDER_ERROR');
  });

  // --- RC document ---------------------------------------------------------

  it('stores the RC document and serves it from Saarthi', async () => {
    stubProvider(successEnvelope());

    const lookup = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(lookup.body.data.pdfAvailable).toBe(true);

    const stored = await prisma.vehicleLookup.findUniqueOrThrow({
      where: { id: lookup.body.data.lookupId },
    });
    expect(stored.pdfStorageKey).toBeTruthy();
    // The provider's temporary link is never persisted as the access path.
    expect(stored.pdfStorageKey).not.toContain('way2api.test');

    const app = await getApp();
    const download = await app.inject({
      method: 'GET',
      url: `/api/v1/vehicles/lookups/${lookup.body.data.lookupId}/document`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });

    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['cache-control']).toBe('private, no-store');
    expect(download.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('still returns the record when the document download fails', async () => {
    stubProvider(successEnvelope(), { pdfOk: false });

    const response = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(response.status).toBe(200);
    expect(response.body.data.pdfAvailable).toBe(false);
    expect(response.body.data.vehicle.maker).toBe('MARUTI SUZUKI INDIA LTD');
  });

  it('reports PDF_UNAVAILABLE when no document was stored', async () => {
    stubProvider(successEnvelope({ pdf_url: '' }));

    const lookup = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });
    expect(lookup.body.data.pdfAvailable).toBe(false);

    const download = await request({
      method: 'GET',
      url: `/api/v1/vehicles/lookups/${lookup.body.data.lookupId}/document`,
      user: owner,
    });

    expect(download.status).toBe(404);
    expect(download.body.error?.code).toBe('PDF_UNAVAILABLE');
  });

  // --- Caching -------------------------------------------------------------

  it('serves a repeat lookup from cache without calling the provider again', async () => {
    const fetchMock = stubProvider(successEnvelope());

    const first = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });
    const rcCallsAfterFirst = fetchMock.mock.calls.filter((call) => isRcLookupCall(call[0])).length;

    const second = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(first.body.data.cached).toBe(false);
    expect(second.body.data.cached).toBe(true);
    expect(second.body.data.lookupId).toBe(first.body.data.lookupId);
    expect(fetchMock.mock.calls.filter((call) => isRcLookupCall(call[0])).length).toBe(
      rcCallsAfterFirst,
    );
  });

  it('bills a fresh lookup when refresh is requested', async () => {
    const fetchMock = stubProvider(successEnvelope());

    await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });
    const second = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE, refresh: true },
    });

    expect(second.body.data.cached).toBe(false);
    expect(fetchMock.mock.calls.filter((call) => isRcLookupCall(call[0])).length).toBe(2);
  });

  it('treats an expired cache entry as a miss', async () => {
    const fetchMock = stubProvider(successEnvelope());

    const first = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    await prisma.vehicleLookup.update({
      where: { id: first.body.data.lookupId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const second = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(second.body.data.cached).toBe(false);
    expect(fetchMock.mock.calls.filter((call) => isRcLookupCall(call[0])).length).toBe(2);
  });

  // --- Billable-call ceiling ----------------------------------------------

  describe('provider call budget', () => {
    // The suite runs uncapped; these cases opt in so the ceiling itself is
    // exercised without constraining every other test.
    const originalBudget = config.vehicleRc.callBudget;

    // The ceiling counts audit entries, so earlier tests in this file would
    // otherwise leave the allowance already spent.
    beforeEach(async () => {
      await prisma.auditLog.deleteMany({ where: { action: 'vehicle.rc_lookup' } });
    });

    afterEach(async () => {
      Object.assign(config.vehicleRc, { callBudget: originalBudget });
      await prisma.auditLog.deleteMany({ where: { action: 'vehicle.rc_lookup' } });
    });

    it('refuses a billable call once the allowance is spent', async () => {
      Object.assign(config.vehicleRc, { callBudget: 2 });
      const fetchMock = stubProvider(successEnvelope());

      // Two distinct plates, so neither is served from cache.
      for (const plate of ['UP32AB1234', 'DL3CAB1234']) {
        const response = await request({
          method: 'POST',
          url: '/api/v1/vehicles/lookup',
          user: owner,
          payload: { registrationNumber: plate },
        });
        expect(response.status).toBe(200);
      }

      const blocked = await request({
        method: 'POST',
        url: '/api/v1/vehicles/lookup',
        user: owner,
        payload: { registrationNumber: 'MH12AB4321' },
      });

      expect(blocked.status).toBe(429);
      expect(blocked.body.error?.code).toBe('PROVIDER_BUDGET_EXHAUSTED');
      // The third call must never have reached the provider.
      expect(fetchMock.mock.calls.filter((call) => isRcLookupCall(call[0])).length).toBe(2);
    });

    it('reports the remaining allowance', async () => {
      Object.assign(config.vehicleRc, { callBudget: 3 });
      stubProvider(successEnvelope());

      const app = await getApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/vehicles/lookup',
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { registrationNumber: PLATE },
      });

      const body = response.json() as { meta?: { budgetRemaining?: number } };
      expect(body.meta?.budgetRemaining).toBe(2);
    });

    it('does not spend the allowance on a cache hit', async () => {
      Object.assign(config.vehicleRc, { callBudget: 1 });
      const fetchMock = stubProvider(successEnvelope());

      const first = await request({
        method: 'POST',
        url: '/api/v1/vehicles/lookup',
        user: owner,
        payload: { registrationNumber: PLATE },
      });
      // The allowance is now spent, but the same plate is cached — so a repeat
      // must still succeed rather than being refused.
      const second = await request<VehicleLookupResult>({
        method: 'POST',
        url: '/api/v1/vehicles/lookup',
        user: owner,
        payload: { registrationNumber: PLATE },
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.data.cached).toBe(true);
      expect(fetchMock.mock.calls.filter((call) => isRcLookupCall(call[0])).length).toBe(1);
    });

    it('refuses a refresh that would exceed the allowance', async () => {
      Object.assign(config.vehicleRc, { callBudget: 1 });
      stubProvider(successEnvelope());

      await request({
        method: 'POST',
        url: '/api/v1/vehicles/lookup',
        user: owner,
        payload: { registrationNumber: PLATE },
      });

      const refreshed = await request({
        method: 'POST',
        url: '/api/v1/vehicles/lookup',
        user: owner,
        payload: { registrationNumber: PLATE, refresh: true },
      });

      expect(refreshed.status).toBe(429);
      expect(refreshed.body.error?.code).toBe('PROVIDER_BUDGET_EXHAUSTED');
    });

    it('applies no ceiling when the budget is zero', async () => {
      Object.assign(config.vehicleRc, { callBudget: 0 });
      const fetchMock = stubProvider(successEnvelope());

      for (const plate of ['UP32AB1234', 'DL3CAB1234', 'MH12AB4321']) {
        const response = await request({
          method: 'POST',
          url: '/api/v1/vehicles/lookup',
          user: owner,
          payload: { registrationNumber: plate },
        });
        expect(response.status).toBe(200);
      }

      expect(fetchMock.mock.calls.filter((call) => isRcLookupCall(call[0])).length).toBe(3);
    });
  });

  // --- Privacy -------------------------------------------------------------

  it('withholds owner and identity fields from callers without the permission', async () => {
    stubProvider(successEnvelope());

    const response = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: manager,
      payload: { registrationNumber: PLATE },
    });

    expect(response.status).toBe(200);
    const { vehicle } = response.body.data;
    expect(vehicle.redacted).toBe(true);
    expect(vehicle.owner).toBeNull();
    expect(vehicle.engineNumber).toBeNull();
    expect(vehicle.chassisNumber).toBeNull();
    // Non-personal fields are still useful and still present.
    expect(vehicle.maker).toBe('MARUTI SUZUKI INDIA LTD');
  });

  it('gives the full record to a caller holding the sensitive permission', async () => {
    stubProvider(successEnvelope());

    const response = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    const { vehicle } = response.body.data;
    expect(vehicle.redacted).toBe(false);
    expect(vehicle.owner?.name).toBe('SNEHA MOHANTY');
    expect(vehicle.engineNumber).toBe('G3AB1C234567');
    expect(vehicle.chassisNumber).toBe('ME1AB1234C5678901');
  });

  it('refuses a plate that is not in the caller fleet', async () => {
    const fetchMock = stubProvider(successEnvelope());

    const response = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: FOREIGN_PLATE },
    });

    expect(response.status).toBe(403);
    expect(response.body.error?.message).toContain(FOREIGN_PLATE);
    // The provider must never be paid to answer a question we should not ask.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a plate owned by a different organization', async () => {
    const otherOrganization = await createOrganization();
    await prisma.truck.create({
      data: {
        organizationId: otherOrganization.id,
        registrationNumber: 'TN22XY7777',
        capacityTons: 9,
      },
    });
    const fetchMock = stubProvider(successEnvelope());

    const response = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: 'TN22XY7777' },
    });

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops serving a cached record once the vehicle leaves the fleet', async () => {
    stubProvider(successEnvelope());

    const first = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });
    expect(first.status).toBe(200);

    // Archive the vehicle; the warm cache entry must stop being reachable.
    await prisma.truck.updateMany({
      where: { registrationNumber: PLATE },
      data: { archivedAt: new Date() },
    });

    const afterArchive = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });
    expect(afterArchive.status).toBe(403);

    await prisma.truck.updateMany({
      where: { registrationNumber: PLATE },
      data: { archivedAt: null },
    });
  });

  it('refuses an unauthenticated lookup', async () => {
    stubProvider(successEnvelope());

    const response = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      payload: { registrationNumber: PLATE },
    });

    expect(response.status).toBe(401);
  });

  it('records the lookup in the audit trail without the RC payload', async () => {
    stubProvider(successEnvelope());

    await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'vehicle.rc_lookup' },
      orderBy: { createdAt: 'desc' },
    });

    expect(entry).not.toBeNull();
    const after = JSON.stringify(entry?.afterData ?? {});
    expect(after).toContain(PLATE);
    // The owner's name must never reach the audit log.
    expect(after).not.toContain('SNEHA');
  });
});
