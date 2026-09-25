import { lazyWithPreload } from '@/lib/lazy-with-preload';

/**
 * Pages that are code-split *and* fetched ahead of time, because the page a
 * visitor is on links straight to them.
 *
 * The marketing site and sign-in/registration sit on either side of the same
 * "Sign in" / "Back to vorldxsaarthi.com" links, and whichever one a visitor
 * entered on, the other has not been downloaded yet — so following the link
 * used to stop on a spinner. Each side now preloads the other while idle.
 *
 * Kept apart from the router so the pages themselves can import these without
 * an import cycle through it.
 */
export const LandingPage = lazyWithPreload(() => import('@/pages/marketing/landing'));
export const LoginPage = lazyWithPreload(() => import('@/pages/auth/login'));
export const RegisterPage = lazyWithPreload(() => import('@/pages/auth/register'));
