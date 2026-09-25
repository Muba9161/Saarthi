import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { buildHeadTags, type HeadTag } from '../src/features/seo/head-tags';
import {
  ROUTE_SEO,
  SITE,
  canonicalUrl,
  indexableRoutes,
  resolveRouteSeo,
} from '../src/features/seo/seo-config';
// Relative rather than `@saarthi/shared`: the config bundle does not see the
// app's aliases, and the package entry is its build output, which may be stale.
import { PLAN_CATALOGUE } from '../../../packages/shared/src/domain/entitlements';

/**
 * Search and sharing metadata for a client-rendered site.
 *
 * The SPA serves one index.html for every URL, so without this every page
 * told crawlers and link-preview bots it was the home page — same title, same
 * description, no canonical — and neither robots.txt nor a sitemap existed
 * (both fell through to index.html). This plugin:
 *
 *  1. replaces the `<!-- seo -->` marker in index.html with the home page's
 *     title, meta, Open Graph and JSON-LD, in dev and build alike;
 *  2. after a build, writes `<route>.html` beside it for every other public
 *     route in `ROUTE_SEO`, identical but for that page's own head — nginx
 *     serves them through `try_files $uri $uri.html /index.html`;
 *  3. writes robots.txt and sitemap.xml from the same config, so a page added
 *     to `ROUTE_SEO` is in the sitemap without anyone remembering to add it.
 */

const MARKER = '<!-- seo -->';
const BLOCK = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderTag({ tag, attrs }: HeadTag): string {
  const rendered = Object.entries(attrs)
    .map(([name, value]) => (value === '' ? name : `${name}="${escapeAttr(value)}"`))
    .join(' ');
  return `<${tag} ${rendered} />`;
}

/**
 * Organization, WebSite and the product itself — only what the page shows.
 *
 * No SearchAction (the site has no search), no ratings (there are none to
 * cite). Prices come from the same catalogue the pricing section renders, so
 * the two cannot drift apart.
 */
function structuredData(): string {
  const prices = PLAN_CATALOGUE.map((plan) => plan.priceMonthly).filter(
    (price): price is number => price !== null,
  );
  const organizationId = `${SITE.url}/#organization`;

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: SITE.name,
        url: `${SITE.url}/`,
        logo: `${SITE.url}${SITE.logoPath}`,
        sameAs: Object.values(SITE.social),
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE.url}/#website`,
        name: SITE.name,
        url: `${SITE.url}/`,
        inLanguage: SITE.language,
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'SoftwareApplication',
        name: SITE.name,
        url: `${SITE.url}/`,
        description: ROUTE_SEO['/']?.description,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        image: `${SITE.url}${SITE.ogImage.path}`,
        publisher: { '@id': organizationId },
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'INR',
          lowPrice: Math.min(...prices),
          highPrice: Math.max(...prices),
          offerCount: prices.length,
        },
      },
    ],
  };

  // `<` escaped so no string in the data can close the script element.
  const json = JSON.stringify(graph).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

function renderSeoBlock(pathname: string): string {
  const seo = resolveRouteSeo(pathname);
  const lines = [
    `<title>${escapeText(seo.title)}</title>`,
    ...buildHeadTags(pathname, seo).map(renderTag),
    ...(pathname === '/' ? [structuredData()] : []),
  ];
  return ['<!-- seo:start -->', ...lines, '<!-- seo:end -->'].join('\n    ');
}

function robotsTxt(): string {
  return [
    'User-agent: *',
    'Allow: /',
    // The API and QR scan targets: nothing a search result should link to.
    'Disallow: /api/',
    'Disallow: /q/',
    '',
    `Sitemap: ${SITE.url}/sitemap.xml`,
    '',
  ].join('\n');
}

function sitemapXml(): string {
  const urls = indexableRoutes()
    .map((route) => `  <url>\n    <loc>${canonicalUrl(route)}</loc>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function seoPlugin(): Plugin {
  let outDir = '';

  return {
    name: 'saarthi-seo',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html) {
      if (!html.includes(MARKER)) {
        throw new Error(`index.html is missing the ${MARKER} marker the SEO plugin fills.`);
      }
      return html.replace(MARKER, renderSeoBlock('/'));
    },
    async writeBundle() {
      const index = await readFile(path.join(outDir, 'index.html'), 'utf8');

      const pages = Object.keys(ROUTE_SEO)
        .filter((route) => route !== '/')
        .map(async (route) => {
          const file = path.join(outDir, `${route.slice(1)}.html`);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, index.replace(BLOCK, renderSeoBlock(route)));
        });

      await Promise.all([
        ...pages,
        writeFile(path.join(outDir, 'robots.txt'), robotsTxt()),
        writeFile(path.join(outDir, 'sitemap.xml'), sitemapXml()),
      ]);
    },
  };
}
