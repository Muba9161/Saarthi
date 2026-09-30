// Imported rather than taken from globals, as every other test in this app
// does. tsconfig.json declares `types: ["vite/client", "node"]` and nothing
// else, so `describe`/`it`/`expect` are undeclared names to tsc — which failed
// the production build, not merely the test run, because tsconfig.build.json
// type-checks `src` without excluding tests.
import { describe, expect, it } from 'vitest';
import { createMemoryRouter } from 'react-router-dom';
import { buildHeadTags } from './head-tags';
import { NOT_FOUND_HANDLE, bindRouteSeo } from './route-seo';
import { APP_TITLE, ROUTE_SEO, canonicalUrl, indexableRoutes, resolveRouteSeo } from './seo-config';

const find = (pathname: string, attr: string, value: string) =>
  buildHeadTags(pathname, resolveRouteSeo(pathname)).find((tag) => tag.attrs[attr] === value);

describe('route SEO', () => {
  it('treats any route it does not know as private', () => {
    const seo = resolveRouteSeo('/dashboard');
    expect(seo.indexable).toBe(false);
    expect(seo.title).toBe(APP_TITLE);
    expect(find('/dashboard', 'name', 'robots')?.attrs.content).toMatch(/^noindex/);
  });

  it('resolves a trailing slash to the same page and canonical', () => {
    expect(resolveRouteSeo('/terms/')).toBe(ROUTE_SEO['/terms']);
    expect(canonicalUrl('/terms/')).toBe('https://vorldxsaarthi.com/terms');
    expect(canonicalUrl('/')).toBe('https://vorldxsaarthi.com/');
  });

  it('gives indexable pages a canonical and noindex pages none', () => {
    expect(find('/privacy', 'rel', 'canonical')?.attrs.href).toBe(
      'https://vorldxsaarthi.com/privacy',
    );
    expect(find('/login', 'rel', 'canonical')).toBeUndefined();
  });

  it('keeps sign-in screens out of the sitemap', () => {
    expect(indexableRoutes()).toEqual(['/', '/terms', '/privacy']);
  });

  it('gives every public page its own title and description', () => {
    const pages = Object.values(ROUTE_SEO);
    expect(new Set(pages.map((page) => page.title)).size).toBe(pages.length);
    expect(new Set(pages.map((page) => page.description)).size).toBe(pages.length);
  });
});

describe('bindRouteSeo', () => {
  const head = () => ({
    title: document.title,
    robots: document.head.querySelector('meta[name="robots"]')?.getAttribute('content'),
    canonical: document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    ogUrl: document.head.querySelector('meta[property="og:url"]')?.getAttribute('content'),
    count: document.head.querySelectorAll('[data-seo]').length,
  });

  it('rewrites the head on every navigation without piling up tags', async () => {
    const router = createMemoryRouter(
      [
        { path: '/', element: null },
        { path: '/terms', element: null },
        { path: '/dashboard', element: null },
        { path: '*', element: null, handle: NOT_FOUND_HANDLE },
      ],
      { initialEntries: ['/'] },
    );
    const unbind = bindRouteSeo(router);

    expect(head()).toMatchObject({
      title: ROUTE_SEO['/']?.title,
      canonical: 'https://vorldxsaarthi.com/',
      robots: expect.stringMatching(/^index/),
    });
    const tagsPerPage = head().count;

    await router.navigate('/terms');
    expect(head()).toMatchObject({
      title: 'Terms of Service | VorldX Saarthi',
      canonical: 'https://vorldxsaarthi.com/terms',
      ogUrl: 'https://vorldxsaarthi.com/terms',
      count: tagsPerPage,
    });

    await router.navigate('/dashboard');
    expect(head()).toMatchObject({ title: APP_TITLE, canonical: undefined });
    expect(head().robots).toMatch(/^noindex/);

    await router.navigate('/no-such-page');
    expect(head().title).toBe('Page not found | VorldX Saarthi');
    expect(head().robots).toMatch(/^noindex/);

    unbind();
    router.dispose();
  });
});
