import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LocaleProvider } from '@/features/i18n';

// jsdom has no WebGL; the map is exercised in a browser, the page logic here.
vi.mock('@/features/maps/live-marker-map', () => ({
  LiveMarkerMap: ({ label }: { label: string }) => <div role="region" aria-label={label} />,
}));

// Imported after the mock so the module graph picks it up.
const { LiveRidePage } = await import('./live-ride');

const RIDE = {
  riderName: 'Asha',
  registrationNumber: 'UP32AB1234',
  status: 'SHARING',
  startedAt: '2026-10-23T09:00:00.000Z',
  endedAt: null,
  position: null,
  trail: [],
  summary: null,
};

const POSITION = { latitude: 26.85, longitude: 80.95, speedKph: 42.4, heading: 90 };

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ok = (data: unknown) => ({ success: true, data });

function renderPage(token = 'tok123') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[`/live/${token}`]}>
          <Routes>
            <Route path="/live/:token" element={<LiveRidePage />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('the public live-ride page', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows who is sharing, the vehicle, speed, freshness and the map', async () => {
    const fetchMock = stubFetch(
      200,
      ok({ ...RIDE, position: { ...POSITION, recordedAt: new Date().toISOString() } }),
    );
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Asha is sharing a live ride' }),
    ).toBeInTheDocument();
    expect(screen.getByText('UP-32-AB-1234')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Updated just now')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: "Map of Asha's live location" })).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/public/live/tok123');
  });

  it('waits for the first fix without drawing a map', async () => {
    stubFetch(200, ok(RIDE));
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'The ride has not started yet' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Not started yet')).toBeInTheDocument();
    expect(screen.getByText('Waiting for Asha to start sharing')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /live location/ })).not.toBeInTheDocument();
  });

  it('says the ride has ended and shows no position', async () => {
    stubFetch(200, ok({ ...RIDE, status: 'ENDED', endedAt: '2026-10-23T10:00:00.000Z' }));
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Asha has stopped sharing this ride.' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /live location/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Updated/)).not.toBeInTheDocument();
  });

  /** A ride that ended a moment ago, its summary shown for [shownForMs] more. */
  function endedRide(shownForMs: number) {
    const endedAt = new Date().toISOString();
    return ok({
      ...RIDE,
      status: 'ENDED',
      endedAt,
      summary: {
        distanceKm: 14.24,
        durationMinutes: 75,
        avgSpeedKph: 11.4,
        maxSpeedKph: null,
        startedAt: RIDE.startedAt,
        endedAt,
        shownUntil: new Date(Date.now() + shownForMs).toISOString(),
      },
    });
  }

  it('shows what an ended ride came to, and leaves out a figure that was never recorded', async () => {
    stubFetch(200, endedRide(5 * 60_000));
    renderPage();

    expect(await screen.findByText('1 h 15 min')).toBeInTheDocument();
    expect(screen.getByText('Distance covered')).toBeInTheDocument();
    expect(screen.getByText('14.2 km')).toBeInTheDocument();
    expect(screen.getByText('11 km/h')).toBeInTheDocument();
    expect(screen.queryByText('Top speed')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /live location/ })).not.toBeInTheDocument();
  });

  it('removes the summary by itself once its minutes are up', async () => {
    stubFetch(200, endedRide(300));
    renderPage();

    expect(await screen.findByText('14.2 km')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('14.2 km')).not.toBeInTheDocument());
    // The ride still says it ended; only the figures are gone.
    expect(
      screen.getByRole('heading', { name: 'Asha has stopped sharing this ride.' }),
    ).toBeInTheDocument();
  });

  it('treats an unknown token as a link that does not exist', async () => {
    stubFetch(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'This live link does not exist.' },
    });
    renderPage('nope');

    expect(
      await screen.findByRole('heading', {
        name: "This live link doesn't exist or has been removed.",
      }),
    ).toBeInTheDocument();
  });

  it('offers a retry when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Could not reach VorldX Saarthi' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
