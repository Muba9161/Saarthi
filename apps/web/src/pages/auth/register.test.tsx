import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '@/features/i18n';
import { RegisterPage } from './register';

/**
 * How the first questions of registration follow from where the visitor came
 * from: no plan asks the plan, a plan from the pricing page skips straight to
 * its account types, and a plan with no types skips both.
 */

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ register: vi.fn(), refreshSession: vi.fn() }),
}));

function renderAt(path: string) {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[path]}>
        <RegisterPage />
      </MemoryRouter>
    </LocaleProvider>,
  );
}

const stepCount = (count: number) =>
  screen.getAllByText(`${count} short steps. Nothing is saved until the last one.`);

async function continueOn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('registration plan and account type', () => {
  it('asks the plan first when the pricing page chose none', async () => {
    const user = userEvent.setup();
    renderAt('/register');

    expect(stepCount(5).length).toBeGreaterThan(0);
    await continueOn(user);

    const plans = await screen.findByRole('radiogroup', { name: 'Choose your plan' });
    expect(within(plans).getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      expect.stringContaining('Free'),
      expect.stringContaining('Personal'),
      expect.stringContaining('Seller'),
      expect.stringContaining('Business'),
    ]);

    // Free has a second question, so it adds the account type step.
    await user.click(within(plans).getByRole('radio', { name: /Free/ }));
    expect(stepCount(6).length).toBeGreaterThan(0);
    await continueOn(user);

    const types = await screen.findByRole('radiogroup', { name: 'How will you use Saarthi?' });
    expect(within(types).getByRole('radio', { name: /I drive for a fleet/ })).toBeInTheDocument();

    // Leaving it unanswered is stopped rather than guessed.
    await continueOn(user);
    expect(await screen.findByText('Choose one to continue.')).toBeInTheDocument();
  });

  it('moves the plan selection with the arrow keys', async () => {
    const user = userEvent.setup();
    renderAt('/register');
    await continueOn(user);

    const plans = await screen.findByRole('radiogroup', { name: 'Choose your plan' });
    const free = within(plans).getByRole('radio', { name: /Free/ });
    free.focus();
    await user.keyboard('{ArrowDown}');

    expect(within(plans).getByRole('radio', { name: /Personal/ })).toHaveAttribute('aria-checked', 'true');
    expect(free).toHaveAttribute('aria-checked', 'false');
  });

  it('skips straight to the plan types when the pricing page chose Free', async () => {
    const user = userEvent.setup();
    renderAt('/register?plan=free');

    expect(stepCount(5).length).toBeGreaterThan(0);
    await continueOn(user);

    expect(await screen.findByRole('radiogroup', { name: 'How will you use Saarthi?' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Choose your plan' })).not.toBeInTheDocument();
  });

  it('skips both questions for a plan with no types, and can still change it', async () => {
    const user = userEvent.setup();
    renderAt('/register?plan=personal');

    expect(stepCount(4).length).toBeGreaterThan(0);
    expect(screen.queryByText('Account type')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Change plan' })[0]!);

    const plans = await screen.findByRole('radiogroup', { name: 'Choose your plan' });
    expect(within(plans).getByRole('radio', { name: /Personal/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: 'Change plan' })).not.toBeInTheDocument();
  });
});
