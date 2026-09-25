import type { createBrowserRouter } from 'react-router-dom';
import { SEO_ATTRIBUTE, buildHeadTags } from './head-tags';
import { NOT_FOUND_SEO, resolveRouteSeo } from './seo-config';

type AppRouter = ReturnType<typeof createBrowserRouter>;
type RouterState = AppRouter['state'];

/** Route `handle` marking the catch-all, so both the auth gate and the head can tell a 404. */
export const NOT_FOUND_HANDLE = { notFound: true } as const;

export function isNotFoundHandle(handle: unknown): boolean {
  return (handle as Partial<typeof NOT_FOUND_HANDLE> | undefined)?.notFound === true;
}

/**
 * Keeps the document's title and meta tags in step with the route.
 *
 * The first page a visitor lands on already arrives with the right tags — the
 * build writes them into its HTML — so this matters for the navigations that
 * follow, and for the routes only the client can classify: an unmatched URL
 * is served the home page's HTML and only here becomes a noindex 404.
 */
function applyRouteSeo(state: RouterState): void {
  const { pathname } = state.location;
  const notFound = state.matches.some((match) => isNotFoundHandle(match.route.handle));
  const seo = notFound ? NOT_FOUND_SEO : resolveRouteSeo(pathname);

  document.title = seo.title;

  const head = document.head;
  head.querySelectorAll(`[${SEO_ATTRIBUTE}]`).forEach((element) => element.remove());
  for (const { tag, attrs } of buildHeadTags(pathname, seo)) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    head.appendChild(element);
  }
}

/** Applies the current route's metadata now and on every navigation. Returns the unsubscribe. */
export function bindRouteSeo(router: AppRouter): () => void {
  let lastKey = '';
  const sync = (state: RouterState) => {
    // The router publishes loading states and fetcher updates too; only a
    // settled change of page is worth rewriting the head for.
    if (state.navigation.state !== 'idle') return;
    const key = `${state.location.pathname}|${state.matches.map((match) => match.route.id).join('/')}`;
    if (key === lastKey) return;
    lastKey = key;
    applyRouteSeo(state);
  };

  sync(router.state);
  return router.subscribe(sync);
}
