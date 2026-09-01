import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleName, type CityFuelRate } from '@saarthi/shared';
import { cache } from '../src/infra/cache';
import { citySlug, parseFuelRate, parsePublishedOn } from '../src/providers/fuel-rates';
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
 * City fuel rates.
 *
 * These tests exist because of a specific failure: Saarthi previously showed
 * fuel prices from the station directory that were a single city figure, years
 * stale — Gurugram petrol at ₹95.44 against a real ₹102.97 — with no timestamp
 * to reveal it. A fuel price drives trip costing, so the bar here is that a
 * wrong number must be *impossible to publish*, not merely unlikely.
 *
 * Every guard below corresponds to a real way this publisher can mislead:
 *
 *  * The first rupee figure on the page is a week-old trend row.
 *  * An unrecognised city answers 200 with the New Delhi page.
 *  * A layout change can yield a number that is not a price at all.
 */

/** The publisher's page, reduced to the parts the adapter reads. */
function ratePage({
  fuel = 'Petrol',
  city = 'Lucknow',
  price = '102.31',
  date = '31 August, 2026',
  trendRow = '101.86',
}: {
  fuel?: string;
  city?: string;
  price?: string;
  date?: string;
  trendRow?: string | null;
} = {}): string {
  return `<!doctype html><html><head>
    <title>${fuel} price in ${city} Today (${date}) | CarDekho.com</title>
    </head><body>
    <h1>${fuel} Price in ${city} Today</h1>
    ${
      // The trap: a plausible-looking stale figure that appears *before* the
      // labelled sentence in document order.
      trendRow
        ? `<section><h2>Trend of ${fuel} Rate in ${city}</h2>
             <table><tbody><tr><td>24 August</td><td>&#8377;${trendRow} /L</td></tr></tbody></table>
           </section>`
        : ''
    }
    <p>The average ${fuel} price in ${city} stands at &#8377; ${price} per litre today.</p>
    </body></html>`;
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

/**
 * Stub the publisher, answering per fuel from the requested URL.
 *
 * `pages` maps a fuel to its markup; a fuel absent from the map is served the
 * New Delhi fallback with a 200, exactly as the real publisher does.
 */
function stubPublisher(pages: Partial<Record<'petrol' | 'diesel' | 'cng', string>>) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const fuel of ['petrol', 'diesel', 'cng'] as const) {
      if (url.includes(`/${fuel}-price-in-`)) {
        const page = pages[fuel];
        if (page !== undefined) return htmlResponse(page);
        // The fallback: a real page, for the wrong city.
        return htmlResponse(
          ratePage({ fuel: fuel === 'cng' ? 'CNG' : fuel, city: 'New Delhi', price: '102.12' }),
        );
      }
    }
    return htmlResponse('<html><body>unknown</body></html>', 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const url = (city: string, state?: string) =>
  `/api/v1/fuel-rates?city=${encodeURIComponent(city)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;

// ---------------------------------------------------------------------------
// Parser — the guards, in isolation
// ---------------------------------------------------------------------------

describe('fuel rate parsing', () => {
  it('reads the labelled figure, not the stale trend row that precedes it', () => {
    // ₹101.86 appears first in the document and is a week old.
    const parsed = parseFuelRate(ratePage({ trendRow: '101.86' }), 'petrol', 'lucknow');

    expect(parsed).toEqual({ status: 'ok', price: 102.31 });
  });

  it('refuses a page served for a different city', () => {
    // What the publisher returns for any slug it does not recognise.
    const parsed = parseFuelRate(
      ratePage({ city: 'New Delhi', price: '102.12' }),
      'petrol',
      'nowhereville',
    );

    expect(parsed).toEqual({ status: 'wrong-city', found: 'New Delhi' });
  });

  it('accepts the publisher spelling of a city Saarthi names differently', () => {
    // Saarthi asks for Gurugram; the publisher keys on Gurgaon.
    expect(citySlug('Gurugram')).toBe('gurgaon');
    expect(citySlug('GURGAON')).toBe('gurgaon');
    expect(citySlug('Bengaluru')).toBe('bangalore');

    const parsed = parseFuelRate(ratePage({ city: 'Gurgaon' }), 'petrol', citySlug('Gurugram'));
    expect(parsed.status).toBe('ok');
  });

  it('rejects a figure outside its plausible band', () => {
    // A layout change that yields a year instead of a rate.
    const parsed = parseFuelRate(ratePage({ price: '2026' }), 'petrol', 'lucknow');
    expect(parsed.status).not.toBe('ok');

    const low = parseFuelRate(ratePage({ price: '20' }), 'petrol', 'lucknow');
    expect(low).toEqual({ status: 'implausible', price: 20 });
  });

  it('reports absence when the labelled sentence is gone entirely', () => {
    const parsed = parseFuelRate('<html><body>Site under maintenance</body></html>', 'petrol', 'lucknow');
    expect(parsed).toEqual({ status: 'absent' });
  });

  it('reads the publisher date, and invents none when absent', () => {
    expect(parsePublishedOn(ratePage({ date: '31 August, 2026' }))).toBe('2026-08-31');
    expect(parsePublishedOn(ratePage({ date: '1 January, 2027' }))).toBe('2027-01-01');
    // No date on the page must not become today's date.
    expect(parsePublishedOn('<html><body>no date here</body></html>')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Route — end to end through guards, service and cache
// ---------------------------------------------------------------------------

describe('city fuel rates', () => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns all three fuels with the publisher date', async () => {
    stubPublisher({
      petrol: ratePage({ fuel: 'Petrol', price: '102.31' }),
      diesel: ratePage({ fuel: 'Diesel', price: '95.79' }),
      cng: ratePage({ fuel: 'CNG', price: '99.50' }),
    });

    const response = await request<CityFuelRate>({
      method: 'GET',
      url: url('Lucknow', 'Uttar Pradesh'),
      user,
    });

    expect(response.status).toBe(200);
    const rate = response.body.data;

    expect(rate.city).toBe('Lucknow');
    expect(rate.state).toBe('Uttar Pradesh');
    expect(rate.petrol).toEqual({ price: 102.31, unit: 'litre' });
    expect(rate.diesel).toEqual({ price: 95.79, unit: 'litre' });
    // CNG is retailed by weight, and the unit must say so.
    expect(rate.cng).toEqual({ price: 99.5, unit: 'kg' });
    expect(rate.publishedOn).toBe('2026-08-31');
    expect(rate.source).toBe('CarDekho');
    expect(rate.cached).toBe(false);
  });

  it('returns no rate for a city the publisher does not cover', async () => {
    // Every fuel falls through to the New Delhi page.
    stubPublisher({});

    const response = await request<CityFuelRate | null>({
      method: 'GET',
      url: url('Nowhereville'),
      user,
    });

    // A successful answer of "we have no price", not an error.
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    // And emphatically not New Delhi's ₹102.12 under another city's name.
    expect(JSON.stringify(response.body)).not.toContain('102.12');
  });

  it('publishes the fuels it could read and drops the ones it could not', async () => {
    stubPublisher({
      petrol: ratePage({ fuel: 'Petrol', city: 'Agra', price: '101.54' }),
      diesel: ratePage({ fuel: 'Diesel', city: 'Agra', price: '95.02' }),
      // Agra genuinely has no CNG figure, so that page falls through to the
      // national one — which the city guard then refuses.
    });

    const response = await request<CityFuelRate>({
      method: 'GET',
      url: url('Agra'),
      user,
    });

    expect(response.body.data.petrol?.price).toBe(101.54);
    expect(response.body.data.diesel?.price).toBe(95.02);
    expect(response.body.data.cng).toBeNull();
  });

  it('serves a repeat lookup from cache without touching the publisher', async () => {
    const fetchMock = stubPublisher({ petrol: ratePage({ price: '102.31' }) });

    await request({ method: 'GET', url: url('Lucknow'), user });
    const callsAfterFirst = fetchMock.mock.calls.length;

    const second = await request<CityFuelRate>({
      method: 'GET',
      url: url('Lucknow'),
      user,
    });

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    expect(second.body.data.cached).toBe(true);
    expect(second.body.data.petrol?.price).toBe(102.31);
  });

  it('shares one cache entry across the spellings of a city', async () => {
    const fetchMock = stubPublisher({ petrol: ratePage({ city: 'Gurgaon', price: '103.28' }) });

    await request({ method: 'GET', url: url('Gurgaon'), user });
    const callsAfterFirst = fetchMock.mock.calls.length;

    // Same city, shouted. Must not bill a second lookup.
    await request({ method: 'GET', url: url('GURGAON'), user });

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('caches the absence too, so an uncovered city is not re-fetched', async () => {
    const fetchMock = stubPublisher({});

    await request({ method: 'GET', url: url('Nowhereville'), user });
    const callsAfterFirst = fetchMock.mock.calls.length;

    await request({ method: 'GET', url: url('Nowhereville'), user });

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('shows no rate rather than failing when the publisher is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const response = await request<CityFuelRate | null>({
      method: 'GET',
      url: url('Lucknow'),
      user,
    });

    // The rate annotates a station list; it must never take one down.
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
  });

  it('never returns a stale rate as if it were current', async () => {
    stubPublisher({ petrol: ratePage({ price: '102.31', date: '20 March, 2024' }) });

    const response = await request<CityFuelRate>({
      method: 'GET',
      url: url('Lucknow'),
      user,
    });

    // A two-year-old rate is served, but dated, so the UI can say so. The old
    // failure was a 2024 figure with no date at all.
    expect(response.body.data.publishedOn).toBe('2024-03-20');
  });

  it('rejects a request with no city', async () => {
    const response = await request({ method: 'GET', url: '/api/v1/fuel-rates', user });
    expect(response.status).toBe(400);
  });

  it('requires authentication', async () => {
    const response = await request({ method: 'GET', url: url('Lucknow') });
    expect(response.status).toBe(401);
  });
});
