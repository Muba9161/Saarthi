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
