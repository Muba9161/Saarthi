import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleName, type PetrolStationSearchResult } from '@saarthi/shared';
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
 * Petrol station directory — integration tests.
 *
 * The upstream directory is stubbed at `fetch`, so the route, guards,
 * normaliser, distance maths, de-duplication, cache and PostgreSQL mirror all
 * run for real while no external call is ever made.
 */

// Hazratganj, Lucknow.
const LAT = 26.8467;
const LNG = 80.9462;

/** One record in the directory's published shape — strings and all. */
function ssrStation(overrides: Record<string, unknown> = {}) {
  return {
    id: 81233,
    pump_name: 'U. P. PETROL SERVICE STATION BHARAT PETROLEUM DEALERS',
    name: 'U. P. PETROL SERVICE STATION BHARAT PETROLEUM DEALERS',
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
    ...overrides,
  };
}

function nearbyResponse(results: unknown[], totalWithinRadius = results.length) {
  return {
    count: results.length,
    total_within_radius: totalWithinRadius,
    limit_applied: 40,
    search_radius_km: 10.0,
    user_location: { latitude: LAT, longitude: LNG },
    results,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubDirectory(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (input: unknown) => {
    void input;
    return jsonResponse(body, status);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const url = (extra = '') =>
  `/api/v1/petrol-stations?latitude=${LAT}&longitude=${LNG}&radiusKm=10${extra}`;

describe('petrol stations', () => {
  let user: TestUser;

  beforeAll(async () => {
    await getApp();
    await resetDatabase();
    const organization = await createOrganization();
    user = await createUser({ role: RoleName.FLEET_OWNER, organizationId: organization.id });
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await cache.clear();
    await prisma.petrolStation.deleteMany({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // --- Happy path ----------------------------------------------------------

  it('normalises a station from the directory', async () => {
    stubDirectory(nearbyResponse([ssrStation()]));

    const response = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: url(),
      user,
    });

    expect(response.status).toBe(200);
    const station = response.body.data.stations[0]!;

    expect(station.id).toBe('ssr:81233');
    expect(station.externalId).toBe('81233');
    expect(station.company).toBe('BPCL');
    // String coordinates and prices become numbers.
    expect(station.latitude).toBeCloseTo(26.846159, 5);
    expect(station.petrolPrice).toBe(94.73);
    expect(station.dieselPrice).toBe(87.86);
    // CNG is not sold here, so no price is invented.
    expect(station.hasCng).toBe(false);
    expect(station.cngPrice).toBeNull();
    expect(station.timings).toBe('24 Hours');
    expect(station.distanceKm).toBeGreaterThanOrEqual(0);
    expect(station.distanceKm).toBeLessThan(1);
    expect(station.direction).toBeTruthy();
    expect(response.body.data.stale).toBe(false);
  });

  it('returns multiple stations ordered by distance', async () => {
    stubDirectory(
      nearbyResponse([
        ssrStation({ id: 2, latitude: '26.90000000', longitude: '80.99000000', pump_name: 'Far' }),
        ssrStation({ id: 1, latitude: '26.84700000', longitude: '80.94600000', pump_name: 'Near' }),
        ssrStation({ id: 3, latitude: '26.87000000', longitude: '80.96000000', pump_name: 'Mid' }),
      ]),
    );

    const response = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: url(),
      user,
    });

    const names = response.body.data.stations.map((station) => station.name);
    expect(names).toEqual(['Near', 'Mid', 'Far']);

    const distances = response.body.data.stations.map((station) => station.distanceKm ?? 0);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('reports CNG availability and price when the directory publishes them', async () => {
    stubDirectory(
      nearbyResponse([ssrStation({ has_cng: true, cng_price: '91.50' })]),
    );

    const response = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: url(),
      user,
    });

    const station = response.body.data.stations[0]!;
    expect(station.hasCng).toBe(true);
    expect(station.cngPrice).toBe(91.5);
  });

  it('accepts the short lat/lng/radius query spellings', async () => {
    stubDirectory(nearbyResponse([ssrStation()]));

    const response = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: `/api/v1/petrol-stations?lat=${LAT}&lng=${LNG}&radius=10`,
      user,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.stations).toHaveLength(1);
  });

  it('passes a fuel filter through to the directory', async () => {
    const fetchMock = stubDirectory(nearbyResponse([ssrStation({ has_cng: true, cng_price: '91.50' })]));

    await request({ method: 'GET', url: url('&fuelType=cng'), user });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('fuel_type=cng');
  });

  // --- Data hygiene --------------------------------------------------------

  it('collapses duplicate records for the same site', async () => {
    stubDirectory(
      nearbyResponse([
        ssrStation({ id: 10 }),
        // Same id repeated by the directory.
        ssrStation({ id: 10 }),
        // Different id, identical name and position — a dealer-level duplicate.
        ssrStation({ id: 11 }),
      ]),
    );

    const response = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: url(),
      user,
    });

    expect(response.body.data.stations).toHaveLength(1);
  });

  it('drops records that cannot be placed on a map', async () => {
    stubDirectory(
      nearbyResponse([
        ssrStation({ id: 20, latitude: '0.00000000', longitude: '0.00000000' }),
        ssrStation({ id: 21, latitude: null, longitude: null }),
        ssrStation({ id: 22 }),
      ]),
    );

    const response = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: url(),
      user,
    });

    expect(response.body.data.stations).toHaveLength(1);
    expect(response.body.data.stations[0]!.externalId).toBe('22');
  });

  it('treats a zero price as "not published" rather than free fuel', async () => {
    stubDirectory(nearbyResponse([ssrStation({ petrol_price: '0.00' })]));

    const response = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: url(),
      user,
    });

    expect(response.body.data.stations[0]!.petrolPrice).toBeNull();
  });

  // --- Empty and failure paths --------------------------------------------

  it('returns an empty result when the area has no stations', async () => {
    stubDirectory(nearbyResponse([], 0));

    const response = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: url(),
      user,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.stations).toEqual([]);
    expect(response.body.data.totalWithinRadius).toBe(0);
  });

  it('treats the directory 404 as "no stations here"', async () => {
    stubDirectory({ detail: 'Not found.' }, 404);

    const response = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: url(),
      user,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.stations).toEqual([]);
  });

  it('reports a directory outage when nothing is stored yet', async () => {
    stubDirectory({ detail: 'boom' }, 500);

    const response = await request({ method: 'GET', url: url(), user });

    expect(response.status).toBe(503);
    expect(response.body.error?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('reports a directory timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }),
    );

    const response = await request({ method: 'GET', url: url(), user });

    expect(response.status).toBe(504);
    expect(response.body.error?.code).toBe('PROVIDER_TIMEOUT');
  });

  it('handles a malformed directory response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('not json at all', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );

    const response = await request({ method: 'GET', url: url(), user });

    expect(response.status).toBe(502);
    expect(response.body.error?.code).toBe('PROVIDER_ERROR');
  });

  it('handles a response with no results collection', async () => {
    stubDirectory({ count: 3 });

    const response = await request({ method: 'GET', url: url(), user });

    expect(response.status).toBe(502);
  });

  // --- Cache and mirror ----------------------------------------------------

  it('mirrors stations to the database and reuses them when the directory fails', async () => {
    stubDirectory(nearbyResponse([ssrStation()]));
    await request({ method: 'GET', url: url(), user });

    const mirrored = await prisma.petrolStation.findMany({});
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]!.externalId).toBe('81233');
    expect(mirrored[0]!.rawData).not.toBeNull();

    // Directory goes down; the cached HTTP answer must not mask the test.
    await cache.clear();
    stubDirectory({ detail: 'boom' }, 500);

    const response = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: url(),
      user,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.stale).toBe(true);
    expect(response.body.data.stations).toHaveLength(1);
  });

  it('re-imports the same station idempotently', async () => {
    stubDirectory(nearbyResponse([ssrStation({ petrol_price: '94.73' })]));
    await request({ method: 'GET', url: url(), user });

    await cache.clear();
    stubDirectory(nearbyResponse([ssrStation({ petrol_price: '96.10' })]));
    await request({ method: 'GET', url: url(), user });

    const mirrored = await prisma.petrolStation.findMany({});
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]!.petrolPrice).toBe(96.1);
  });

  it('serves a repeated search from cache without calling the directory again', async () => {
    const fetchMock = stubDirectory(nearbyResponse([ssrStation()]));

    const first = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: url(),
      user,
    });
    const second = await request<PetrolStationSearchResult>({
      method: 'GET',
      url: url(),
      user,
    });

    expect(first.body.data.cached).toBe(false);
    expect(second.body.data.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a different area as a cache miss', async () => {
    const fetchMock = stubDirectory(nearbyResponse([ssrStation()]));

    await request({ method: 'GET', url: url(), user });
    await request({
      method: 'GET',
      url: `/api/v1/petrol-stations?latitude=19.076&longitude=72.8777&radiusKm=10`,
      user,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // --- Validation and access ----------------------------------------------

  it('rejects coordinates outside the valid range', async () => {
    stubDirectory(nearbyResponse([]));

    const response = await request({
      method: 'GET',
      url: '/api/v1/petrol-stations?latitude=999&longitude=80.9&radiusKm=10',
      user,
    });

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a radius beyond the supported range', async () => {
    stubDirectory(nearbyResponse([]));

    const response = await request({
      method: 'GET',
      url: url().replace('radiusKm=10', 'radiusKm=500'),
      user,
    });

    expect(response.status).toBe(400);
  });

  it('refuses an unauthenticated search', async () => {
    stubDirectory(nearbyResponse([ssrStation()]));

    const response = await request({ method: 'GET', url: url() });

    expect(response.status).toBe(401);
  });
});
