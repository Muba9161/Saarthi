import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'user-1' }, organization: { id: 'org-1' } } }),
}));

// Imported after the mock so the module graph picks it up.
const { RcPrefillPanel } = await import('./rc-prefill-panel');

const PLATE = 'UP32AB1234';

const prefill = (detailLevel: 'BASIC' | 'FULL') => ({
  lookupId: 'lookup-1',
  registrationNumber: PLATE,
  detailLevel,
  draft: { manufacturer: detailLevel === 'FULL' ? 'TATA MOTORS' : null },
});

const json = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** The API as this step sees it, recording which addresses were called. */
function stubApi() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url.replace(/^.*\/api\/v1/, '').split('?')[0]}`);
      if (url.includes('/verification-center/prices')) {
        return json([{ checkType: 'VEHICLE_RC_DETAILS', amount: 20, currency: 'INR', available: true }]);
      }
      // Already paid for, so it settles without a checkout.
      if (url.includes('/verification-center/checks')) {
        return json({ mode: 'COMPLETED_FREE', state: 'VERIFIED', charge: null, checkout: null, message: null, detail: null });
      }
      if (url.includes('/vehicles/rc-prefill/stored')) return json(prefill('FULL'));
      if (url.includes('/vehicles/rc-prefill')) return json(prefill('BASIC'));
      return new Response('unexpected', { status: 500 });
    }),
  );
  return calls;
}

function renderPanel(onPrefilled = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <RcPrefillPanel onPrefilled={onPrefilled} onManual={vi.fn()} />
    </QueryClientProvider>,
  );
  return onPrefilled;
}

describe('the first step of adding a vehicle', () => {
  let calls: string[];

  beforeEach(() => {
    calls = stubApi();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('offers basic details free and full details at the price the server sets', async () => {
    renderPanel();

    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Get full details · ₹\s?20/ })).toBeInTheDocument();
  });

  it('fills the form from the free basic record', async () => {
    const user = userEvent.setup();
    const onPrefilled = renderPanel();

    await user.type(screen.getByLabelText(/RC number/), PLATE);
    await user.click(screen.getByRole('button', { name: 'Fetch basic details' }));

    await vi.waitFor(() => expect(onPrefilled).toHaveBeenCalled());
    expect(onPrefilled.mock.calls[0]?.[0]).toMatchObject({ detailLevel: 'BASIC' });
    expect(calls).toContain('POST /vehicles/rc-prefill');
    expect(calls).not.toContain('POST /verification-center/checks');
  });

  it('pays for full details, then fills the form from the stored full record', async () => {
    const user = userEvent.setup();
    const onPrefilled = renderPanel();

    await user.type(screen.getByLabelText(/RC number/), PLATE);
    await user.click(await screen.findByRole('button', { name: /Get full details/ }));

    await vi.waitFor(() => expect(onPrefilled).toHaveBeenCalled());
    expect(onPrefilled.mock.calls[0]?.[0]).toMatchObject({ detailLevel: 'FULL' });
    expect(calls).toContain('POST /verification-center/checks');
    expect(calls).toContain('GET /vehicles/rc-prefill/stored');
    expect(calls).not.toContain('POST /vehicles/rc-prefill');
  });
});
