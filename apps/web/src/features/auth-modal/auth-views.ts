/**
 * The sign-in modal's views and the addresses that open them. Pure, so the
 * routing rules can be tested without a router.
 *
 * Two ways in, one modal:
 * - the real addresses `/login`, `/register`, `/forgot-password` and
 *   `/reset-password`, which search engines index, the reset email links to
 *   and `?next=`/`?plan=` ride on. They open the modal over the landing page;
 * - `?auth=<view>` on any other public page (a legal page, a QR scan, a
 *   referral link), which opens the same modal over that page, so following
 *   "Sign in" never leaves it.
 */

export const AUTH_VIEWS = [
  'sign-in',
  'create-account',
  'forgot-password',
  'reset-password',
] as const;
export type AuthView = (typeof AUTH_VIEWS)[number];

/** The search parameter that opens the modal over the current page. */
export const AUTH_PARAM = 'auth';

export const AUTH_VIEW_PATH: Readonly<Record<AuthView, string>> = {
  'sign-in': '/login',
  'create-account': '/register',
  'forgot-password': '/forgot-password',
  'reset-password': '/reset-password',
};

export function isAuthView(value: unknown): value is AuthView {
  return typeof value === 'string' && (AUTH_VIEWS as readonly string[]).includes(value);
}

/** The view an address opens by its path, or null. */
export function viewForPath(pathname: string): AuthView | null {
  const entry = Object.entries(AUTH_VIEW_PATH).find(([, path]) => path === pathname);
  return entry ? (entry[0] as AuthView) : null;
}

/** The landing page and the four auth addresses share one page underneath. */
export function isLandingFamily(pathname: string): boolean {
  return pathname === '/' || viewForPath(pathname) !== null;
}

/** The view open at this location: by path first, then by `?auth=`. */
export function viewForLocation(pathname: string, search: string): AuthView | null {
  const byPath = viewForPath(pathname);
  if (byPath) return byPath;
  const param = new URLSearchParams(search).get(AUTH_PARAM);
  return isAuthView(param) ? param : null;
}

/**
 * Where a link to `view` should go from this location.
 *
 * On the landing family it is the view's own address. Anywhere else it is the
 * current page with `?auth=<view>`, keeping that page's other parameters.
 * `extra` adds parameters the view reads (`next`, `plan`, `ref`, `token`).
 */
export function authHref(
  view: AuthView,
  location: { pathname: string; search: string },
  extra: Readonly<Record<string, string>> = {},
): string {
  if (isLandingFamily(location.pathname)) {
    const params = new URLSearchParams(extra);
    const query = params.toString();
    return `${AUTH_VIEW_PATH[view]}${query ? `?${query}` : ''}`;
  }
  const params = new URLSearchParams(location.search);
  params.set(AUTH_PARAM, view);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return `${location.pathname}?${params.toString()}`;
}

/**
 * Where to go after signing in, from `?next=`. Only a path on this site is
 * honoured (it must start with one `/`), so the parameter cannot be used to
 * bounce somebody to another origin.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\'))
    return null;
  return value;
}

/**
 * Where closing the modal leaves the visitor: the landing page from an auth
 * address, otherwise the same page without `?auth=` and the parameters only
 * the modal reads.
 */
export function closedHref(location: { pathname: string; search: string }): string {
  if (viewForPath(location.pathname)) return '/';
  const params = new URLSearchParams(location.search);
  params.delete(AUTH_PARAM);
  for (const key of ['next', 'plan', 'token', 'setup']) params.delete(key);
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}`;
}
