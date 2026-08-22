import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type {
  PetrolStationProvider,
  PetrolStationSearch,
  PetrolStationSearchResponse,
  ProviderPetrolStation,
} from './petrol-station.provider';

/**
 * SSR Innovation Lab petrol pump directory adapter.
 *
 * Behaviour observed against the live service and encoded here:
 *  * `GET /api/petrol-pumps/pumps/nearby/` takes `latitude`, `longitude`,
 *    `radius` (whole km), `limit`, `fuel_type` and `company`.
 *  * The documented `format` parameter makes the endpoint 404 — it is not sent.
 *  * An area with no stations answers `200` with `count: 0`, but some queries
 *    answer `404 {"detail": "Not found."}` for the same condition, so a 404 is
 *    treated as "no stations here", not as an outage.
 *  * Reads are currently unauthenticated. `X-api-key` is sent only when one is
 *    configured — no fake credential is invented for a service that needs none.
 *  * Coordinates and prices arrive as strings; they are coerced here so no
 *    string-typed number ever escapes this file.
 */

const NEARBY_PATH = '/api/petrol-pumps/pumps/nearby/';
const PROVIDER_NAME = 'ssr';

interface SsrStation {
  id?: number | string;
  pump_name?: string | null;
  name?: string | null;
  company?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  petrol_price?: string | number | null;
  diesel_price?: string | number | null;
  cng_price?: string | number | null;
  has_petrol?: boolean | null;
  has_diesel?: boolean | null;
  has_cng?: boolean | null;
  station_timing?: string | null;
  direction_link?: string | null;
}

interface SsrNearbyResponse {
  count?: number;
  total_within_radius?: number;
  limit_applied?: number;
  search_radius_km?: number;
  results?: SsrStation[];
}

/** Trimmed string, or `null` for blanks and the directory's placeholder text. */
function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // The directory writes these literally when it has no value.
  if (/^(address not available|not available|unknown|n\/?a)$/i.test(trimmed)) return null;
  return trimmed;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A price of zero means "not published here", not "free fuel". */
function price(value: unknown): number | null {
  const parsed = numeric(value);
  if (parsed === null || parsed <= 0) return null;
  return parsed;
}

function flag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const raw = text(value);
  if (raw === null) return null;
  if (/^(true|1|yes)$/i.test(raw)) return true;
  if (/^(false|0|no)$/i.test(raw)) return false;
  return null;
}

/**
 * Map one directory record onto Saarthi's provider-level station.
 *
 * Returns `null` for a record we cannot place on a map — no id or no usable
 * coordinate — because a station without a position is not a station as far as
 * this feature is concerned. Exported for unit testing.
 */
export function normalizeSsrStation(station: SsrStation): ProviderPetrolStation | null {
  const externalId = text(station.id);
  const latitude = numeric(station.latitude);
  const longitude = numeric(station.longitude);

  if (!externalId) return null;
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  // The directory occasionally carries 0,0 for an unmapped station.
  if (latitude === 0 && longitude === 0) return null;

  return {
    externalId,
    name: text(station.pump_name) ?? text(station.name),
    company: text(station.company),
    latitude,
    longitude,
    address: text(station.address),
    city: text(station.city),
    district: text(station.district),
    state: text(station.state),
    hasPetrol: flag(station.has_petrol),
    hasDiesel: flag(station.has_diesel),
    hasCng: flag(station.has_cng),
    petrolPrice: price(station.petrol_price),
    dieselPrice: price(station.diesel_price),
    cngPrice: price(station.cng_price),
    timings: text(station.station_timing),
    directionsUrl: text(station.direction_link),
    raw: station as unknown as Record<string, unknown>,
  };
}

export class SsrPetrolStationProvider implements PetrolStationProvider {
  readonly name = PROVIDER_NAME;

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = config.petrolStations.baseUrl;
    this.apiKey = config.petrolStations.apiKey;
    this.timeoutMs = config.petrolStations.timeoutMs;
  }

  async search(input: PetrolStationSearch): Promise<PetrolStationSearchResponse> {
    const query = new URLSearchParams({
      latitude: String(input.latitude),
      longitude: String(input.longitude),
      // The directory expects whole kilometres; round up so the caller's
      // radius is covered rather than clipped.
      radius: String(Math.max(1, Math.ceil(input.radiusKm))),
      limit: String(input.limit),
    });
    if (input.fuelType) query.set('fuel_type', input.fuelType);
    if (input.company) query.set('company', input.company);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${NEARBY_PATH}?${query.toString()}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        logger.warn({ provider: this.name }, 'Petrol station search timed out');
        throw errors.providerTimeout(
          this.name,
          'The petrol station directory took too long to respond.',
        );
      }
      logger.error({ provider: this.name }, 'Petrol station directory could not be reached');
      throw errors.providerUnavailable(
        this.name,
        'Petrol station data is temporarily unavailable. Please try again.',
      );
    } finally {
      clearTimeout(timeout);
    }

    // The directory answers 404 for "nothing here" on some queries.
    if (response.status === 404) {
      logger.debug(
        { provider: this.name },
        'Petrol station directory reported no stations for this area',
      );
      return { stations: [], totalWithinRadius: 0 };
    }

    if (response.status === 401 || response.status === 403) {
      logger.error(
        { provider: this.name, status: response.status },
        'Petrol station directory rejected the Saarthi credentials — check SSR_PETROL_API_KEY',
      );
      throw errors.providerUnavailable(
        this.name,
        'Petrol station data is temporarily unavailable. Please try again.',
      );
    }

    if (response.status === 429) {
      throw errors.providerRateLimited(
        this.name,
        'Too many petrol station searches right now. Please wait a moment.',
      );
    }

    if (!response.ok) {
      logger.warn(
        { provider: this.name, status: response.status },
        'Petrol station directory returned an error status',
      );
      throw errors.providerUnavailable(
        this.name,
        'Petrol station data is temporarily unavailable. Please try again.',
      );
    }

    let body: SsrNearbyResponse;
    try {
      body = (await response.json()) as SsrNearbyResponse;
    } catch {
      logger.error({ provider: this.name }, 'Petrol station directory returned a malformed body');
      throw errors.provider(
        this.name,
        'The petrol station directory returned an unreadable response.',
      );
    }

    if (!Array.isArray(body.results)) {
      logger.error(
        { provider: this.name },
        'Petrol station directory response had no results collection',
      );
      throw errors.provider(
        this.name,
        'The petrol station directory returned an unreadable response.',
      );
    }

    const stations: ProviderPetrolStation[] = [];
    let skipped = 0;
    for (const entry of body.results) {
      const normalized = normalizeSsrStation(entry ?? {});
      if (normalized) stations.push(normalized);
      else skipped += 1;
    }

    if (skipped > 0) {
      logger.debug(
        { provider: this.name, skipped },
        'Skipped petrol station records that could not be placed on a map',
      );
    }

    return {
      stations,
      totalWithinRadius:
        typeof body.total_within_radius === 'number' ? body.total_within_radius : null,
    };
  }
}
