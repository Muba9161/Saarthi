import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { PetrolFuelFilter, PetrolStationSearchResult } from '@saarthi/shared';
import { api } from '@/lib/api-client';

/**
 * Petrol stations around a point.
 *
 * The query key is rounded to ~1 km so nudging the map re-uses the cached
 * result instead of re-querying on every pan; the backend rounds identically,
 * so the two caches line up rather than fighting each other.
 */

export interface PetrolStationQueryOptions {
  latitude: number;
  longitude: number;
  radiusKm: number;
  fuelType?: PetrolFuelFilter | null;
  company?: string | null;
  limit?: number;
  enabled?: boolean;
}

export function usePetrolStations({
  latitude,
  longitude,
  radiusKm,
  fuelType = null,
  company = null,
  limit = 40,
  enabled = true,
}: PetrolStationQueryOptions): UseQueryResult<PetrolStationSearchResult> {
  return useQuery({
    queryKey: [
      'petrol-stations',
      latitude.toFixed(2),
      longitude.toFixed(2),
      radiusKm,
      limit,
      fuelType,
      company,
    ],
    queryFn: () =>
      api.get<PetrolStationSearchResult>('/petrol-stations', {
        latitude,
        longitude,
        radiusKm,
        limit,
        ...(fuelType ? { fuelType } : {}),
        ...(company ? { company } : {}),
      }),
    enabled,
    // Fuel prices move at most daily; the server caches for hours anyway.
    staleTime: 5 * 60_000,
  });
}
