import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authHref, closedHref, viewForLocation, type AuthView } from './auth-views';

export interface AuthModalControls {
  /** The view open now, or null when the modal is closed. */
  view: AuthView | null;
  /** Where a link to `view` goes from here (see `authHref`). */
  hrefFor: (view: AuthView, extra?: Readonly<Record<string, string>>) => string;
  /** Switch the open modal to another view without adding a history entry. */
  show: (view: AuthView, extra?: Readonly<Record<string, string>>) => void;
  close: () => void;
}

/** The sign-in modal's state, read from and written to the address bar. */
export function useAuthModal(): AuthModalControls {
  const location = useLocation();
  const navigate = useNavigate();
  const { pathname, search } = location;

  const hrefFor = React.useCallback(
    (view: AuthView, extra?: Readonly<Record<string, string>>) =>
      authHref(view, { pathname, search }, extra),
    [pathname, search],
  );

  const show = React.useCallback(
    (view: AuthView, extra?: Readonly<Record<string, string>>) =>
      navigate(authHref(view, { pathname, search }, extra), { replace: true }),
    [navigate, pathname, search],
  );

  const close = React.useCallback(
    () => navigate(closedHref({ pathname, search }), { replace: true }),
    [navigate, pathname, search],
  );

  return { view: viewForLocation(pathname, search), hrefFor, show, close };
}
