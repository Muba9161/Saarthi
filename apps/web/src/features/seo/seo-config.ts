/**
 * The site's search and sharing metadata, in one place.
 *
 * Read from two sides, which is why this file is plain data with no imports:
 *
 *  * at build time by `vite/seo-plugin.ts`, which writes these values into the
 *    static HTML each public URL is served with — what a crawler or a link
 *    preview bot reads before any JavaScript runs;
 *  * at runtime by `route-seo.ts`, which keeps the same tags right as the
 *    visitor moves between pages without a reload.
 *
 * A route missing from `ROUTE_SEO` is treated as private: it keeps the app's
 * plain title and is marked `noindex`. So a new screen behind the sign-in wall
 * needs nothing here, and a new public page is invisible to search until it
 * is added — the safe way round.
 */

export const SITE = {
  name: 'VorldX Saarthi',
  /** The canonical origin. nginx 301s http:// and www. here. */
  url: 'https://vorldxsaarthi.com',
  locale: 'en_IN',
  language: 'en-IN',
  themeColor: '#011c45',
  /** 1200×630, under WhatsApp's 300 KB preview limit. */
  ogImage: {
    path: '/og-image.jpg',
    width: 1200,
    height: 630,
    alt: 'VorldX Saarthi - smart fleet, safe journeys. A truck, cars and a bus on an Indian highway.',
  },
  logoPath: '/web-app-manifest-512x512.png',
  /** Official profiles. Also rendered as the footer's social links. */
  social: {
    instagram: 'https://www.instagram.com/vorldxsaarthi/',
    youtube: 'https://www.youtube.com/@vorldxsaarthi',
  },
} as const;

/** The tab title every private screen keeps. */
export const APP_TITLE = 'VorldX Saarthi - Fleet Operations Platform';

export interface RouteSeo {
  title: string;
  description: string;
  /** Whether search engines may index the page. Indexable routes enter the sitemap. */
  indexable: boolean;
}

const HOME_DESCRIPTION =
  'One app for trucks, buses and cars: live GPS tracking, trips, drivers, fuel and documents, ' +
  'a freight marketplace and driver SOS - in Hindi, Tamil, Bengali and more Indian languages. Start free.';

/** Pages reachable without an account. The key is the exact pathname. */
export const ROUTE_SEO: Readonly<Record<string, RouteSeo>> = {
  '/': {
    title: 'Fleet Management & GPS Tracking Software in India | VorldX Saarthi',
    description: HOME_DESCRIPTION,
    indexable: true,
  },
  '/terms': {
    title: 'Terms of Service | VorldX Saarthi',
    description:
      'The agreement between you and VorldX Saarthi: what you may do with the platform, what we are responsible for, and what we are not.',
    indexable: true,
  },
  '/privacy': {
    title: 'Privacy Policy | VorldX Saarthi',
    description:
      'What VorldX Saarthi collects about you and your vehicles, why, who sees it, how long it is kept, and how to get it changed or removed.',
    indexable: true,
  },
  // Account screens: public, but a form is not a search result.
  '/login': {
    title: 'Sign in | VorldX Saarthi',
    description: 'Sign in to VorldX Saarthi to manage your fleet, trips and drivers.',
    indexable: false,
  },
  '/register': {
    title: 'Create your free account | VorldX Saarthi',
    description:
      'Create a free VorldX Saarthi account for fleet management, live tracking and the freight marketplace.',
    indexable: false,
  },
  '/forgot-password': {
    title: 'Reset your password | VorldX Saarthi',
    description: 'Reset the password for your VorldX Saarthi account.',
    indexable: false,
  },
  '/reset-password': {
    title: 'Choose a new password | VorldX Saarthi',
    description: 'Choose a new password for your VorldX Saarthi account.',
    indexable: false,
  },
  '/sales/join': {
    title: 'Join as a salesperson | VorldX Saarthi',
    description: 'Join VorldX Saarthi as a salesperson with your GODID.',
    indexable: false,
  },
};

export const NOT_FOUND_SEO: RouteSeo = {
  title: 'Page not found | VorldX Saarthi',
  description: 'The page you are looking for does not exist.',
  indexable: false,
};

const PRIVATE_SEO: RouteSeo = {
  title: APP_TITLE,
  description: HOME_DESCRIPTION,
  indexable: false,
};

/** Drops a trailing slash so `/terms/` and `/terms` resolve alike. */
function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function resolveRouteSeo(pathname: string): RouteSeo {
  return ROUTE_SEO[normalizePath(pathname)] ?? PRIVATE_SEO;
}

/** The absolute canonical URL for a path — no query, no hash, no trailing slash. */
export function canonicalUrl(pathname: string): string {
  const path = normalizePath(pathname);
  return path === '/' ? `${SITE.url}/` : `${SITE.url}${path}`;
}

export function indexableRoutes(): string[] {
  return Object.entries(ROUTE_SEO)
    .filter(([, seo]) => seo.indexable)
    .map(([path]) => path);
}
