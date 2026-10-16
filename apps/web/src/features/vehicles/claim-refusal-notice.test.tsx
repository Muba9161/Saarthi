import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'user-1' } }, can: () => true }),
}));

// Imported after the mock so the module graph picks it up.
const { ClaimRefusalNotice } = await import('./claim-refusal-notice');

const PLATE = 'UP32QV6117';
const AADHAAR_ONLY =
  'UP32QV6117 is held by another account that has not confirmed it owns it. Your Aadhaar is verified, but an Aadhaar check does not include your name, so it cannot be matched to the RC. Verify your PAN in Your identity, then add the vehicle again.';
const MISMATCH =
  'UP32QV6117 is held by another account that has not confirmed it owns it. The owner’s name on the RC does not match a verified name on this account. If the vehicle is yours, ask the Saarthi team to review it.';

const json = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** No review asked for yet; the PAN dialog's price; and the review request itself. */
function stubApi() {
  const sent: FormData[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/fleet/ownership-reviews/latest')) return json(null);
      if (url.includes('/fleet/ownership-reviews')) {
        sent.push(init?.body as FormData);
        return json({ id: 'review-1', status: 'PENDING', kind: 'CLAIM', registrationNumber: PLATE });
      }
      return json([{ checkType: 'PAN', amount: 10, currency: 'INR', available: true }]);
    }),
  );
  return sent;
}

function renderNotice(message: string, needsVerifiedName: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ClaimRefusalNotice message={message} registrationNumber={PLATE} needsVerifiedName={needsVerifiedName} />
    </QueryClientProvider>,
  );
}

describe('claim refusal notice', () => {
  let sent: FormData[];

  beforeEach(() => {
    sent = stubApi();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('offers the PAN check when a verified name is what is missing, and a review either way', async () => {
    renderNotice(AADHAAR_ONLY, true);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Aadhaar check does not include your name');
    expect(within(alert).getByRole('button', { name: 'Verify your PAN' })).toBeInTheDocument();
    expect(await within(alert).findByRole('button', { name: 'Ask Saarthi to review' })).toBeInTheDocument();
  });

  it('offers only a review when the names simply do not match', async () => {
    renderNotice(MISMATCH, false);

    expect(screen.queryByRole('button', { name: 'Verify your PAN' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Ask Saarthi to review' })).toBeInTheDocument();
  });

  it('opens the PAN check in place, without leaving the form', async () => {
    const user = userEvent.setup();
    renderNotice(AADHAAR_ONLY, true);

    await user.click(screen.getByRole('button', { name: 'Verify your PAN' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Verify PAN card')).toBeInTheDocument();
  });

  it('sends a review request with only a message, the RC being optional', async () => {
    const user = userEvent.setup();
    renderNotice(MISMATCH, false);

    await user.click(await screen.findByRole('button', { name: 'Ask Saarthi to review' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Send request' });
    expect(send).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText(/Your message/),
      'The RC is in my mother’s name; she has added me as the user.',
    );
    await user.click(send);

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.get('registrationNumber')).toBe(PLATE);
    expect(sent[0]?.get('message')).toMatch(/mother/);
    expect(sent[0]?.get('file')).toBeNull();
  });
});
