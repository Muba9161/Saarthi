import { haversineDistance, type LatLng } from '@saarthi/shared';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import type { PlaceMatch } from '../routing/routing.provider';

/**
 * Place search by name over OpenStreetMap, through Photon.
 *
 * The routing provider's own geocoder knows few of India's named places — it
 * found neither "Babu Banarasi Das University" nor several hospitals and malls
 * a driver types — while Photon indexes every named point in OpenStreetMap and
 * found them. Free and keyless; the public server asks for fair use, and the
 * same software can be run on Saarthi's own server by changing `PHOTON_API_URL`.
 *
 * Never throws: a search that cannot reach Photon answers with nothing, and the
 * routing geocoder's results stand on their own.
 */

/** India, as Photon's bounding box takes it: west, south, east, north. */
const INDIA_BBOX = '68.1,6.5,97.5,35.7';

const MAX_RESULTS = 15;

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    housenumber?: string;
    street?: string;
    locality?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    countrycode?: string;
  };
}

export async function searchPhoton(query: string, near: LatLng, limit: number): Promise<PlaceMatch[]> {
  const base = config.placeSearch.photonUrl;
  const trimmed = query.trim();
  if (!base || trimmed.length < 2) return [];

  const params = new URLSearchParams({
    q: trimmed,
    lat: near.latitude.toFixed(6),
    lon: near.longitude.toFixed(6),
    limit: String(Math.min(Math.max(limit, 1), MAX_RESULTS)),
    bbox: INDIA_BBOX,
  });

  try {
    const response = await fetch(`${base}/api/?${params.toString()}`, {
      headers: {
        accept: 'application/json',
        // Photon's operators ask clients to identify themselves.
        'user-agent': 'Saarthi/1.0 (fleet operations platform; place search)',
      },
      signal: AbortSignal.timeout(config.placeSearch.timeoutMs),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Photon place search refused');
      return [];
    }
    const body = (await response.json()) as { features?: PhotonFeature[] };
    return photonMatches(body.features ?? [], near);
  } catch (error) {
    logger.warn({ err: (error as Error).name }, 'Photon place search did not answer');
    return [];
  }
}

/** Photon's features as place matches: named places in India only, with a readable address. */
export function photonMatches(features: readonly PhotonFeature[], near: LatLng): PlaceMatch[] {
  return features.flatMap((feature) => {
    const [longitude, latitude] = feature.geometry?.coordinates ?? [];
    const properties = feature.properties ?? {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return [];
    if (properties.countrycode && properties.countrycode.toUpperCase() !== 'IN') return [];

    const street = [properties.housenumber, properties.street].filter(Boolean).join(' ');
    const name = properties.name ?? street;
    if (!name) return [];

    const parts = [street, properties.locality ?? properties.district, properties.city ?? properties.county, properties.state];
    const address = [...new Set(parts.filter((part): part is string => Boolean(part) && part !== name))].join(', ');

    return [
      {
        name,
        address: address || null,
        latitude,
        longitude,
        distanceMeters: Math.round(haversineDistance(near, { latitude, longitude })),
      },
    ];
  });
}
