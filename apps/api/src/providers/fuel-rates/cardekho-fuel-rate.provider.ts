import { PETROL_FUEL_FILTERS, fuelRateUnit, isPlausibleFuelRate } from '@saarthi/shared';
import type { FuelRateEntry, PetrolFuelFilter } from '@saarthi/shared';
import { config } from '../../config/env';
import { errors, isAppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type {
  FuelRateLookup,
  FuelRateProvider,
  FuelRateScope,
  ProviderCityFuelRate,
} from './fuel-rate.provider';

/**
 * CarDekho retail fuel rate adapter.
 *
 * Behaviour observed against the live pages on 2026-08-31 and encoded here:
 *
 *  * `GET /{fuel}-price-in-{city}-city` serves a fully rendered page for
 *    petrol, diesel and CNG. No JavaScript is needed and no key is required.
 *  * District coverage is good — Kanpur, Mathura, Meerut and Agra all resolve,
 *    where other publishers only carry the metros. This matters for a fleet
 *    working the UP and Haryana corridors.
 *  * An unknown city does NOT 404. It answers 200 serving the New Delhi page —
 *    verified with two nonsense slugs — so HTTP status is no evidence that the
 *    city was recognised. The page must be checked to name the city we asked
 *    for, which {@link parseFuelRate} does.
 *
 * Three parsing decisions carry the weight of this file, each guarding against
 * a way a plausible-looking wrong number could reach a driver:
 *
 *  * The price is read from a *labelled* sentence — "The average Petrol price
 *    in Lucknow stands at ₹102.31" — and not from the first rupee figure on the
 *    page. The first figure is a trend-table row: on the Lucknow page it is
 *    ₹101.86, the rate from 24 August, which is exactly the kind of number that
 *    looks plausible and is a week stale.
 *  * The city in that sentence must match the city requested, or the New Delhi
 *    fallback would be published under another city's name.
 *  * Every figure is bounds-checked. If the page changes shape and yields a
 *    year or a page number, the fuel is dropped rather than published. For fuel
 *    prices absent is safe and wrong is not.
 */

const PROVIDER_NAME = 'cardekho';
const ATTRIBUTION = 'CarDekho';

/**
 * A browser user agent.
 *
 * Not evasion: the page is public and unauthenticated, but it is served to
 * browsers and a bare fetch agent gets a different, script-dependent variant
 * that carries no price at all.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Cities whose common name is not the slug the publisher keys on.
 *
 * Checked against the live pages on 2026-10-10. `trivandrum` and `baroda` used
 * to be listed here and now serve the New Delhi fallback — the publisher moved
 * both to their official names — so they are gone. Ayodhya is still priced
 * under its former name, Faizabad.
 */
const CITY_SLUG_ALIASES: Record<string, string> = {
  gurugram: 'gurgaon',
  bengaluru: 'bangalore',
  delhi: 'new-delhi',
  'new delhi': 'new-delhi',
  mysuru: 'mysore',
  puducherry: 'pondicherry',
  prayagraj: 'allahabad',
  ayodhya: 'faizabad',
};

/** A place name as the publisher writes it in a URL, with no aliasing. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function citySlug(city: string): string {
  const normalized = city.trim().toLowerCase().replace(/\s+/g, ' ');
  return CITY_SLUG_ALIASES[normalized] ?? slugify(normalized);
}

/** Strip markup so the labelled sentence can be matched as prose. */
function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8377;/g, '₹')
    .replace(/\s+/g, ' ');
}

/**
 * Outcome of reading one page.
 *
 *  * `ok` — a labelled figure for the right city, inside its plausible band.
 *  * `wrong-city` — the page is for somewhere else. The publisher answers 200
 *    with the New Delhi page for any unrecognised slug, so this is the guard
 *    that stops Delhi's rate being labelled as an uncovered city's.
 *  * `implausible` — the sentence was found but the number failed its band,
 *    which means the page changed shape. Worth a warning.
 *  * `absent` — the page is for the right city but carries no rate for this
 *    fuel. Normal: not every district retails CNG.
 *  * `unrecognised` — the page names no city at all. A bot wall, an error page
 *    or a redesign, served with a 200. It proves nothing about coverage, so it
 *    must never be cached as "this city has no rate".
 */
export type FuelRateParse =
  | { status: 'ok'; price: number }
  | { status: 'wrong-city'; found: string }
  | { status: 'implausible'; price: number }
  | { status: 'absent' }
  | { status: 'unrecognised' };

/** Compare place names the way the publisher's own slugs do. */
function samePlace(found: string, expectedSlug: string): boolean {
  return citySlug(found) === expectedSlug;
}

/**
 * The labelled sentence carrying each fuel's rate, e.g.
 * "The average Petrol price in Lucknow stands at ₹102.31".
 *
 * Written as three regex literals rather than built from a template string.
 * `new RegExp(\`${fuel}\\s+price\`)` is a trap here: inside a template literal
 * a lone `\s` is not an escape, so it collapses to a bare `s` and the pattern
 * silently matches nothing — which is exactly how this file first shipped a
 * parser that found no prices at all. A literal cannot go wrong that way.
 */
const PRICE_PATTERNS: Record<PetrolFuelFilter, RegExp> = {
  petrol:
    /petrol\s+price\s+in\s+([A-Za-z .()'-]{2,40}?)\s+stands\s+at\s*(?:Rs\.?|₹)\s*([0-9]{2,3}(?:\.[0-9]{1,2})?)/i,
  diesel:
    /diesel\s+price\s+in\s+([A-Za-z .()'-]{2,40}?)\s+stands\s+at\s*(?:Rs\.?|₹)\s*([0-9]{2,3}(?:\.[0-9]{1,2})?)/i,
  cng: /cng\s+price\s+in\s+([A-Za-z .()'-]{2,40}?)\s+stands\s+at\s*(?:Rs\.?|₹)\s*([0-9]{2,3}(?:\.[0-9]{1,2})?)/i,
};

/**
 * The city a page is for, from its title.
 *
 * "Petrol price in New Delhi Today (10 October, 2026) | …". The title is the
 * one place every variant of the page names its city — including the New Delhi
 * fallback, which carries no labelled rate sentence at all — so it is what tells
 * "a page for another city" apart from "a page we could not read".
 */
const TITLE_CITY_PATTERN =
  /<title>[^<]*?(?:petrol|diesel|cng)\s+price\s+in\s+([A-Za-z .()'-]{2,40}?)\s+today/i;

function pageCity(html: string): string | null {
  return html.match(TITLE_CITY_PATTERN)?.[1]?.trim() ?? null;
}

/**
 * Read the price from the sentence that names the fuel and the city.
 *
 * Two guards, both load-bearing:
 *
 *  * The figure comes from a *labelled* sentence — "The average Petrol price in
 *    Lucknow stands at ₹102.31" — never the first rupee amount on the page. The
 *    first amount is a trend-table row: on the Lucknow page it is ₹101.86, the
 *    rate from a week earlier, which looks entirely plausible and is stale.
 *  * The place in that sentence must be the place we asked for. An unrecognised
 *    city does not 404 here; it serves the New Delhi page with a 200, so
 *    without this check an uncovered city would silently show Delhi's rate.
 *
 * With no labelled sentence the page title decides between `wrong-city`,
 * `absent` and `unrecognised`, because only the first two say anything about
 * whether the publisher covers the city.
 *
 * Exported for unit testing against captured markup, so a layout change is
 * caught by a test rather than by a driver reading a wrong number.
 */
export function parseFuelRate(
  html: string,
  fuel: PetrolFuelFilter,
  expectedSlug: string,
): FuelRateParse {
  const match = plainText(html).match(PRICE_PATTERNS[fuel]);

  if (!match?.[1] || !match[2]) {
    const titled = pageCity(html);
    if (!titled) return { status: 'unrecognised' };
    if (!samePlace(titled, expectedSlug)) return { status: 'wrong-city', found: titled };
    return { status: 'absent' };
  }

  const found = match[1].trim();
  if (!samePlace(found, expectedSlug)) return { status: 'wrong-city', found };

  const price = Number(match[2]);
  if (!isPlausibleFuelRate(fuel, price)) return { status: 'implausible', price };

  return { status: 'ok', price };
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * The date the publisher stamped on the page, as ISO `YYYY-MM-DD`.
 *
 * Returns `null` rather than today's date when none is found. "When we fetched
 * it" is not "when it was priced", and treating the two as one is precisely
 * what let a 2024 figure pass as current.
 */
export function parsePublishedOn(html: string): string | null {
  const text = plainText(html);
  // "Petrol price in Lucknow Today (31 August, 2026)"
  const match = text.match(/\(\s*(\d{1,2})\s+([A-Za-z]+),?\s+(20\d{2})\s*\)/);
  if (!match) return null;

  const day = Number(match[1]);
  const monthIndex = MONTHS.indexOf((match[2] ?? '').toLowerCase());
  const year = Number(match[3]);
  if (monthIndex < 0 || day < 1 || day > 31) return null;

  const month = String(monthIndex + 1).padStart(2, '0');
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

/** What fetching one fuel's page came to, before it is parsed. */
type FetchedPage =
  | { fuel: PetrolFuelFilter; outcome: 'page'; html: string }
  | { fuel: PetrolFuelFilter; outcome: 'uncovered' }
  | { fuel: PetrolFuelFilter; outcome: 'failed'; error: unknown };

export class CardekhoFuelRateProvider implements FuelRateProvider {
  readonly name = PROVIDER_NAME;
  readonly attribution = ATTRIBUTION;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = config.fuelRates.baseUrl;
    this.timeoutMs = config.fuelRates.timeoutMs;
  }


  /**
   * Fetch one fuel's page. `null` means the city is not covered.
   *
   * The timeout covers the body as well as the headers. The page is a third of
   * a megabyte, and a body that stalls after its headers arrived used to hang
   * the driver's request well past the app's own patience.
   */
  private async fetchPage(
    fuel: PetrolFuelFilter,
    slug: string,
    scope: FuelRateScope,
  ): Promise<string | null> {
    const url = `${this.baseUrl}/${fuel}-price-in-${slug}-${scope}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
        // A redirect means the city fell through to a national page, which
        // carries a different city's rate. Following it would be worse than
        // returning nothing.
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status === 404 || (response.status >= 300 && response.status < 400)) {
        return null;
      }

      if (response.status === 429) {
        throw errors.providerRateLimited(
          this.name,
          'Too many fuel rate lookups right now. Please wait a moment.',
        );
      }

      if (!response.ok) {
        logger.warn(
          { provider: this.name, status: response.status, fuel },
          'Fuel rate publisher returned an error status',
        );
        throw errors.providerUnavailable(
          this.name,
          'Fuel rates are temporarily unavailable. Please try again.',
        );
      }

      return await response.text();
    } catch (error) {
      if (isAppError(error)) throw error;
      if ((error as Error).name === 'AbortError') {
        throw errors.providerTimeout(this.name, 'The fuel rate publisher took too long to respond.');
      }
      throw errors.providerUnavailable(
        this.name,
        'Fuel rates are temporarily unavailable. Please try again.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /** One fuel's page, with a fetch failure kept rather than thrown. */
  private async readPage(
    fuel: PetrolFuelFilter,
    slug: string,
    scope: FuelRateScope,
  ): Promise<FetchedPage> {
    try {
      const html = await this.fetchPage(fuel, slug, scope);
      return html === null ? { fuel, outcome: 'uncovered' } : { fuel, outcome: 'page', html };
    } catch (error) {
      return { fuel, outcome: 'failed', error };
    }
  }

  async lookup(input: FuelRateLookup): Promise<ProviderCityFuelRate | null> {
    // A state page is keyed on the state's own name; city aliases do not apply.
    const scope = input.scope ?? 'city';
    const slug = scope === 'state' ? slugify(input.city) : citySlug(input.city);
    if (!slug) return null;

    const entries: Partial<Record<PetrolFuelFilter, FuelRateEntry | null>> = {};
    let publishedOn: string | null = null;
    /** Set only by a figure we are willing to publish. */
    let covered = false;
    /** The first fetch failure, rethrown when nothing else could be read. */
    let failure: unknown = null;
    /** A page that named no city says nothing about coverage either way. */
    let unrecognised = false;

    /*
     * Three pages, fetched together: one round trip's latency instead of three.
     *
     * Each settles on its own. One slow CNG page used to reject the whole
     * lookup, so a petrol vehicle in a city with a perfectly good petrol rate
     * was shown none at all.
     */
    const pages = await Promise.all(PETROL_FUEL_FILTERS.map((fuel) => this.readPage(fuel, slug, scope)));

    for (const page of pages) {
      const { fuel } = page;
      entries[fuel] = null;

      if (page.outcome === 'failed') {
        failure ??= page.error;
        continue;
      }
      if (page.outcome === 'uncovered') continue;

      const parsed = parseFuelRate(page.html, fuel, slug);

      if (parsed.status === 'ok') {
        // Only trust the page's date once it has proved to be the right city's.
        publishedOn ??= parsePublishedOn(page.html);
        entries[fuel] = { price: parsed.price, unit: fuelRateUnit(fuel) };
        covered = true;
        continue;
      }

      if (parsed.status === 'implausible') {
        logger.warn(
          { provider: this.name, fuel, city: input.city, price: parsed.price },
          'Fuel rate failed its plausibility band — the page layout may have changed',
        );
      } else if (parsed.status === 'unrecognised') {
        unrecognised = true;
        logger.warn(
          { provider: this.name, fuel, city: input.city },
          'Fuel rate page named no city — blocked, erroring or redesigned',
        );
      } else if (parsed.status === 'wrong-city') {
        // The national fallback. Normal for an uncovered city, and the reason
        // HTTP status alone cannot be trusted here.
        logger.debug(
          { provider: this.name, fuel, requested: input.city, served: parsed.found },
          'Fuel rate page was for a different city — treating the city as uncovered',
        );
      }
    }

    if (!covered) {
      /*
       * Nothing usable — but "the publisher does not cover this city" is only
       * true when the publisher said so. A failed fetch or an unreadable page
       * is thrown instead, so the service never caches a passing failure as
       * hours of "no rate" for a city that has one.
       */
      if (failure !== null) throw failure;
      if (unrecognised) {
        throw errors.providerUnavailable(
          this.name,
          'Fuel rates are temporarily unavailable. Please try again.',
        );
      }
      return null;
    }

    return {
      city: input.city.trim(),
      state: input.state?.trim() ?? null,
      petrol: entries.petrol ?? null,
      diesel: entries.diesel ?? null,
      cng: entries.cng ?? null,
      publishedOn,
      source: ATTRIBUTION,
      incomplete: failure !== null || unrecognised,
    };
  }
}
