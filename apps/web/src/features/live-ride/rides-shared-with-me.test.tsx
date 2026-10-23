import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '@/features/i18n';
import { LiveRidesSection, RidesSharedWithMeCard } from './rides-shared-with-me';

const RIDE = {
  id: 'share-1',
  token: 'tok123',
  riderName: 'Asha Verma',
  registrationNumber: 'UP32AB1234',
  startedAt: '2026-10-23T09:00:00.000Z',
  expiresAt: '2026-10-23T21:00:00.000Z',
  position: null,
};

function stubRides(rides: unknown[]) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ success: true, data: rides }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderWith(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <MemoryRouter>{element}</MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('rides shared with me', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists each live ride with its vehicle and a link to the live page', async () => {
    const fetchMock = stubRides([
      RIDE,
      {
        ...RIDE,
        id: 'share-2',
        token: 'tok456',
        riderName: 'Ravi',
        registrationNumber: null,
        position: {
          latitude: 26.85,
          longitude: 80.95,
          speedKph: null,
          heading: null,
          recordedAt: new Date().toISOString(),
        },
      },
    ]);
    renderWith(<LiveRidesSection />);

    expect(await screen.findByRole('heading', { name: 'Live rides' })).toBeInTheDocument();
    expect(screen.getByText('Asha Verma is sharing a live ride')).toBeInTheDocument();
    expect(screen.getByText('UP-32-AB-1234')).toBeInTheDocument();
    expect(screen.getByText('No location yet')).toBeInTheDocument();
    expect(screen.getByText('Updated just now')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: 'Open live map' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/live/tok123', '/live/tok456']);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/ride-shares/shared-with-me');
  });

  it('renders nothing on Home while nobody is sharing a ride', async () => {
    const fetchMock = stubRides([]);
    const { container } = renderWith(<RidesSharedWithMeCard />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
