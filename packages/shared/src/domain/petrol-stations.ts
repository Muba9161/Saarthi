/**
 * Petrol station domain contract.
 *
 * Saarthi's own normalised station model. The upstream directory's field
 * names, string-typed coordinates and string-typed prices are all converted
 * in `apps/api/src/providers/petrol-stations`; nothing downstream sees them.
 *
 * Honesty rule: `hasPetrol` / `hasDiesel` / `hasCng` mean "the directory lists
 * this station as selling that fuel". They are NOT a live inventory, tank or
 * dispenser signal, and must never be rendered as "available now". Prices are
 * the provider's published rate for the station's area, not a live pump
 * reading — the provider supplies no observation timestamp, so we publish none.
 */

export interface PetrolStation {
  /** Saarthi id, stable across refreshes: `<source>:<externalId>`. */
  id: string;
  /** The provider's own identifier for the station. */
  externalId: string | null;
  /** Directory this station came from, e.g. `ssr`. */
  source: string;

  name: string | null;
  company: string | null;

  latitude: number;
  longitude: number;

  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;

  /** The directory lists this fuel as sold here. Not live availability. */
  hasPetrol: boolean | null;
  hasDiesel: boolean | null;
  hasCng: boolean | null;

  /** Published rate in ₹ per litre (CNG: ₹ per kg), or `null` if not listed. */
  petrolPrice: number | null;
  dieselPrice: number | null;
  cngPrice: number | null;

  /** Free-text opening hours exactly as published, e.g. "24 Hours". */
  timings: string | null;
  /** Provider-supplied map deep link, when one is published. */
  directionsUrl: string | null;

  /** Straight-line distance from the search origin, when searched by point. */
  distanceKm: number | null;
  /** Compass direction from the search origin, when searched by point. */
  direction: string | null;
}

export const PETROL_FUEL_FILTERS = ['petrol', 'diesel', 'cng'] as const;
export type PetrolFuelFilter = (typeof PETROL_FUEL_FILTERS)[number];

/** What `GET /api/v1/petrol-stations` returns. */
export interface PetrolStationSearchResult {
  stations: PetrolStation[];
  /** Stations the provider found in the radius before the limit was applied. */
  totalWithinRadius: number | null;
  radiusKm: number;
  /** Served from cache rather than a fresh provider call. */
  cached: boolean;
  /** The live directory was unreachable; these came from Saarthi's own store. */
  stale: boolean;
  retrievedAt: string;
}

/**
 * Label for a fuel row. Deliberately avoids "available" — the directory tells
 * us what a station sells, never what is in its tanks right now.
 */
export function fuelOfferingLabel(offered: boolean | null): string {
  if (offered === true) return 'Offered here';
  if (offered === false) return 'Not listed';
  return 'Not listed';
}

/** True when the published timings clearly describe a round-the-clock station. */
export function isAlwaysOpen(timings: string | null): boolean {
  if (!timings) return false;
  return /24\s*(hours|hrs|x7|\/7)/i.test(timings);
}

// ---------------------------------------------------------------------------
// What a station actually sells
// ---------------------------------------------------------------------------

/**
 * Whether a station sells a fuel.
 *
 * `unknown` is not padding. The directory publishes `has_petrol: true` and
 * `has_diesel: true` on *every* record — including outlets it names
 * "Indraprastha Gas Limited CNG Station" — so a `true` in those two fields is a
 * schema default, never an observation, and rendering it as a claim about the
 * forecourt is how a CNG-only pump came to advertise petrol.
 *
 * `has_cng` does carry information: it tracks the directory's own `fuel_type`
 * filter and is `false` on liquid-only pumps, so it is trusted as published.
 */
export type FuelOffering = 'sold' | 'not-sold' | 'unknown';

/**
 * Oil marketing companies. A branded forecourt sells petrol and diesel — that
 * is what the brand means — so the company name is better evidence than the
 * directory's defaulted flags.
 */
const LIQUID_FUEL_RETAILERS =
  /\b(iocl|indian\s?oil|bpcl|bharat\s?petroleum|hpcl|hindustan\s?petroleum|jio[-\s]?bp|reliance|nayara|essar|shell)\b/i;

/** City-gas distributors. These run CNG outlets, not petrol pumps. */
const GAS_ONLY_RETAILERS =
  /\b(indraprastha\s?gas|igl|mahanagar\s?gas|city\s?gas|gujarat\s?gas|adani\s?(total\s?)?gas|torrent\s?gas|sabarmati\s?gas|think\s?gas|megha\s?gas|assam\s?gas)\b/i;

/** A name that states outright what the outlet is, e.g. "… CNG Station". */
const CNG_ONLY_NAME = /\bcng\s*(station|pump|outlet|filling)\b/i;

/**
 * What the directory supports saying about one fuel at one station.
 *
 * Derived from the station's identity rather than from `hasPetrol` /
 * `hasDiesel`, for the reason documented on {@link FuelOffering}.
 */
export function stationFuelOffering(
  station: Pick<PetrolStation, 'name' | 'company' | 'hasCng'>,
  fuel: PetrolFuelFilter,
): FuelOffering {
  const identity = `${station.company ?? ''} ${station.name ?? ''}`;
  const gasOnly = GAS_ONLY_RETAILERS.test(identity) || CNG_ONLY_NAME.test(identity);
  const liquidRetailer = LIQUID_FUEL_RETAILERS.test(identity);

  if (fuel === 'cng') {
    if (station.hasCng === true) return 'sold';
    // A city-gas outlet sells CNG whatever the flag says.
    if (gasOnly && !liquidRetailer) return 'sold';
    if (station.hasCng === false) return 'not-sold';
    return 'unknown';
  }

  // A dedicated gas outlet has no petrol or diesel dispenser. An unbranded
  // pump might have either, and the directory does not say which.
  if (gasOnly && !liquidRetailer) return 'not-sold';
  if (liquidRetailer) return 'sold';
  return 'unknown';
}

/** Wording for a {@link FuelOffering}. Never reads as live availability. */
export function fuelOfferingText(offering: FuelOffering): string {
  if (offering === 'sold') return 'Sold here';
  if (offering === 'not-sold') return 'Not sold here';
  return 'Not published';
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Why no price is derived from this directory, and none is rendered.
 *
 * The directory publishes `petrol_price`, `diesel_price` and `cng_price`, and
 * they are not usable:
 *
 *  * They are a city rate, not a pump price. One figure per city, repeated onto
 *    every station in it — 38 of 40 stations around Gurugram carry the
 *    identical figure, and 100 sampled around Delhi carry one number between
 *    them.
 *  * The figure is years out of date. Measured 2026-08-31, the directory gave
 *    Gurugram petrol at 95.44 and diesel at 87.90 against real rates of 102.97
 *    and 95.64 — roughly 8% low on both, and matching the 2024 rates. Delhi's
 *    94.77 is likewise the 2024 figure.
 *  * There is no timestamp anywhere in the response, so staleness cannot even
 *    be disclosed to the reader.
 *
 * A fuel price drives trip costing and driver reimbursement. Being 8% low is
 * worse than being absent, because absent is obvious and wrong is not. The
 * fields stay on the model so the API contract is unchanged and a caller that
 * wants the raw directory value can still see it, but Saarthi renders no rate
 * from this source.
 *
 * Everything else the directory publishes — where a station is, who brands it,
 * its hours, which fuels it sells — is still shown, because that part holds up.
 */
export const FUEL_DIRECTORY_PRICE_NOTE =
  'The fuel directory publishes no current rate, so no price is shown here. It lists what a station sells and where it is.';
