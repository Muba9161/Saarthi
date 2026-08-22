import type { PetrolFuelFilter } from '@saarthi/shared';

/**
 * Petrol station directory contract.
 *
 * The provider returns stations only; distance, ordering, caching and
 * persistence are Saarthi's concern, not the directory's. Keeping the
 * boundary here means a second directory (or a blend of two) can be added
 * without the map or the service layer changing.
 */

export interface PetrolStationSearch {
  latitude: number;
  longitude: number;
  radiusKm: number;
  limit: number;
  fuelType?: PetrolFuelFilter | undefined;
  company?: string | undefined;
}

/**
 * A station as the directory describes it, already coerced to sane types but
 * not yet enriched with distance or persisted.
 */
export interface ProviderPetrolStation {
  /** The directory's own id. Required — it is half of the idempotency key. */
  externalId: string;
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
  petrolPrice: number | null;
  dieselPrice: number | null;
  cngPrice: number | null;
  timings: string | null;
  directionsUrl: string | null;
  /** Untouched provider record, persisted so a mapping fix can be replayed. */
  raw: Record<string, unknown>;
}

export interface PetrolStationSearchResponse {
  stations: ProviderPetrolStation[];
  /** Matches inside the radius before the limit was applied, when published. */
  totalWithinRadius: number | null;
}

export interface PetrolStationProvider {
  readonly name: string;
  search(input: PetrolStationSearch): Promise<PetrolStationSearchResponse>;
}
