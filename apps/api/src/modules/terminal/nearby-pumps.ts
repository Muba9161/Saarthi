import {
  bearing,
  compassDirection,
  distanceKm,
  type LatLng,
  type PetrolFuelFilter,
  type PetrolStation,
} from '@saarthi/shared';
import { logger } from '../../lib/logger';
import { searchPetrolStations } from '../petrol-stations/petrol-station.service';
import type { NearbyPlaceResult } from '../nearby/nearby.service';

/**
 * Fuel stops from the petrol pump directory, for the driver's Fuel list.
 *
 * OpenStreetMap maps a handful of pumps in most Indian towns — nine named ones
 * across all of Kanpur — and its public servers are often too busy to answer
 * at all. The pump directory lists every outlet of the oil companies with its
 * postal address, the fuels it sells and its hours, so it is the backbone of
 * the Fuel list; OpenStreetMap adds what the directory lacks (charging points,
 * a phone number) rather than standing alone.
 *
 * The directory's own prices are never shown: they are years out of date, and
 * today's rate comes from the fuel-rate service instead.
 */

const pumpLogger = logger.child({ module: 'nearby-pumps' });

/** Closer than this, an OpenStreetMap pump and a directory pump are one station. */
const SAME_STATION_KM = 0.08;

/** Searched from the ~1 km tile, so the directory's cached answer serves the whole tile. */
const TILE_PADDING_KM = 1;

const MAX_DIRECTORY_RADIUS_KM = 50;

/** The oil companies' short codes, as drivers know the brands. */
const BRANDS: Record<string, string> = {
  IOCL: 'Indian Oil',
  IOC: 'Indian Oil',
  BPCL: 'Bharat Petroleum',
  HPCL: 'HP',
  NAYARA: 'Nayara Energy',
  ESSAR: 'Nayara Energy',
  RBML: 'Jio-bp',
  'JIO-BP': 'Jio-bp',
  SHELL: 'Shell',
};

function brandOf(company: string | null): string | null {
  if (!company) return null;
  return BRANDS[company.trim().toUpperCase()] ?? company.trim();
}

/** "No 1, -, Kidwai Nagar, Kanpur Nagar, -, 209217" → "No 1, Kidwai Nagar, Kanpur Nagar, 209217". */
function tidyAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '-');
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.length > 0 ? unique.join(', ') : null;
}

function toPlace(station: PetrolStation, origin: LatLng, stale: boolean): NearbyPlaceResult {
  const target = { latitude: station.latitude, longitude: station.longitude };
  const brand = brandOf(station.company);
  return {
    id: station.id,
    category: 'FUEL',
    name: station.name ?? brand ?? 'Fuel station',
    address: tidyAddress(station.address),
    latitude: station.latitude,
    longitude: station.longitude,
    phone: null,
    rating: null,
    open24Hours: /24/.test(station.timings ?? ''),
    openingHours: station.timings,
    // Written in OpenStreetMap's own tag vocabulary, so one reader serves both.
    attributes: {
      ...(brand ? { brand } : {}),
      ...(station.hasDiesel ? { 'fuel:diesel': 'yes' } : {}),
      ...(station.hasPetrol ? { 'fuel:octane_91': 'yes' } : {}),
      ...(station.hasCng ? { 'fuel:cng': 'yes' } : {}),
    },
    distanceKm: Number(distanceKm(origin, target).toFixed(2)),
    direction: compassDirection(bearing(origin, target)),
    source: station.source,
    stale,
  };
}

/**
 * Directory pumps within `radiusKm` of the caller that sell `fuel`, measured
 * from the caller. Never throws: the Fuel list must not fail because one of
 * its two sources did.
 */
export async function pumpsNear(
  origin: LatLng,
  radiusKm: number,
  fuel: PetrolFuelFilter | undefined,
): Promise<NearbyPlaceResult[]> {
  try {
    const result = await searchPetrolStations({
      latitude: Number(origin.latitude.toFixed(2)),
      longitude: Number(origin.longitude.toFixed(2)),
      radiusKm: Math.min(MAX_DIRECTORY_RADIUS_KM, Math.ceil(radiusKm + TILE_PADDING_KM)),
      limit: 100,
      fuelType: fuel,
      company: undefined,
    });
    // Re-measured from the caller: the directory's cached distances are from
    // the tile centre, not from this vehicle.
    return result.stations
      .map((station) => toPlace(station, origin, result.stale))
      .filter((place) => place.distanceKm <= radiusKm);
  } catch (error) {
    pumpLogger.warn({ err: error }, 'Pump directory unavailable for the Fuel list');
    return [];
  }
}

/** Whether a mapped pump says it sells this fuel. */
function declares(place: NearbyPlaceResult, fuel: PetrolFuelFilter): boolean {
  const tags = (place.attributes ?? {}) as Record<string, unknown>;
  switch (fuel) {
    case 'diesel':
      return tags['fuel:diesel'] === 'yes' || tags['fuel:HGV_diesel'] === 'yes';
    case 'cng':
      return tags['fuel:cng'] === 'yes';
    case 'petrol':
      return tags['fuel:octane_91'] === 'yes' || tags['fuel:octane_95'] === 'yes';
  }
}

/**
 * One list from both sources, nearest first.
 *
 * A mapped pump within a few metres of a directory pump is the same station:
 * the directory's record is kept for its address and fuels, and the map's
 * phone and hours fill its gaps. With the directory answering, a mapped pump
 * that does not say it sells the vehicle's fuel is dropped — the directory has
 * already listed every pump that does.
 */
export function mergePumps(
  places: NearbyPlaceResult[],
  pumps: NearbyPlaceResult[],
  fuel: PetrolFuelFilter | undefined,
): NearbyPlaceResult[] {
  if (pumps.length === 0) return places;

  const merged = pumps.map((pump) => ({ ...pump }));
  const others: NearbyPlaceResult[] = [];

  for (const place of places) {
    if (place.category !== 'FUEL') {
      others.push(place);
      continue;
    }
    const twin = merged.find((pump) => distanceKm(pump, place) <= SAME_STATION_KM);
    if (twin) {
      twin.phone ??= place.phone;
      twin.openingHours ??= place.openingHours;
      twin.open24Hours ||= place.open24Hours;
      continue;
    }
    if (fuel === undefined || declares(place, fuel)) others.push(place);
  }

  return [...merged, ...others].sort((a, b) => a.distanceKm - b.distanceKm);
}
