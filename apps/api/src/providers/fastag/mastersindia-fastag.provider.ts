import { FastagStatus, TollDirection, normalizeRegistrationNumber } from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type {
  FastagProvider,
  ProviderTagDetails,
  ProviderTollCrossing,
  ProviderTollHistory,
  TagLookupRequest,
} from './fastag.provider';

/**
 * Masters India NETC adapter.
 *
 * Two documented endpoints, both POST, both keyed on a vehicle number:
 *
 *   `/api/v2/sbt/FASTAG/`    recent toll crossings for a vehicle
 *   `/api/v2/sbt/FASTAG/02`  tag details for a vehicle or a tag id
 *
 * Contract notes that shape this file:
 *
 *  * **A 200 does not mean "found".** The HTTP layer and the NETC layer report
 *    separately: the body carries `result` and a `vehicle.errCode`, and
 *    `errCode: "740"` means the vehicle has no tag on record. That arrives as a
 *    perfectly healthy 200, so the body is always inspected.
 *  * **Tag details come back as name/value pairs**, not as an object — a list of
 *    `{name: "TAGSTATUS", value: "A"}`. They are indexed before use, and an
 *    absent field stays absent rather than becoming an empty string.
 *  * **No balance is served.** Nothing in either response carries one, which is
 *    why `supportsBalance` is false. Saarthi shows what the operator recorded.
 *  * **The crossing feed is short-lived** — the provider states 72 hours — so
 *    the coverage note says so and the sync is designed to run often rather
 *    than to backfill history.
 *  * **Authentication is a short-lived token, not a key.** The platform issues a
 *    JWT from `/api/v2/token-auth/` against a username and password, it expires
 *    after 24 hours, and it must be sent as `Authorization: JWT <token>` — the
 *    bare token is rejected. This adapter mints and re-mints its own token, so
 *    nobody has to paste a fresh one in every morning. A token obtained some
 *    other way can still be supplied through `FASTAG_API_KEY`.
 *  * Credentials are read from configuration and never logged or echoed.
 */

const TAG_DETAILS_PATH = '/api/v2/sbt/FASTAG/02';
const TOLL_HISTORY_PATH = '/api/v2/sbt/FASTAG/';
const TOKEN_PATH = '/api/v2/token-auth/';
const PROVIDER_NAME = 'mastersindia';
const TIMEOUT_MS = 20_000;

/**
 * The token is documented as valid for 24 hours. It is renewed an hour early so
 * a request never sets off with a token that expires mid-flight; a 401 still
 * triggers one forced renewal, because the clock is theirs, not ours.
 */
const TOKEN_TTL_MS = 23 * 3_600_000;

/**
 * "This vehicle has no tag."
 *
 * The two documented endpoints report it with different codes — 740 on the
 * crossings feed, 239 on tag details — so both are treated as the same answer.
 * Reading one of them as a generic failure would turn a plain fact about the
 * vehicle into an error banner.
 */
const NO_TAG_CODES = new Set(['740', '239']);

/** The provider keeps crossings for three days; nothing older is retrievable. */
const HISTORY_WINDOW_HOURS = 72;

interface DetailPair {
  name?: string;
  value?: string;
}

interface VehicleBlock {
  errCode?: string;
  vehicledetails?: { detail?: DetailPair[] }[];
  vehltxnList?: {
    totalTagsInMsg?: string;
    txn?: Record<string, unknown>[];
  };
}

interface InnerResponse {
  result?: string;
  respCode?: string;
  ts?: string;
  vehicle?: VehicleBlock;
}

interface Envelope {
  success?: boolean;
  message?: string;
  code?: string;
  error?: string;
  response?: { response?: InnerResponse; responseStatus?: string }[];
  /** Some responses nest the whole envelope one level deeper under `data`. */
  data?: {
    response?: { response?: InnerResponse; responseStatus?: string }[];
    error?: string;
    code?: string;
    message?: string;
  };
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * NETC tag status letters.
 *
 * Anything outside this set maps to UNKNOWN and the raw letter is preserved.
 * Guessing at an unrecognised status is how a blacklisted tag ends up displayed
 * as healthy.
 */
function mapTagStatus(raw: string | null): FastagStatus {
  switch ((raw ?? '').trim().toUpperCase()) {
    case 'A':
      return FastagStatus.ACTIVE;
    case 'B':
      return FastagStatus.BLACKLISTED;
    case 'H':
      return FastagStatus.HOTLISTED;
    case 'C':
      return FastagStatus.CLOSED;
    case 'L':
      // Lost tags are hotlisted in practice: they will not be accepted.
      return FastagStatus.HOTLISTED;
    case 'E':
      return FastagStatus.EXCEPTION;
    default:
      return FastagStatus.UNKNOWN;
  }
}

/**
 * `EXCCODE` is NETC's exception vocabulary, and NPCI does not publish the full
 * table openly. Only "no exception" is treated as meaningful; anything else
 * downgrades the tag to EXCEPTION and the raw code is carried through for
 * support to interpret, rather than being mapped to a guess.
 */
function hasException(exceptionCode: string | null): boolean {
  const code = (exceptionCode ?? '').trim();
  return code !== '' && code !== '00' && code !== '000';
}

/** NETC lane direction letters. */
function mapDirection(raw: unknown): TollDirection {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  // N/E are treated as one side of a plaza and S/W the other. The feed does not
  // say "inbound"; it says which way the lane faces.
  if (value === 'N' || value === 'E') return TollDirection.INBOUND;
  if (value === 'S' || value === 'W') return TollDirection.OUTBOUND;
  return TollDirection.UNKNOWN;
}

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'NA' || trimmed.toUpperCase() === 'N/A') {
    return null;
  }
  return trimmed;
}

function numeric(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `2023-05-19 16:18:45.0` — the feed's own format, which is not ISO.
 *
 * No timezone is given. NETC operates in IST, so the value is anchored to
 * +05:30 rather than being read as UTC, which would place every crossing five
 * and a half hours early.
 */
function parseReaderTime(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!match) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }

  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** `"32.197881,75.533697"` → a coordinate pair, or nulls. */
function parseGeocode(value: unknown): { latitude: number | null; longitude: number | null } {
  const raw = text(value);
  if (raw === null) return { latitude: null, longitude: null };

  const [latitude, longitude] = raw.split(',').map((part) => Number(part.trim()));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { latitude: null, longitude: null };
  }
  // A plaza at 0,0 is a null island artefact, not a toll booth.
  if (latitude === 0 && longitude === 0) return { latitude: null, longitude: null };
  return { latitude: latitude!, longitude: longitude! };
}

// ---------------------------------------------------------------------------

export class MastersIndiaFastagProvider implements FastagProvider {
  readonly name = PROVIDER_NAME;
  readonly supportsLookup = true;
  /** Neither documented endpoint carries a balance. */
  readonly supportsBalance = false;
  /** A verification API is not a payment rail. */
  readonly supportsRecharge = false;
  readonly supportsTransactions = true;
  readonly unavailableReason = '';

  private readonly log = logger.child({ module: 'fastag', provider: PROVIDER_NAME });

  /** A token this adapter minted, with the moment it stops being usable. */
  private token: { value: string; expiresAt: number } | null = null;
  /** In-flight sign-in, shared so a burst of lookups mints one token, not ten. */
  private pendingToken: Promise<string> | null = null;

  constructor() {
    const { apiKey, username, password, subId } = config.fastag;

    if (!subId) {
      throw new Error('FASTAG_PROVIDER=mastersindia requires FASTAG_SUB_ID.');
    }
    if (!apiKey && !(username && password)) {
      throw new Error(
        'FASTAG_PROVIDER=mastersindia requires FASTAG_API_USERNAME and FASTAG_API_PASSWORD ' +
          '(or a FASTAG_API_KEY holding a token obtained elsewhere).',
      );
    }
  }

  /**
   * The `Authorization` header value, minting a token when there is none.
   *
   * A configured key wins, so an environment that already holds a token keeps
   * working. It is sent with the `JWT ` prefix the platform requires, added
   * only when the configured value does not already carry it — otherwise a key
   * pasted in complete with its prefix would be sent as `JWT JWT …`.
   */
  private async authorization(): Promise<string> {
    const configured = config.fastag.apiKey;
    if (configured) {
      return configured.startsWith('JWT ') ? configured : `JWT ${configured}`;
    }

    if (this.token && this.token.expiresAt > Date.now()) {
      return `JWT ${this.token.value}`;
    }

    this.pendingToken ??= this.signIn().finally(() => {
      this.pendingToken = null;
    });

    return `JWT ${await this.pendingToken}`;
  }

  private async signIn(): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${config.fastag.baseUrl}${TOKEN_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: config.fastag.username,
          password: config.fastag.password,
        }),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        token?: string;
        message?: string;
      };

      if (!response.ok || !payload.token) {
        // The password is in scope here, so nothing but the status is logged.
        this.log.error({ status: response.status }, 'FASTag provider sign-in failed');
        throw errors.providerNotConfigured(
          PROVIDER_NAME,
          'Saarthi could not sign in to the FASTag service. Check the configured credentials.',
        );
      }

      this.token = { value: payload.token, expiresAt: Date.now() + TOKEN_TTL_MS };
      this.log.info('FASTag provider session established');
      return payload.token;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw errors.providerTimeout(PROVIDER_NAME);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchTagDetails(request: TagLookupRequest): Promise<ProviderTagDetails> {
    const registrationNumber = normalizeRegistrationNumber(request.registrationNumber);

    // The endpoint accepts either identifier, and the tag id is the precise
    // one — a registration number can be re-issued, a tag id cannot.
    const body = request.tagId
      ? { tagid: request.tagId }
      : { vehiclenumber: registrationNumber };

    const envelope = await this.post(TAG_DETAILS_PATH, body);
    const inner = this.unwrap(envelope);
    const vehicle = inner?.vehicle;

    if (vehicle?.errCode && NO_TAG_CODES.has(vehicle.errCode)) {
      // A real answer, not a failure: NETC has no tag against this vehicle.
      throw errors.notFound(
        'FASTag',
        'No FASTag is registered against this vehicle in the NETC system.',
      );
    }

    const details = this.indexDetails(vehicle);
    const rawStatus = details.TAGSTATUS ?? null;
    const exceptionCode = details.EXCCODE ?? null;
    const mapped = mapTagStatus(rawStatus);

    return {
      tagId: details.TAGID ?? null,
      registrationNumber: details.REGNUMBER ?? registrationNumber,
      vehicleClass: details.VEHICLECLASS ?? null,
      // An exception downgrades an otherwise-active tag: the letter says the
      // tag exists, the exception code says it will not be honoured today.
      status:
        mapped === FastagStatus.ACTIVE && hasException(exceptionCode)
          ? FastagStatus.EXCEPTION
          : mapped,
      rawStatus,
      exceptionCode,
      issuerBank: null,
      // The feed gives a numeric bank identifier rather than a name; it is
      // passed through untranslated rather than mapped to a guess.
      issuerCode: details.BANKID ?? null,
      issuedAt: details.ISSUEDATE ?? null,
      commercialVehicle:
        details.COMVEHICLE === undefined ? null : details.COMVEHICLE.toUpperCase() === 'T',
      // Not served by this API. Never defaulted to zero.
      balance: null,
      provider: this.name,
      retrievedAt: inner?.ts ? new Date(inner.ts).toISOString() : new Date().toISOString(),
      simulated: false,
    };
  }

  async fetchTollHistory(request: TagLookupRequest): Promise<ProviderTollHistory> {
    const registrationNumber = normalizeRegistrationNumber(request.registrationNumber);

    const envelope = await this.post(TOLL_HISTORY_PATH, {
      vehiclenumber: registrationNumber,
    });
    const inner = this.unwrap(envelope);
    const vehicle = inner?.vehicle;

    if (vehicle?.errCode && NO_TAG_CODES.has(vehicle.errCode)) {
      return {
        registrationNumber,
        crossings: [],
        provider: this.name,
        retrievedAt: new Date().toISOString(),
        coverageNote:
          'NETC has no FASTag registered against this vehicle, so no crossings can be retrieved.',
        simulated: false,
      };
    }

    const rows = vehicle?.vehltxnList?.txn ?? [];

    const crossings: ProviderTollCrossing[] = rows.flatMap((row) => {
      const crossedAt = parseReaderTime(row.readerReadTime);
      const plazaName = text(row.tollPlazaName);
      // A crossing with no time or no plaza cannot be reconciled against
      // anything, so it is dropped rather than stored as a partial row.
      if (crossedAt === null || plazaName === null) return [];

      const geocode = parseGeocode(row.tollPlazaGeocode);

      return [
        {
          externalReference: text(row.seqNo),
          plazaName,
          plazaCode: text(row.tollPlazaCode),
          latitude: geocode.latitude,
          longitude: geocode.longitude,
          direction: mapDirection(row.laneDirection),
          crossedAt,
          // This feed reports the passage, not the fare. The amount is filled
          // in from a statement import or by the operator; leaving it null is
          // what stops a crossing being recorded as a free one.
          amount: numeric(row.txnAmount),
          balanceAfter: numeric(row.balance),
          vehicleClass: text(row.vehicleType),
          registrationNumber: text(row.vehicleRegNo) ?? registrationNumber,
        },
      ];
    });

    return {
      registrationNumber,
      crossings,
      provider: this.name,
      retrievedAt: inner?.ts ? new Date(inner.ts).toISOString() : new Date().toISOString(),
      coverageNote:
        `The NETC feed holds roughly ${HISTORY_WINDOW_HOURS} hours of crossings, and reports the ` +
        'passage rather than the fare. Older crossings and toll amounts come from your bank ' +
        'statement import, not from this lookup.',
      simulated: false,
    };
  }

  // -------------------------------------------------------------------------

  /** Both response shapes seen in the wild: flat, and nested under `data`. */
  private unwrap(envelope: Envelope): InnerResponse | undefined {
    const list = envelope.response ?? envelope.data?.response ?? [];
    return list[0]?.response;
  }

  /** Turn `[{name, value}]` into an object, skipping blanks. */
  private indexDetails(vehicle: VehicleBlock | undefined): Record<string, string> {
    const pairs = vehicle?.vehicledetails?.[0]?.detail ?? [];
    const indexed: Record<string, string> = {};

    for (const pair of pairs) {
      const name = text(pair.name);
      const value = text(pair.value);
      if (name !== null && value !== null) indexed[name.toUpperCase()] = value;
    }
    return indexed;
  }

  /**
   * One call, with a single retry when the token has gone stale.
   *
   * `retryOnExpiry` is what stops that retry becoming a loop: the second
   * attempt passes false, so credentials that are genuinely wrong fail once
   * rather than hammering the provider with sign-ins.
   */
  private async post(
    path: string,
    body: Record<string, unknown>,
    retryOnExpiry = true,
  ): Promise<Envelope> {
    const authorization = await this.authorization();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${config.fastag.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization,
          Subid: config.fastag.subId!,
          Productid: config.fastag.productId,
          Mode: config.fastag.mode,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as Envelope;

      if (!response.ok) {
        // The provider's own message is safe to relay — it names the field at
        // fault — but never the credentials that produced the request.
        const message = text(payload.message) ?? `The FASTag service returned ${response.status}.`;

        if (response.status === 400) throw errors.validation(message);
        if (response.status === 401 || response.status === 403) {
          // A token that expired early, or a clock that disagrees with theirs.
          // Worth exactly one silent renewal before this becomes the operator's
          // problem — and only when the token is ours to renew.
          if (retryOnExpiry && !config.fastag.apiKey) {
            this.log.info('FASTag token rejected — renewing and retrying once');
            this.token = null;
            return this.post(path, body, false);
          }

          this.log.error({ status: response.status }, 'FASTag provider rejected our credentials');
          throw errors.providerNotConfigured(
            PROVIDER_NAME,
            'The FASTag integration is not authorised on this environment.',
          );
        }
        if (response.status === 429) throw errors.providerRateLimited(PROVIDER_NAME);
        if (response.status >= 500) throw errors.providerUnavailable(PROVIDER_NAME);
        throw errors.provider(PROVIDER_NAME, message);
      }

      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw errors.providerTimeout(PROVIDER_NAME);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
