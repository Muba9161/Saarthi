import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '@/features/i18n/locale-context';
import { OwnershipReviewQueue } from './ownership-review-queue';

const REVIEW = {
  id: 'review-1',
  registrationNumber: 'UP70AG0099',
  kind: 'CLAIM',
  status: 'PENDING',
  message: 'The RC is in my name as SMT. BHAWNA PANDEY; my PAN spells it BHAVANA PANDEY.',
  hasAttachment: false,
  decisionNote: null,
  createdAt: new Date().toISOString(),
  reviewedAt: null,
  organizationName: 'Pandey Travels',
  requestedByName: 'Bhavana Pandey',
};

const json = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function stubApi() {
  const decisions: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/decision')) {
        decisions.push(JSON.parse(String(init?.body)));
        return json({ ...REVIEW, status: 'REJECTED' });
      }
      if (url.includes('/admin/ownership-reviews/review-1')) {
        return json({
          ...REVIEW,
          vehicleId: null,
          rcOwnerName: 'SMT. BHAWNA PANDEY',
          verifiedNames: ['BHAVANA PANDEY'],
          holder: { organizationName: 'Another Fleet', ownershipStatus: 'PENDING' },
        });
      }
      return json({ items: [REVIEW], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    }),
  );
  return decisions;
}

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <OwnershipReviewQueue />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('vehicle ownership review queue', () => {
  let decisions: unknown[];

  beforeEach(() => {
    decisions = stubApi();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('puts the RC owner and the verified names side by side', async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const panel = await screen.findByRole('dialog');

    expect(await within(panel).findByText('SMT. BHAWNA PANDEY')).toBeInTheDocument();
    expect(within(panel).getByText('BHAVANA PANDEY')).toBeInTheDocument();
    expect(within(panel).getByText(/Another Fleet/)).toBeInTheDocument();
  });

  it('will not reject without a reason, because the owner reads it', async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const panel = await screen.findByRole('dialog');
    await user.click(await within(panel).findByRole('button', { name: 'Reject' }));
    const submit = within(panel).getByRole('button', { name: 'Submit decision' });
    expect(submit).toBeDisabled();

    await user.type(within(panel).getByLabelText(/Why is it rejected/), 'The RC photo is unreadable.');
    await user.click(submit);

    await vi.waitFor(() => expect(decisions).toHaveLength(1));
    expect(decisions[0]).toEqual({ decision: 'REJECTED', note: 'The RC photo is unreadable.' });
  });
});
