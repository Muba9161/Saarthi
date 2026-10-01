import * as React from 'react';
import type { createBrowserRouter } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { resolveRouteSeo } from '@/features/seo';
import { isTrackedPath, setCollectionEnabled, trackPageView } from './gtag';

type AppRouter = ReturnType<typeof createBrowserRouter>;
type RouterState = AppRouter['state'];

/**
 * Sends a page view for each public page a signed-out visitor opens.
 *
 * Rendered beside `RouterProvider` rather than inside a route, because the
 * session decides whether anything is measured and the auth context sits
 * above the router. It reads the router the way `bindRouteSeo` does, so a
 * page view is counted once per settled navigation.
 *
 * Waiting for the session check matters on `/`: a signed-in user is shown the
 * home route for an instant before being redirected into the app, and must
 * not be counted as a visitor to the marketing site.
 */
export function AnalyticsTracker({ router }: { router: AppRouter }) {
  const { status } = useAuth();

  React.useEffect(() => {
    if (status === 'loading') return undefined;
    const signedOut = status === 'unauthenticated';
    let lastPath = '';

    const sync = (state: RouterState) => {
      if (state.navigation.state !== 'idle') return;
      const { pathname, search } = state.location;
      if (!signedOut || !isTrackedPath(pathname)) {
        setCollectionEnabled(false);
        lastPath = '';
        return;
      }
      if (pathname === lastPath) return;
      lastPath = pathname;
      trackPageView(pathname, search, resolveRouteSeo(pathname).title);
    };

    sync(router.state);
    return router.subscribe(sync);
  }, [router, status]);

  return null;
}
