import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LocaleProvider } from '@/features/i18n';
import { AuthModalHost } from './auth-modal-host';

/**
 * The sign-in modal over a page: opened by an address, moved between views by
 * its tabs without stacking history, and closed back to the page underneath.
 */

const auth = vi.hoisted(() => ({
  status: 'unauthenticated' as 'unauthenticated' | 'authenticated',
}));

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ status: auth.status }),
}));

// The forms have their own tests; here they only need to say which one shows.
vi.mock('@/pages/lazy-pages', () => {
  const view = (label: string) => Object.assign(() => <p>{label}</p>, { preload: () => undefined });
  return {
    LoginPage: view('Sign-in form'),
    RegisterPage: view('Registration form'),
    ForgotPasswordPage: view('Forgot-password form'),
    ResetPasswordPage: view('Reset-password form'),
  };
});

// Festival looks are covered in features/festive; keep them out of the way.
vi.mock('@/features/festive', () => ({
  FestiveBand: () => null,
  FestiveParticles: () => null,
  FestiveWish: () => null,
  useFestive: () => ({ key: null, window: null, on: true, active: null }),
}));

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function renderAt(path: string) {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AuthModalHost />}>
            {['/', '/login', '/register', '/forgot-password', '/reset-password'].map((route) => (
              <Route key={route} path={route} element={<p>Landing page</p>} />
            ))}
            <Route path="/terms" element={<p>Terms page</p>} />
          </Route>
        </Routes>
        <Where />
      </MemoryRouter>
    </LocaleProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;

describe('sign-in modal', () => {
  beforeEach(() => {
    auth.status = 'unauthenticated';
  });

  it('opens on /login over the landing page, on the Sign in tab', async () => {
    renderAt('/login');
    expect(await screen.findByRole('dialog', { name: 'Sign in to Saarthi' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Sign-in form')).toBeInTheDocument();
    expect(screen.getByText('Landing page')).toBeInTheDocument();
  });

  it('moves to registration from its tab, at the registration address', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await user.click(await screen.findByRole('tab', { name: 'Create account' }));
    expect(await screen.findByText('Registration form')).toBeInTheDocument();
    expect(where()).toBe('/register');
    expect(screen.getByRole('tab', { name: 'Create account' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('closes back to the landing page', async () => {
    const user = userEvent.setup();
    renderAt('/register');
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(where()).toBe('/');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens over any other page in place and closes back to it', async () => {
    const user = userEvent.setup();
    renderAt('/terms?auth=sign-in');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Terms page')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(where()).toBe('/terms');
  });

  it('stays out of the way for somebody signed in', () => {
    auth.status = 'authenticated';
    renderAt('/terms?auth=sign-in');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
