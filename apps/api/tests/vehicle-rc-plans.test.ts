import { afterEach, describe, expect, it, vi } from 'vitest';
import { VehicleRcService } from '@saarthi/shared';
import { logger } from '../src/lib/logger';
import type { VehicleRcPlan } from '../src/providers/vehicle-rc';
import { Way2ApiRcProvider } from '../src/providers/vehicle-rc/way2api-rc.provider';
import { jsonResponse, successEnvelope } from './way2api-rc-fixture';

/**
 * Which Way2API RC services each plan asks, and when it may move on.
 *
 * The plans are the tiers: the free lookup must never reach a paid service,
 * the paid one must fall back rather than leave a customer who has paid with
 * nothing, and no plan may ask again after an answer about the vehicle, which
 * the next service would repeat and charge for. Exercised on the adapter
 * itself, with `fetch` stubbed, so nothing is ever spent.
 */

const PLATE = 'UP32AB1234';

type Service = 'lite' | 'text-pdf' | 'advanced';

// What production received from 2026-10-03 while Text + PDF was down.
const backendDown = () =>
  jsonResponse(
    { status: 'FAILED', success: false, charged: false, message_code: 'REQUEST_FAILED', message: 'Backend Down.' },
    400,
  );
const noRecord = () =>
  jsonResponse({ success: false, charged: true, message_code: 'NO_RECORD_FOUND', message: 'No record found' }, 422);
const answered = () => jsonResponse(successEnvelope());

/** Answers each service as `answers` says; anything else is a test mistake. */
function stubServices(answers: Partial<Record<Service, () => Response>>) {
  const serviceOf = (input: unknown) => String(input).replace(/^.*\/api\/v1\/rc\//, '');
  const fetchMock = vi.fn(async (input: unknown) => {
    const answer = answers[serviceOf(input) as Service];
    return answer ? answer() : new Response('unexpected', { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { asked: () => fetchMock.mock.calls.map(([input]) => serviceOf(input)) };
}

const lookup = (plan: VehicleRcPlan) =>
  new Way2ApiRcProvider().lookup({ registrationNumber: PLATE, plan });

describe('RC lookup plans', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('BASIC, the free tier', () => {
    it('asks RC Details Lite', async () => {
      const stub = stubServices({ lite: answered });

      const result = await lookup('BASIC');

      expect(result.service).toBe(VehicleRcService.LITE);
      expect(stub.asked()).toEqual(['lite']);
    });

    it('never falls back, so a free lookup cannot reach a paid service', async () => {
      const stub = stubServices({ lite: backendDown, 'text-pdf': answered, advanced: answered });

      await expect(lookup('BASIC')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      expect(stub.asked()).toEqual(['lite']);
    });
  });

  describe('FULL, the paid tier', () => {
    it('asks RC Details Advanced', async () => {
      const stub = stubServices({ advanced: answered });

      const result = await lookup('FULL');

      expect(result.service).toBe(VehicleRcService.ADVANCED);
      expect(stub.asked()).toEqual(['advanced']);
    });

    it('falls back to Text + PDF when Advanced is down, rather than leave a paid lookup empty', async () => {
      const stub = stubServices({ advanced: backendDown, 'text-pdf': answered });

      const result = await lookup('FULL');

      expect(result.service).toBe(VehicleRcService.TEXT_PDF);
      expect(stub.asked()).toEqual(['advanced', 'text-pdf']);
    });

    it('does not ask again after an answer about the vehicle', async () => {
      const stub = stubServices({ advanced: noRecord, 'text-pdf': answered });

      await expect(lookup('FULL')).rejects.toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
      expect(stub.asked()).toEqual(['advanced']);
    });
  });

  describe('STANDARD, the ₹10 RC verification', () => {
    it("falls back to Lite when Text + PDF is down, and logs Way2API's reason", async () => {
      const stub = stubServices({ 'text-pdf': backendDown, lite: answered });
      const warn = vi.spyOn(logger, 'warn');

      const result = await lookup('STANDARD');

      expect(result.service).toBe(VehicleRcService.LITE);
      expect(stub.asked()).toEqual(['text-pdf', 'lite']);
      const logged = warn.mock.calls.find(
        ([, message]) => message === 'Vehicle RC Text + PDF failed; asking RC Details Lite',
      )?.[0];
      expect(logged).toMatchObject({ messageCode: 'REQUEST_FAILED', providerMessage: 'Backend Down.' });
    });

    it('falls back when Text + PDF answers with a gateway error page', async () => {
      const stub = stubServices({
        'text-pdf': () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
        lite: answered,
      });

      const result = await lookup('STANDARD');

      expect(result.service).toBe(VehicleRcService.LITE);
      expect(stub.asked()).toEqual(['text-pdf', 'lite']);
    });
  });
});
