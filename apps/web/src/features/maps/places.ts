import type { LatLng } from '@saarthi/shared';
import { geocodeForward } from './directions';
import { isRoutingConfigured } from './map-config';

/**
 * Finding a place by name.
 *
 * The routing provider's own geocoder (Pelias, through OpenRouteService) is
 * fine for a city or a highway, and useless for the address people actually
 * give: a named colony. "Alaknanda Enclave, Lucknow" is in OpenStreetMap as a
 * `landuse=residential` polygon, and Pelias simply does not return it — which
 * is how a dispatcher ends up typing a landmark two kilometres away and
 * pretending it is the gate.
 *
 * So the search goes to two OSM services that do find it, neither of which
 * needs a key:
 *
 *   Photon      — built for type-ahead, and forgiving. It resolves
 *                 "Alanadna Enclave Lukcnow" to Alaknanda Enclave, which
 *                 matters more than any ranking subtlety when somebody is
 *                 typing a colony name they have only ever heard spoken.
 *   Nominatim   — stricter, but the one that knows full postal addresses and
 *                 house numbers.
 *
 * Both are queried at once and merged, because they disagree usefully: Photon
 * is the better guesser, Nominatim the better address book. Pelias stays as
 * the last resort so a network that blocks the two public services still gets
 * the coverage it had before.
 *
 * Nominatim asks callers not to hammer it. The field that uses this debounces
 * and requires three characters, which is what keeps that promise.
 */

export interface PlaceResult {
  id: string;
  /** Short name — the colony, the landmark, the building. */
  name: string;
  /** Everything, for telling two "MG Road"s apart. */
  address: string;
  position: LatLng;
  city: string | null;
  state: string | null;
  source: 'photon' | 'nominatim' | 'ors';
}

const PHOTON_URL = 'https://photon.komoot.io/api/';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/** India, so a colony name does not match a town in another hemisphere. */
const COUNTRY_CODE = 'in';

interface CacheEntry {
  at: number;
  results: PlaceResult[];
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60_000;

/** Joins the parts of a label, dropping blanks and consecutive repeats. */
function joinParts(parts: (string | null | undefined)[]): string {
  const out: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;
    if (out[out.length - 1]?.toLowerCase() === value.toLowerCase()) continue;
    out.push(value);
  }
  return out.join(', ');
}

interface PhotonProperties {
  osm_id?: number;
  osm_type?: string;
  name?: string;
  housenumber?: string;
  street?: string;
  district?: string;
  city?: string;
  county?: string;
  state?: string;
  postcode?: string;
  countrycode?: string;
  osm_key?: string;
  osm_value?: string;
}

async function searchPhoton(
  query: string,
  limit: number,
  near: LatLng | undefined,
  signal: AbortSignal | undefined,
): Promise<PlaceResult[]> {
  const parameters = new URLSearchParams({ q: query, limit: String(limit), lang: 'en' });
  if (near) {
    // Bias, not a filter: a dispatcher in Lucknow means the Lucknow one, but
    // must still be able to find a yard in Kanpur.
    parameters.set('lat', near.latitude.toFixed(3));
    parameters.set('lon', near.longitude.toFixed(3));
  }

  const response = await fetch(`${PHOTON_URL}?${parameters.toString()}`, { signal });
  if (!response.ok) throw new Error(`Photon ${response.status}`);

  const body = (await response.json()) as {
    features?: { properties?: PhotonProperties; geometry?: { coordinates?: number[] } }[];
  };

  return (body.features ?? []).flatMap((feature) => {
    const coordinates = feature.geometry?.coordinates;
    const properties = feature.properties ?? {};
    if (!coordinates || coordinates.length < 2) return [];
    if (properties.countrycode && properties.countrycode.toLowerCase() !== COUNTRY_CODE) return [];

    const name = properties.name?.trim() || properties.street?.trim() || '';
    if (!name) return [];

    return [
      {
        id: `photon:${properties.osm_type ?? 'x'}${properties.osm_id ?? name}`,
        name,
        address: joinParts([
          name,
          joinParts([properties.housenumber, properties.street]) || null,
          properties.district,
          properties.city,
          properties.county,
          properties.state,
          properties.postcode,
        ]),
        position: { latitude: coordinates[1]!, longitude: coordinates[0]! },
        city: properties.city?.trim() || properties.county?.trim() || null,
        state: properties.state?.trim() || null,
        source: 'photon' as const,
      },
    ];
  });
}

interface NominatimAddress {
  suburb?: string;
  neighbourhood?: string;
  village?: string;
  town?: string;
  city?: string;
  county?: string;
  state_district?: string;
  state?: string;
}

async function searchNominatim(
  query: string,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<PlaceResult[]> {
  const parameters = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(limit),
    addressdetails: '1',
    countrycodes: COUNTRY_CODE,
  });

  const response = await fetch(`${NOMINATIM_URL}?${parameters.toString()}`, { signal });
  if (!response.ok) throw new Error(`Nominatim ${response.status}`);

  const body = (await response.json()) as {
    place_id?: number;
    name?: string;
    display_name?: string;
    lat?: string;
    lon?: string;
    address?: NominatimAddress;
  }[];

  return (body ?? []).flatMap((entry) => {
    const latitude = Number(entry.lat);
    const longitude = Number(entry.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    const address = entry.address ?? {};
    const label = entry.display_name?.trim() ?? '';
    return [
      {
        id: `nominatim:${entry.place_id ?? label}`,
        name: entry.name?.trim() || label.split(',')[0]?.trim() || label,
        address: label,
        position: { latitude, longitude },
        city: address.city ?? address.town ?? address.village ?? address.county ?? null,
        state: address.state ?? null,
        source: 'nominatim' as const,
      },
    ];
  });
}

/** The routing provider's geocoder, kept as the offline-ish last resort. */
async function searchPelias(
  query: string,
  limit: number,
  near: LatLng | undefined,
  signal: AbortSignal | undefined,
): Promise<PlaceResult[]> {
  const features = await geocodeForward(query, {
    limit,
    ...(near ? { proximity: near } : {}),
    ...(signal ? { signal } : {}),
  });

  return features.map((feature) => ({
    id: `ors:${feature.id}`,
    name: feature.name,
    address: feature.address,
    position: feature.position,
    city: null,
    state: null,
    source: 'ors' as const,
  }));
}

/**
 * Search every source that can answer, and merge what comes back.
 *
 * One provider failing is not a failed search — the whole reason there are
 * three is that each one covers what the others miss, so a rejected promise
 * from Nominatim must not take Photon's results down with it.
 */
export async function searchPlaces(
  query: string,
  options: { near?: LatLng; limit?: number; signal?: AbortSignal } = {},
): Promise<PlaceResult[]> {
  const text = query.trim();
  if (text.length < 3) return [];

  const limit = Math.min(10, Math.max(1, options.limit ?? 6));
  const key = `${text.toLowerCase()}|${limit}|${options.near ? `${options.near.latitude.toFixed(2)},${options.near.longitude.toFixed(2)}` : ''}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

  const settled = await Promise.allSettled([
    searchPhoton(text, limit, options.near, options.signal),
    searchNominatim(text, limit, options.signal),
  ]);

  const merged: PlaceResult[] = [];
  const seen = new Set<string>();
  const add = (results: PlaceResult[]): void => {
    for (const result of results) {
      // Two services describing the same building is one place. Four decimals
      // is about eleven metres, which is close enough to be the same gate.
      const fingerprint = `${result.position.latitude.toFixed(4)},${result.position.longitude.toFixed(4)}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      merged.push(result);
    }
  };

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') add(outcome.value);
  }

  // Nothing answered — fall back to the routing provider's own geocoder rather
  // than telling somebody their colony does not exist.
  if (merged.length === 0 && isRoutingConfigured) {
    try {
      add(await searchPelias(text, limit, options.near, options.signal));
    } catch {
      // Then there is genuinely nothing to show.
    }
  }

  const results = merged.slice(0, limit);
  cache.set(key, { at: Date.now(), results });
  return results;
}

/**
 * Which city a point is in.
 *
 * Fuel is priced per city, so a rate lookup needs a name, not coordinates —
 * and the name that matters is where the vehicle actually is, not where the
 * fleet is registered. Photon answers this without a key; Nominatim is asked
 * only if it does not.
 */
export async function reverseCity(
  point: LatLng,
  signal?: AbortSignal,
): Promise<{ city: string; state: string | null } | null> {
  const key = `reverse|${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    const first = hit.results[0];
    return first?.city ? { city: first.city, state: first.state } : null;
  }

  const remember = (result: PlaceResult | null): { city: string; state: string | null } | null => {
    cache.set(key, { at: Date.now(), results: result ? [result] : [] });
    return result?.city ? { city: result.city, state: result.state } : null;
  };

  try {
    const parameters = new URLSearchParams({
      lat: String(point.latitude),
      lon: String(point.longitude),
      lang: 'en',
      limit: '1',
    });
    const response = await fetch(`https://photon.komoot.io/reverse?${parameters.toString()}`, {
      signal,
    });
    if (response.ok) {
      const body = (await response.json()) as {
        features?: { properties?: PhotonProperties }[];
      };
      const properties = body.features?.[0]?.properties;
      const city = properties?.city?.trim() || properties?.county?.trim() || null;
      if (city) {
        return remember({
          id: key,
          name: city,
          address: joinParts([city, properties?.state]),
          position: point,
          city,
          state: properties?.state?.trim() || null,
          source: 'photon',
        });
      }
    }
  } catch {
    // Fall through to Nominatim.
  }

  try {
    const parameters = new URLSearchParams({
      lat: String(point.latitude),
      lon: String(point.longitude),
      format: 'jsonv2',
      zoom: '10',
      addressdetails: '1',
    });
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${parameters.toString()}`,
      { signal },
    );
    if (!response.ok) return remember(null);

    const body = (await response.json()) as { address?: NominatimAddress };
    const address = body.address ?? {};
    const city = address.city ?? address.town ?? address.village ?? address.county ?? null;
    if (!city) return remember(null);

    return remember({
      id: key,
      name: city,
      address: joinParts([city, address.state]),
      position: point,
      city,
      state: address.state ?? null,
      source: 'nominatim',
    });
  } catch {
    return remember(null);
  }
}
