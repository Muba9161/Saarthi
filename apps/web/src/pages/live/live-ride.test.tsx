import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

    expect(await screen.findByText("Waiting for Asha's first location…")).toBeInTheDocument();
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
