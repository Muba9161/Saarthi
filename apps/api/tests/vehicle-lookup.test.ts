import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RcDetailAccess, RoleName, VehicleOwnershipStatus } from '@saarthi/shared';
import type { VehicleLookupResult } from '@saarthi/shared';
import { config } from '../src/config/env';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import { logger } from '../src/lib/logger';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  resetDatabase,
  request,
  unlockSecureAccess,
  type TestUser,
} from './helpers';
import { isRcLookupCall, jsonResponse, stubProvider, successEnvelope } from './way2api-rc-fixture';

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
    // plates these tests use have to exist in it first — and, for the owner's
    // details to be unmaskable at all, with their ownership confirmed.
    await prisma.truck.createMany({
      data: FLEET_PLATES.map((registrationNumber) => ({
        organizationId: organization.id,
        registrationNumber,
        capacityTons: 12,
        ownershipStatus: VehicleOwnershipStatus.VERIFIED,
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

  describe('when Text + PDF is down', () => {
    /** Text + PDF answers with `textPdf`; Lite with its documented record, which has no `pdf_url`. */
    function stubTextPdfDown(textPdf: () => Response) {
      const fetchMock = vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith('/api/v1/rc/text-pdf')) return textPdf();
        if (url.endsWith('/api/v1/rc/lite')) return jsonResponse(successEnvelope({ pdf_url: undefined }));
        return new Response('unexpected', { status: 500 });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    const lookup = () =>
      request<VehicleLookupResult>({
        method: 'POST',
        url: '/api/v1/vehicles/lookup',
        user: owner,
        payload: { registrationNumber: PLATE },
      });

    const rcCalls = (fetchMock: ReturnType<typeof stubTextPdfDown>) =>
      fetchMock.mock.calls.map(([input]) => String(input).replace(/^.*\/api\/v1\/rc\//, ''));

    it('falls back to RC Details Lite, which carries the record but no certificate', async () => {
      // What production received from 2026-10-03.
      const fetchMock = stubTextPdfDown(() =>
        jsonResponse(
          { status: 'FAILED', success: false, charged: false, message_code: 'REQUEST_FAILED', message: 'Backend Down.' },
          400,
        ),
      );

      const response = await lookup();

      expect(response.status).toBe(200);
      expect(rcCalls(fetchMock)).toEqual(['text-pdf', 'lite']);
      expect(response.body.data.vehicle.maker).toBe('MARUTI SUZUKI INDIA LTD');
      expect(response.body.data.pdfAvailable).toBe(false);
    });

    it('falls back when Text + PDF answers with a gateway error page', async () => {
      const fetchMock = stubTextPdfDown(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }));

      const response = await lookup();

      expect(response.status).toBe(200);
      expect(rcCalls(fetchMock)).toEqual(['text-pdf', 'lite']);
    });

    it('does not ask Lite after an answer about the vehicle, which Lite would repeat and charge for', async () => {
      const fetchMock = stubTextPdfDown(() =>
        jsonResponse(
          { success: false, charged: true, message_code: 'NO_RECORD_FOUND', message: 'No record found' },
          422,
        ),
      );

      const response = await lookup();

      expect(response.status).toBe(404);
      expect(rcCalls(fetchMock)).toEqual(['text-pdf']);
    });
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

  it("logs Way2API's own reason for an outage, plate masked, and never sends it to the caller", async () => {
    // What production received on 2026-10-07, here from both RC services.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            status: 'FAILED',
            success: false,
            charged: false,
            message_code: 'REQUEST_FAILED',
            message: `Backend Down for ${PLATE}.`,
          },
          400,
        ),
      ),
    );
    const warn = vi.spyOn(logger, 'warn');

    const response = await request({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    expect(response.status).toBe(503);
    expect(response.body.error?.message).not.toMatch(/Backend/);
    const loggedAs = (message: string) =>
      warn.mock.calls.find(([, logged]) => logged === message)?.[0];
    const reason = { messageCode: 'REQUEST_FAILED', providerMessage: 'Backend Down for UP••••34.' };
    expect(loggedAs('Vehicle RC Text + PDF failed; asking RC Details Lite')).toMatchObject(reason);
    expect(loggedAs('Vehicle RC provider is unavailable')).toMatchObject(reason);
    warn.mockRestore();
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

    // The certificate carries the owner's details, so it takes the secure PIN.
    const locked = await request({
      method: 'GET',
      url: `/api/v1/vehicles/lookups/${lookup.body.data.lookupId}/document`,
      user: owner,
    });
    expect(locked.status).toBe(403);
    expect(locked.body.error?.code).toBe('SECURE_ACCESS_REQUIRED');

    await unlockSecureAccess(owner);
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

    await unlockSecureAccess(owner);
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

  it('masks the owner for a permitted caller until they enter their secure PIN', async () => {
    stubProvider(successEnvelope());
    // A session of its own: the PIN opens details on the session that entered it.
    const fresh = await createUser({ role: RoleName.FLEET_OWNER, organizationId: owner.organizationId });

    const response = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: fresh,
      payload: { registrationNumber: PLATE },
    });

    const { vehicle, access } = response.body.data;
    expect(access).toBe(RcDetailAccess.LOCKED);
    expect(vehicle.redacted).toBe(true);
    // Enough for the owner to recognise, too little for a stranger to trace.
    expect(vehicle.owner?.name).toBe('SNEHA M.');
    expect(vehicle.owner?.presentAddress).toBe('PIN 754119');
    expect(vehicle.chassisNumber).toMatch(/8901$/);
    expect(JSON.stringify(response.body)).not.toContain('Jagatsinghapur');
  });

  it('gives the full record to a permitted caller who has entered their secure PIN', async () => {
    stubProvider(successEnvelope());
    await unlockSecureAccess(owner);

    const response = await request<VehicleLookupResult>({
      method: 'POST',
      url: '/api/v1/vehicles/lookup',
      user: owner,
      payload: { registrationNumber: PLATE },
    });

    const { vehicle } = response.body.data;
    expect(response.body.data.access).toBe(RcDetailAccess.FULL);
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
