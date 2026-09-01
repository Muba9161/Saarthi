import type { NearbyCategory } from '@saarthi/shared';

/**
 * Nearby places directory contract.
 *
 * The provider answers "what is actually at this point on the ground", nothing
 * more. Distance, compass direction, ordering, caching and the PostgreSQL
 * mirror are Saarthi's concern — keeping that boundary here is what lets a
 * second directory be added, or two blended, without the map, the service layer
 * or the driver screens changing.
 */

export interface PlaceSearch {
  latitude: number;
  longitude: number;
  radiusKm: number;
  /** Empty or omitted means every category the provider can answer for. */
  categories?: readonly NearbyCategory[] | undefined;
  limit: number;
}

/**
 * A place as the directory describes it: coerced to sane types, mapped onto
 * Saarthi's category vocabulary, but not yet measured against the caller's
 * point or persisted.
 */
export interface ProviderPlace {
  /** The directory's own id. Required — it is half of the idempotency key. */
  externalId: string;
  category: NearbyCategory;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  /**
   * The directory states round-the-clock opening. `false` means "not stated",
   * never "confirmed closed" — no directory publishes that reliably.
   */
  open24Hours: boolean;
  /** Opening hours as published, verbatim. */
  openingHours: string | null;
  /** Curated provider attributes: brand, operator, cuisine, capacity, … */
  attributes: Record<string, unknown>;
}

export interface PlaceSearchResponse {
  places: ProviderPlace[];
  /** Matches inside the radius before the limit was applied, when published. */
  totalWithinRadius: number | null;
}

export interface PlaceProvider {
  readonly name: string;
  /** Categories this provider can actually answer for. */
  readonly categories: readonly NearbyCategory[];
  search(input: PlaceSearch): Promise<PlaceSearchResponse>;
}
