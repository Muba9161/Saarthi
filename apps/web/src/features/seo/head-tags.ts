import { SITE, canonicalUrl, type RouteSeo } from './seo-config';

/**
 * The per-page `<head>` tags, described once.
 *
 * The build serialises these into each public URL's static HTML and the
 * runtime writes the same list into the live document, so the two can never
 * disagree about what a page says about itself. Every tag carries `data-seo`,
 * which is how the runtime finds the set it owns and replaces it wholesale.
 */

export interface HeadTag {
  tag: 'meta' | 'link';
  attrs: Record<string, string>;
}

export const SEO_ATTRIBUTE = 'data-seo';

const meta = (key: 'name' | 'property', id: string, content: string): HeadTag => ({
  tag: 'meta',
  attrs: { [key]: id, content },
});

export function buildHeadTags(pathname: string, seo: RouteSeo): HeadTag[] {
  const url = canonicalUrl(pathname);
  const image = `${SITE.url}${SITE.ogImage.path}`;

  const tags: HeadTag[] = [
    meta('name', 'description', seo.description),
    meta(
      'name',
      'robots',
      seo.indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow',
    ),
  ];

  // A canonical on a noindex page sends two opposite signals; leave it off.
  if (seo.indexable) tags.push({ tag: 'link', attrs: { rel: 'canonical', href: url } });

  tags.push(
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', SITE.name),
    meta('property', 'og:locale', SITE.locale),
    meta('property', 'og:title', seo.title),
    meta('property', 'og:description', seo.description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', String(SITE.ogImage.width)),
    meta('property', 'og:image:height', String(SITE.ogImage.height)),
    meta('property', 'og:image:alt', SITE.ogImage.alt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', seo.title),
    meta('name', 'twitter:description', seo.description),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', SITE.ogImage.alt),
  );

  return tags.map((tag) => ({ ...tag, attrs: { ...tag.attrs, [SEO_ATTRIBUTE]: '' } }));
}
