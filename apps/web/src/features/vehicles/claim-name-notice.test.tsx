import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'user-1' } }, can: () => true }),
}));

// Imported after the mock so the module graph picks it up.
const { ClaimNameNotice } = await import('./claim-name-notice');

const REFUSAL =
  'UP32QV6117 is held by another account that has not confirmed it owns it. Your Aadhaar is verified, but an Aadhaar check does not include your name, so it cannot be matched to the RC. Verify your PAN in Your identity, then add the vehicle again.';

function renderNotice() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ClaimNameNotice message={REFUSAL} />
    </QueryClientProvider>,
  );
}

describe('claim name notice', () => {
  beforeEach(() => {
    // The PAN dialog asks for its price on open.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: [{ checkType: 'PAN', amount: 10, currency: 'INR', available: true }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('says why the plate was not handed over, beside the fix', () => {
    renderNotice();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Aadhaar check does not include your name');
    expect(within(alert).getByRole('button', { name: 'Verify your PAN' })).toBeInTheDocument();
  });

  it('opens the PAN check in place, without leaving the form', async () => {
    const user = userEvent.setup();
    renderNotice();

    await user.click(screen.getByRole('button', { name: 'Verify your PAN' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Verify PAN card')).toBeInTheDocument();
    expect(within(dialog).getByText('Name on the card')).toBeInTheDocument();
  });
});
