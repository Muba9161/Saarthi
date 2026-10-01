import { ROUTE_SEO, SITE, normalizePath } from '@/features/seo';

/**
 * Google Analytics 4, for the public site only.
 *
 * Analytics is here to measure the marketing site: which pages people read,
 * where they came from and whether they signed up. Nothing behind the sign-in
 * wall is sent. That boundary is enforced in two places:
 *
 *  * page views are sent by hand, and only for the routes `isTrackedPath`
 *    accepts, with a URL stripped of everything except campaign parameters;
 *  * on any other route, and for any signed-in session, Google's documented
 *    opt-out flag is raised, so the automatic events gtag.js collects on its
 *    own (scrolls, outbound links, file downloads) are dropped too. That
 *    matters inside the app, where a download link can be a signed URL to a
 *    customer's document.
 *
 * It runs only in a production build served from the canonical host, so local
 * development, tunnels and preview builds never pollute the numbers.
 */

export const MEASUREMENT_ID = 'G-HE89MX49P2';

/** The documented per-property opt-out: gtag.js drops every hit while it is true. */
const DISABLE_FLAG = `ga-disable-${MEASUREMENT_ID}`;

/**
 * Public routes kept out of analytics despite being public.
 *
 * `/reset-password` carries the reset token in its query string. The URL is
 * sanitised before a page view is sent, but the automatic events read the raw
 * address, so the page is not measured at all.
 */
const UNTRACKED_ROUTES: ReadonlySet<string> = new Set(['/reset-password']);

/** Query parameters that describe a campaign, not a visitor. Everything else is dropped. */
const KEPT_PARAMS = /^(utm_[a-z]+|gclid)$/;

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** Whether this page load may send anything to Google at all. */
export function analyticsAvailable(): boolean {
  return import.meta.env.PROD && window.location.hostname === new URL(SITE.url).hostname;
}

/** Public, known pages only: an unknown path is a 404 or an app screen. */
export function isTrackedPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path in ROUTE_SEO && !UNTRACKED_ROUTES.has(path);
}

/** The canonical page URL plus its campaign parameters, and nothing else. */
export function sanitizedLocation(pathname: string, search: string): string {
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    if (KEPT_PARAMS.test(key)) kept.append(key, value);
  }
  const query = kept.toString();
  const path = normalizePath(pathname);
  return `${SITE.url}${path === '/' ? '/' : path}${query ? `?${query}` : ''}`;
}

/**
 * The snippet Google publishes, as a function.
 *
 * gtag.js only recognises the `arguments` object itself on the data layer; an
 * array of the same values is silently ignored, so rest parameters will not do.
 */
function gtag(..._args: unknown[]): void {
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer?.push(arguments);
}

let started = false;

/**
 * Queues the configuration now and fetches gtag.js once the browser is idle.
 *
 * Calls made before the script arrives wait on the data layer, so nothing is
 * lost by deferring it — and the landing page's own content, not a tracking
 * script, gets the network and main thread while it is painting.
 */
function start(): void {
  if (started) return;
  started = true;

  window.dataLayer = window.dataLayer ?? [];
  gtag('js', new Date());
  // Page views are sent by hand below, so a navigation is counted once and
  // only with a sanitised URL.
  gtag('config', MEASUREMENT_ID, { send_page_view: false });

  const inject = () => {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(script);
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(inject, { timeout: 4000 });
  else setTimeout(inject, 2000);
}

/**
 * Raises or lowers the opt-out flag.
 *
 * Before the first tracked page there is nothing to switch off: gtag.js is
 * not loaded until `trackPageView` starts it.
 */
export function setCollectionEnabled(enabled: boolean): void {
  if (!started) return;
  (window as unknown as Record<string, unknown>)[DISABLE_FLAG] = !enabled;
}

export function trackPageView(pathname: string, search: string, title: string): void {
  if (!analyticsAvailable()) return;
  start();
  setCollectionEnabled(true);
  gtag('event', 'page_view', {
    page_location: sanitizedLocation(pathname, search),
    page_title: title,
  });
}

/** A recommended GA4 event. A no-op unless a tracked page has already started analytics. */
export function trackEvent(name: string, params: Record<string, string | number> = {}): void {
  if (!started) return;
  gtag('event', name, params);
}
