import { NearbyCategory } from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type {
  PlaceProvider,
  PlaceSearch,
  PlaceSearchResponse,
  ProviderPlace,
} from './place.provider';

/**
 * OpenStreetMap places adapter, over the Overpass API.
 *
 * Why Overpass: the basemap, the routing and the elevation in this platform are
 * already OpenStreetMap-derived, so the points of interest drawn on top come
 * from the same survey rather than from a second vendor that disagrees with it.
 * It needs no key and no payment method, and its coverage of Indian highway
 * infrastructure — dhabas, tyre shops, weighbridges, truck halts — is the best
 * openly licensed dataset available.
 *
 * Honesty rules encoded here, because a driver acts on this data:
 *
 *  * `open24Hours` is set only when OSM states `24/7`. Anything else is "not
 *    stated", never "closed" — OSM opening hours are sparse and often stale.
 *  * OSM publishes no ratings, so no rating is invented. `rating` stays null all
 *    the way to the UI rather than being filled with a plausible number.
 *  * A record with no usable coordinate is dropped, not placed at 0,0.
 *
 * ## Working inside the public instance's budget
 *
 * The shape of the query below is not stylistic; it was measured against
 * `overpass-api.de` around Gurugram (28.4595, 77.0266), one of the densest OSM
 * areas in India, on 2026-08-31:
 *
 *  * **Exact tag matches, never regular expressions.** Overpass answers
 *    `["amenity"="fuel"]` from its key/value index; `["amenity"~"^(fuel|…)$"]`
 *    cannot use that index and has to scan every element carrying `amenity` in
 *    the area. Five regex clauses timed out where twenty-one exact ones
 *    returned in nine seconds.
 *  * **Cost tracks (number of selectors × radius), not either alone.** 21
 *    selectors at 8 km took 12 s; 10 at 25 km took 17 s; 21 at 25 km exceeded
 *    the dispatcher's budget and failed. `WORK_BUDGET` below is that
 *    observation turned into a limit.
 *  * **Dense categories do not need reach.** Nobody drives 25 km for a café,
 *    but a driver will cross a district for a weighbridge or a truck halt. So
 *    the two groups get different radii, which is what buys a whole-category
 *    answer inside the budget.
 *
 * A self-hosted Overpass has none of these constraints — raise
 * `OVERPASS_WORK_BUDGET` and it will simply search wider.
 *
 * Everything is cached and mirrored by the service layer on top, so a busy
 * instance costs freshness rather than the feature.
 *
 * Attribution: OpenStreetMap data is ODbL-licensed and must be credited wherever
 * it is shown. The map carries the basemap credit; the places list carries its
 * own, driven by the `source` field this adapter stamps on every record.
 */

const PROVIDER_NAME = 'osm';

/**
 * OSM selectors per Saarthi category — exact matches only, for the index
 * reasons above.
 *
 * Several per category is normal: OSM tags the same real-world thing more than
 * one way, and a truck repair shop tagged `shop=truck_repair` must not be missed
 * because the more common `shop=car_repair` was the only selector.
 *
 * Deliberately *not* queried, each because the cost outweighed what it added:
 * `amenity=doctors` (covered in practice by `clinic`), `healthcare=pharmacy`
 * (`amenity=pharmacy` carries nearly all of them), `shop=motorcycle_repair`
 * (irrelevant to a truck) and `cuisine~dhaba` (a regex over a poorly indexed
 * key; highway dhabas carry `amenity=restaurant` as well, so they still appear).
 */
const CATEGORY_SELECTORS: Record<NearbyCategory, readonly string[]> = {
  [NearbyCategory.FUEL]: ['["amenity"="fuel"]'],
  [NearbyCategory.FOOD]: [
    '["amenity"="restaurant"]',
    '["amenity"="fast_food"]',
    '["amenity"="cafe"]',
    '["amenity"="food_court"]',
  ],
  // The negated `access` filter runs against the already-indexed parking set, so
  // it costs nothing and keeps private compounds out of a driver's list.
  [NearbyCategory.PARKING]: [
    '["amenity"="parking"]["access"!~"^(private|no|customers|permissive)$"]',
  ],
  [NearbyCategory.WORKSHOP]: [
    '["shop"="car_repair"]',
    '["shop"="truck_repair"]',
    '["amenity"="vehicle_inspection"]',
  ],
  [NearbyCategory.TYRE_SHOP]: ['["shop"="tyres"]'],
  [NearbyCategory.HOSPITAL]: ['["amenity"="hospital"]', '["amenity"="clinic"]'],
  [NearbyCategory.PHARMACY]: ['["amenity"="pharmacy"]'],
  [NearbyCategory.POLICE]: ['["amenity"="police"]'],
  [NearbyCategory.REST_AREA]: [
    '["highway"="rest_area"]',
    '["highway"="services"]',
    '["amenity"="truck_stop"]',
  ],
  [NearbyCategory.CHARGING]: ['["amenity"="charging_station"]'],
  [NearbyCategory.WEIGHBRIDGE]: [
    '["amenity"="weighbridge"]',
    '["man_made"="weighbridge"]',
    '["highway"="weighbridge"]',
  ],
  // OSM has no "other" — nothing sensible to query, so nothing is queried.
  [NearbyCategory.OTHER]: [],
};

/**
 * Categories thick on the ground in any town, and therefore searched near.
 *
 * The split is about how far a driver would actually travel for the thing, which
 * happens to be the same split that keeps the query affordable.
 */
const DENSE_CATEGORIES: ReadonlySet<NearbyCategory> = new Set([
  NearbyCategory.FOOD,
  NearbyCategory.PHARMACY,
  NearbyCategory.HOSPITAL,
  NearbyCategory.PARKING,
  NearbyCategory.WORKSHOP,
]);

/** Ceiling on a dense category's reach, before the budget is applied. */
const DENSE_CAP_KM = 8;
/** Floors, so a heavily filtered query still returns something usable. */
const DENSE_FLOOR_KM = 3;
const SPARSE_FLOOR_KM = 6;

/**
 * Categories where an unnamed record is still worth showing.
 *
 * An unnamed fuel pump or charging point is actionable — you can drive to it and
 * use it. An unnamed restaurant or workshop is not: without a name a driver
 * cannot ask for it, phone it or recognise it, and the entry is pure noise on a
 * list they are meant to choose from.
 */
const NAME_OPTIONAL: ReadonlySet<NearbyCategory> = new Set([
  NearbyCategory.FUEL,
  NearbyCategory.CHARGING,
  NearbyCategory.REST_AREA,
  NearbyCategory.WEIGHBRIDGE,
  NearbyCategory.PARKING,
]);

/** Fallback label for an unnamed record in a category that allows one. */
const GENERIC_NAME: Partial<Record<NearbyCategory, string>> = {
  [NearbyCategory.FUEL]: 'Fuel station',
  [NearbyCategory.CHARGING]: 'Charging point',
  [NearbyCategory.REST_AREA]: 'Rest area',
  [NearbyCategory.WEIGHBRIDGE]: 'Weighbridge',
  [NearbyCategory.PARKING]: 'Parking',
};

/**
 * Tags kept in `attributes`.
 *
 * A deliberate subset rather than the whole tag bag: OSM elements can carry
 * dozens of tags, and mirroring all of them into PostgreSQL for every place in
 * the country is storage spent on data nothing reads.
 */
const KEPT_TAGS = [
  'brand',
  'operator',
  'cuisine',
  'capacity',
  'capacity:hgv',
  'hgv',
  'access',
  'fee',
  'website',
  'contact:website',
  'fuel:diesel',
  'fuel:lpg',
  'fuel:cng',
  'fuel:HGV_diesel',
  'compressed_air',
  'shower',
  'toilets',
  'emergency',
  'healthcare',
  'socket:type2',
  'socket:ccs',
  'wheelchair',
] as const;

/**
 * Hard cap on returned elements.
 *
 * Overpass cannot sort by distance, so a cap that actually bites would clip
 * arbitrarily and could drop the nearest place. Measured against the budget
 * above, a whole-category search of dense Gurugram returns ~400 elements, so
 * this sits comfortably clear of it and the cap never decides the answer.
 */
const MAX_ELEMENTS = 900;

/** Smallest useful attempt: below this an endpoint cannot finish anything. */
const MIN_ATTEMPT_MS = 6_000;

interface OverpassElement {
  type?: string;
  id?: number | string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  /** Present when Overpass refused or truncated the query. */
  remark?: string;
}

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // OSM contributors write these literally where a value is unknown.
  if (/^(unknown|n\/?a|none|-)$/i.test(trimmed)) return null;
  return trimmed;
}

/** Position of an element: nodes carry it directly, ways and relations centred. */
function position(element: OverpassElement): { latitude: number; longitude: number } | null {
  const latitude = typeof element.lat === 'number' ? element.lat : element.center?.lat;
  const longitude = typeof element.lon === 'number' ? element.lon : element.center?.lon;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (latitude === 0 && longitude === 0) return null;

  return { latitude, longitude };
}

/**
 * A street address from OSM's `addr:*` tags.
 *
 * Returns null rather than a fragment like ", Gurugram": a half address on a
 * card reads as a bug, and the category label is a better fallback.
 */
function address(tags: Record<string, string>): string | null {
  const full = text(tags['addr:full']);
  if (full) return full;

  const street = [text(tags['addr:housenumber']), text(tags['addr:street'])]
    .filter(Boolean)
    .join(' ');

  const parts = [
    street || null,
    text(tags['addr:suburb']) ?? text(tags['addr:neighbourhood']),
    text(tags['addr:city']) ?? text(tags['addr:town']) ?? text(tags['addr:village']),
    text(tags['addr:postcode']),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(', ') : null;
}

/** OSM states round-the-clock opening as `24/7`. Nothing else counts. */
function isAlwaysOpen(openingHours: string | null): boolean {
  if (!openingHours) return false;
  return /\b24\s*\/\s*7\b/i.test(openingHours);
}

function attributesOf(tags: Record<string, string>): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const tag of KEPT_TAGS) {
    const value = text(tags[tag]);
    if (value !== null) attributes[tag] = value;
  }
  return attributes;
}

/**
 * The Saarthi category an element belongs to.
 *
 * Order matters: an element can satisfy two selectors (a fuel station with a
 * café inside it), and the first match wins so the primary purpose of the place
 * decides where it is listed.
 */
function categoryOf(
  tags: Record<string, string>,
  wanted: readonly NearbyCategory[],
): NearbyCategory | null {
  const amenity = tags.amenity ?? '';
  const shop = tags.shop ?? '';
  const highway = tags.highway ?? '';

  const matches: [NearbyCategory, boolean][] = [
    [NearbyCategory.FUEL, amenity === 'fuel'],
    [NearbyCategory.CHARGING, amenity === 'charging_station'],
    [
      NearbyCategory.WEIGHBRIDGE,
      amenity === 'weighbridge' || tags.man_made === 'weighbridge' || highway === 'weighbridge',
    ],
    [
      NearbyCategory.REST_AREA,
      highway === 'rest_area' || highway === 'services' || amenity === 'truck_stop',
    ],
    [NearbyCategory.HOSPITAL, amenity === 'hospital' || amenity === 'clinic'],
    [NearbyCategory.PHARMACY, amenity === 'pharmacy'],
    [NearbyCategory.POLICE, amenity === 'police'],
    [NearbyCategory.TYRE_SHOP, shop === 'tyres'],
    [
      NearbyCategory.WORKSHOP,
      shop === 'car_repair' || shop === 'truck_repair' || amenity === 'vehicle_inspection',
    ],
    [
      NearbyCategory.FOOD,
      ['restaurant', 'fast_food', 'cafe', 'food_court'].includes(amenity),
    ],
    [NearbyCategory.PARKING, amenity === 'parking'],
  ];

  for (const [category, matched] of matches) {
    if (!matched) continue;
    // A category the caller filtered out must not be smuggled in under a
    // secondary tag match.
    return wanted.includes(category) ? category : null;
  }

  return null;
}

/**
 * Map one Overpass element onto a provider place. Returns null for anything
 * unusable — no position, no category, or no identity in a category that needs
 * one. Exported for unit testing.
 */
export function normalizeOverpassElement(
  element: OverpassElement,
  wanted: readonly NearbyCategory[],
): ProviderPlace | null {
  const tags = element.tags ?? {};
  const point = position(element);
  if (!point) return null;

  const category = categoryOf(tags, wanted);
  if (!category) return null;

  const identity =
    text(tags.name) ?? text(tags['name:en']) ?? text(tags.brand) ?? text(tags.operator);
  const name = identity ?? (NAME_OPTIONAL.has(category) ? GENERIC_NAME[category] ?? null : null);
  if (!name) return null;

  const rawId = text(element.id);
  const kind = text(element.type)?.[0] ?? 'n';
  if (!rawId) return null;

  const openingHours = text(tags.opening_hours);

  return {
    // `n123`/`w456`/`r789` — the OSM element identity, stable across edits and
    // unique across the three element types.
    externalId: `${kind}${rawId}`,
    category,
    name,
    address: address(tags),
    city: text(tags['addr:city']) ?? text(tags['addr:town']) ?? text(tags['addr:village']),
    state: text(tags['addr:state']),
    latitude: point.latitude,
    longitude: point.longitude,
    phone: text(tags.phone) ?? text(tags['contact:phone']) ?? text(tags['contact:mobile']),
    open24Hours: isAlwaysOpen(openingHours),
    openingHours,
    attributes: attributesOf(tags),
  };
}

/** Radii the two density tiers get for one search, in kilometres. */
export interface SearchRadii {
  denseKm: number;
  sparseKm: number;
}

/**
 * Split the work budget between the two tiers.
 *
 * Exported so the arithmetic can be tested without going near the network — it
 * is the part that decides whether a search succeeds or times out.
 */
export function resolveRadii(
  requestedKm: number,
  denseSelectors: number,
  sparseSelectors: number,
  options: { maxRadiusKm: number; workBudget: number },
): SearchRadii {
  // What each tier would ideally search, before cost is considered.
  let denseKm = Math.min(requestedKm, DENSE_CAP_KM);
  let sparseKm = Math.min(requestedKm, options.maxRadiusKm);

  const work = denseSelectors * denseKm + sparseSelectors * sparseKm;
  if (work > options.workBudget && work > 0) {
    // Shrink both in proportion, so a wide-but-cheap query is not penalised for
    // the sake of a narrow-but-expensive one.
    const scale = options.workBudget / work;
    denseKm = Math.max(Math.min(denseKm, DENSE_FLOOR_KM), denseKm * scale);
    sparseKm = Math.max(Math.min(sparseKm, SPARSE_FLOOR_KM), sparseKm * scale);
  }

  return {
    denseKm: Math.min(requestedKm, denseKm),
    sparseKm: Math.min(requestedKm, sparseKm),
  };
}

export class OverpassPlaceProvider implements PlaceProvider {
  readonly name = PROVIDER_NAME;

  /** Every category except OTHER, which has no OSM equivalent to query. */
  readonly categories: readonly NearbyCategory[] = (
    Object.keys(CATEGORY_SELECTORS) as NearbyCategory[]
  ).filter((category) => CATEGORY_SELECTORS[category].length > 0);

  private readonly endpoints: readonly string[];
  private readonly timeoutMs: number;
  private readonly maxRadiusKm: number;
  private readonly workBudget: number;

  constructor() {
    this.endpoints = config.places.overpassUrls;
    this.timeoutMs = config.places.timeoutMs;
    this.maxRadiusKm = config.places.maxRadiusKm;
    this.workBudget = config.places.workBudget;
  }

  /** The Overpass QL document for one search. */
  private buildQuery(
    input: PlaceSearch,
    wanted: readonly NearbyCategory[],
    radii: SearchRadii,
    serverTimeoutSeconds: number,
  ): string {
    const latitude = input.latitude.toFixed(6);
    const longitude = input.longitude.toFixed(6);

    const clauses = wanted.flatMap((category) => {
      const radiusMeters = Math.round(
        (DENSE_CATEGORIES.has(category) ? radii.denseKm : radii.sparseKm) * 1000,
      );
      return (CATEGORY_SELECTORS[category] ?? []).map(
        (selector) => `  nwr(around:${radiusMeters},${latitude},${longitude})${selector};`,
      );
    });

    return [
      `[out:json][timeout:${serverTimeoutSeconds}];`,
      '(',
      ...clauses,
      ');',
      // `center` gives ways and relations a single point; tags come with the
      // default body output.
      `out center ${MAX_ELEMENTS};`,
    ].join('\n');
  }

  /**
   * One HTTP attempt against one endpoint.
   *
   * Returns null for anything the next endpoint might answer better — a
   * timeout, a throttle, a dispatcher error — and throws only for a response
   * that no endpoint would improve on.
   */
  private async attempt(
    endpoint: string,
    query: string,
    budgetMs: number,
  ): Promise<OverpassResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), budgetMs);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          // Overpass asks every client to identify itself so it can contact the
          // operator of a misbehaving one instead of blocking silently.
          'user-agent': 'Saarthi/1.0 (fleet operations platform; nearby services)',
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: controller.signal,
      });
    } catch (error) {
      logger.warn(
        { provider: this.name, endpoint, err: (error as Error).name },
        'Overpass endpoint did not answer',
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }

    // 429 is the instance asking us to back off; 504 is its dispatcher giving
    // up. Both are another endpoint's chance, and then the mirror's.
    if (response.status === 429 || response.status === 502 || response.status === 504) {
      logger.warn(
        { provider: this.name, endpoint, status: response.status },
        'Overpass endpoint was busy',
      );
      return null;
    }

    if (!response.ok) {
      logger.warn(
        { provider: this.name, endpoint, status: response.status },
        'Overpass endpoint rejected the query',
      );
      return null;
    }

    let raw: OverpassResponse;
    try {
      raw = (await response.json()) as OverpassResponse;
    } catch {
      logger.warn(
        { provider: this.name, endpoint },
        'Overpass endpoint returned a body that was not JSON',
      );
      return null;
    }

    // Overpass reports a refused or aborted query as a `remark` on a 200.
    if (raw.remark && /timed out|out of memory|error/i.test(raw.remark)) {
      logger.warn(
        { provider: this.name, endpoint, remark: raw.remark },
        'Overpass endpoint could not finish the query',
      );
      return null;
    }

    return raw;
  }

  async search(input: PlaceSearch): Promise<PlaceSearchResponse> {
    const wanted =
      input.categories && input.categories.length > 0
        ? input.categories.filter((category) => this.categories.includes(category))
        : this.categories;

    // Nothing this provider can answer for — an empty answer, not an error.
    if (wanted.length === 0) return { places: [], totalWithinRadius: 0 };

    let denseSelectors = 0;
    let sparseSelectors = 0;
    for (const category of wanted) {
      const count = CATEGORY_SELECTORS[category]?.length ?? 0;
      if (DENSE_CATEGORIES.has(category)) denseSelectors += count;
      else sparseSelectors += count;
    }

    const radii = resolveRadii(input.radiusKm, denseSelectors, sparseSelectors, {
      maxRadiusKm: this.maxRadiusKm,
      workBudget: this.workBudget,
    });

    logger.debug(
      {
        provider: this.name,
        requested: input.radiusKm,
        dense: Number(radii.denseKm.toFixed(1)),
        sparse: Number(radii.sparseKm.toFixed(1)),
        categories: wanted.length,
      },
      'Nearby places search planned',
    );

    // One overall deadline across every endpoint, so a slow first endpoint
    // cannot leave the caller waiting for three timeouts in a row.
    const deadline = Date.now() + this.timeoutMs;
    let raw: OverpassResponse | null = null;

    for (const endpoint of this.endpoints) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_ATTEMPT_MS) break;

      // Ask Overpass to give up a little before we do, so a slow query comes
      // back as a readable remark rather than as an aborted socket.
      const serverTimeoutSeconds = Math.max(5, Math.floor(remaining / 1000) - 2);
      const query = this.buildQuery(input, wanted, radii, serverTimeoutSeconds);

      raw = await this.attempt(endpoint, query, remaining);
      if (raw) break;
    }

    if (!raw) {
      logger.error(
        { provider: this.name, endpoints: this.endpoints.length },
        'No Overpass endpoint could answer the places query',
      );
      throw errors.providerUnavailable(
        this.name,
        'The places directory is busy. Showing what we have on record.',
      );
    }

    const elements = raw.elements ?? [];
    const places: ProviderPlace[] = [];
    const seen = new Set<string>();

    for (const element of elements) {
      const place = normalizeOverpassElement(element, wanted);
      if (!place) continue;
      if (seen.has(place.externalId)) continue;
      seen.add(place.externalId);
      places.push(place);
    }

    logger.debug(
      { provider: this.name, elements: elements.length, places: places.length },
      'Nearby places retrieved',
    );

    return {
      places,
      // Overpass publishes no pre-limit count, and the tiered radii mean the
      // number returned is not one either. Saying nothing beats guessing.
      totalWithinRadius: null,
    };
  }
}
