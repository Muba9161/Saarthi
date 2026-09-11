import { en, type Catalogue } from './en';

/**
 * Which catalogue serves which locale, and how to fetch it.
 *
 * A language in the catalogue but absent here still selects — every lookup
 * falls back to the English source, so an untranslated locale renders the app
 * in English rather than in blanks. `hasTranslations` is what lets the picker
 * say so honestly instead of promising a translation that does not exist.
 *
 * The catalogues load on demand rather than being imported together. Eighteen
 * languages is 380 kB of source, and statically importing all of them put the
 * whole set in the entry bundle: every user downloaded seventeen languages
 * they had not chosen before the app could paint. Indic scripts are
 * multi-byte, so that weight survives compression far better than English
 * does, and it landed hardest on exactly the low-end Android handsets and
 * mobile connections this app is for.
 *
 * English is the exception and stays static: it is the fallback for every
 * lookup in every locale, so it is needed before anything else can render.
 */

type CatalogueLoader = () => Promise<Catalogue>;

const LOADERS: Readonly<Record<string, CatalogueLoader>> = {
  'as-IN': () => import('./as').then((m) => m.as),
  'bn-IN': () => import('./bn').then((m) => m.bn),
  'doi-IN': () => import('./doi').then((m) => m.doi),
  'gu-IN': () => import('./gu').then((m) => m.gu),
  'hi-IN': () => import('./hi').then((m) => m.hi),
  'kn-IN': () => import('./kn').then((m) => m.kn),
  'kok-IN': () => import('./kok').then((m) => m.kok),
  'mai-IN': () => import('./mai').then((m) => m.mai),
  'ml-IN': () => import('./ml').then((m) => m.ml),
  'mr-IN': () => import('./mr').then((m) => m.mr),
  'ne-IN': () => import('./ne').then((m) => m.ne),
  'or-IN': () => import('./or').then((m) => m.or),
  'pa-IN': () => import('./pa').then((m) => m.pa),
  'sa-IN': () => import('./sa').then((m) => m.sa),
  'ta-IN': () => import('./ta').then((m) => m.ta),
  'te-IN': () => import('./te').then((m) => m.te),
  'ur-IN': () => import('./ur').then((m) => m.ur),
};

/** Catalogues that have arrived. English is present from the start. */
const loaded = new Map<string, Catalogue>([['en-IN', en]]);

/** In-flight loads, so a locale is never fetched twice concurrently. */
const pending = new Map<string, Promise<void>>();

/**
 * True when the locale has a translation of its own.
 *
 * Synchronous and independent of loading, because the language picker asks
 * this about every language in the list in order to label the ones that fall
 * back to English — fetching eighteen catalogues to answer it would undo the
 * point of loading them on demand.
 */
export function hasTranslations(locale: string): boolean {
  return locale === 'en-IN' || locale in LOADERS;
}

/**
 * The catalogue for a locale, if it is already in memory.
 *
 * Returns undefined rather than waiting: `t()` is synchronous and must stay
 * that way, and a miss renders the English source, which is a correct
 * sentence rather than a gap. See `loadCatalogue` for closing that window.
 */
export function catalogueFor(locale: string): Catalogue | undefined {
  return loaded.get(locale);
}

/**
 * Fetch a locale's catalogue.
 *
 * Resolves immediately for a locale already held, and for one with no
 * translation of its own — English is already loaded and is what that locale
 * renders. A failed fetch resolves rather than rejects: the app is still
 * usable in English, and a chunk that failed on a flaky connection should be
 * retried on the next switch instead of propagating an error into render.
 */
export async function loadCatalogue(locale: string): Promise<void> {
  if (loaded.has(locale)) return;

  const load = LOADERS[locale];
  if (!load) return;

  const existing = pending.get(locale);
  if (existing) return existing;

  const request = load()
    .then((catalogue) => {
      loaded.set(locale, catalogue);
    })
    .catch(() => {
      // English still renders. Leave the locale unloaded so a later switch
      // back to it tries again rather than caching the failure.
    })
    .finally(() => {
      pending.delete(locale);
    });

  pending.set(locale, request);
  return request;
}

export { en };
export type { Catalogue };
export type { TranslationKey } from './en';
