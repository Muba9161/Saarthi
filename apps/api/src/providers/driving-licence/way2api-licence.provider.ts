import { LICENCE_NULL_DATE, type DrivingLicenceRecord } from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  emptyDrivingLicenceRecord,
  type DrivingLicenceLookup,
  type DrivingLicenceLookupResult,
  type DrivingLicenceProvider,
} from './driving-licence.provider';

/**
 * Way2API "Driving License Verify" adapter.
 *
 * Same envelope contract as the RC endpoint — `message_code` is the fixed
 * vocabulary to branch on, `success` reports the verification outcome and a
 * `200` does not by itself mean the licence was found.
 *
 * Two provider quirks are handled here and nowhere else:
 *
 *  * `transport_doi` / `transport_doe` come back as `1800-01-01` when the
 *    licence carries no commercial entitlement. Passing that through would tell
 *    a fleet manager their driver's transport licence expired in 1800.
 *  * A failed verification still returns a `result` object full of nulls. That
 *    is a not-found, not a record.
 */

const LICENCE_PATH = '/api/v1/driving-license/verify';
const PROVIDER_NAME = 'way2api';

interface Way2ApiEnvelope {
  status?: string;
  status_code?: number;
  charged?: boolean;
  success?: boolean;
  message?: string;
  message_code?: string;
  order_id?: string;
  data?: {
    order_id?: string;
    error_code?: string;
    result?: Record<string, unknown>;
  };
}

/** Trimmed string, or `null` for absent, blank or placeholder values. */
function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'NA' || trimmed.toUpperCase() === 'N/A') {
    return null;
  }
  return trimmed;
}

/** ISO `YYYY-MM-DD`, or `null`. The provider's 1800 sentinel becomes null. */
function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (raw === null || raw === LICENCE_NULL_DATE) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const iso = parsed.toISOString().slice(0, 10);
  return iso === LICENCE_NULL_DATE ? null : iso;
}

function boolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const raw = text(value);
  if (raw === null) return null;
  if (/^(true|yes|y|1)$/i.test(raw)) return true;
  if (/^(false|no|n|0)$/i.test(raw)) return false;
  return null;
}

function classList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => text(entry)).filter((entry): entry is string => entry !== null);
}

/** Format a date the way the provider expects it: `dd/mm/yyyy`. */
export function toProviderDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

/**
 * Map a Way2API `data.result` payload onto Saarthi's licence record.
 *
 * Exported so the mapping can be unit-tested against a captured payload with no
 * network involved.
 */
export function normalizeWay2ApiLicence(result: Record<string, unknown>): DrivingLicenceRecord {
  const record = emptyDrivingLicenceRecord();

  record.licenceNumber = text(result.license_number);
  record.state = text(result.state);

  record.holder = {
    name: text(result.name),
    fatherOrHusbandName: text(result.father_or_husband_name),
    gender: text(result.gender),
    dateOfBirth: isoDate(result.dob),
    bloodGroup: text(result.blood_group),
    citizenship: text(result.citizenship),
    permanentAddress: text(result.permanent_address),
    permanentZip: text(result.permanent_zip),
    temporaryAddress: text(result.temporary_address),
    temporaryZip: text(result.temporary_zip),
  };

  record.issuingAuthority = text(result.ola_name);
  record.issuingAuthorityCode = text(result.ola_code);

  record.issuedOn = isoDate(result.doi);
  record.validUntil = isoDate(result.doe);
  record.transportIssuedOn = isoDate(result.transport_doi);
  record.transportValidUntil = isoDate(result.transport_doe);

  record.vehicleClasses = classList(result.vehicle_classes);
  record.hasPhotograph = boolean(result.has_image);
  record.partialRecord = boolean(result.less_info);

  return record;
}

/** Licence number reduced for logs — enough to correlate, not to identify. */
export function maskLicence(value: string): string {
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

export class Way2ApiLicenceProvider implements DrivingLicenceProvider {
  readonly name = PROVIDER_NAME;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    if (!config.drivingLicence.apiKey) {
      throw new Error('Driving licence lookup requires WAY2API_API_KEY to be configured.');
    }
    this.apiKey = config.drivingLicence.apiKey;
    this.baseUrl = config.drivingLicence.baseUrl;
    this.timeoutMs = config.drivingLicence.timeoutMs;
  }

  get configured(): boolean {
    return true;
  }

  async lookup(input: DrivingLicenceLookup): Promise<DrivingLicenceLookupResult> {
    const licence = maskLicence(input.licenceNumber);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${LICENCE_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          dl_number: input.licenceNumber,
          dob: toProviderDate(input.dateOfBirth),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        logger.warn({ provider: this.name, licence }, 'Driving licence lookup timed out');
        throw errors.providerTimeout(
          this.name,
          'The licence records service took too long to respond. Please try again.',
        );
      }
      logger.error(
        { provider: this.name, licence },
        'Driving licence lookup could not reach the provider',
      );
      throw errors.providerUnavailable(
        this.name,
        'Licence data is temporarily unavailable. Please try again.',
      );
    } finally {
      clearTimeout(timeout);
    }

    const body = await this.readBody(response, licence);
    this.assertTransportOk(response, body, licence);
    return this.toResult(body, licence);
  }

  private async readBody(response: Response, licence: string): Promise<Way2ApiEnvelope> {
    const raw = await response.text().catch(() => '');
    if (!raw.trim()) {
      logger.error(
        { provider: this.name, licence, status: response.status },
        'Driving licence provider returned an empty body',
      );
      throw errors.provider(
        this.name,
        'The licence records service returned an unreadable response. Please try again.',
      );
    }
    try {
      return JSON.parse(raw) as Way2ApiEnvelope;
    } catch {
      logger.error(
        { provider: this.name, licence, status: response.status },
        'Driving licence provider returned a malformed body',
      );
      throw errors.provider(
        this.name,
        'The licence records service returned an unreadable response. Please try again.',
      );
    }
  }

  /**
   * Transport- and account-level failures.
   *
   * Credential, balance and entitlement problems are operator faults: logged
   * loudly for us, reported to the caller as a generic outage.
   */
  private assertTransportOk(response: Response, body: Way2ApiEnvelope, licence: string): void {
    const code = String(body.message_code ?? '');

    if (response.status === 429 || code === 'RATE_LIMITED') {
      logger.warn({ provider: this.name, licence }, 'Driving licence provider rate limit reached');
      throw errors.providerRateLimited(
        this.name,
        'Too many licence lookups right now. Please wait a moment and try again.',
      );
    }

    if (
      response.status === 401 ||
      response.status === 402 ||
      response.status === 403 ||
      code === 'MISSING_API_KEY' ||
      code === 'INVALID_API_KEY' ||
      code === 'INSUFFICIENT_BALANCE' ||
      code === 'NO_API_ACCESS'
    ) {
      logger.error(
        { provider: this.name, status: response.status, messageCode: code },
        'Driving licence provider rejected the Saarthi account — check the API key, balance and entitlements',
      );
      throw errors.providerUnavailable(
        this.name,
        'Licence lookups are temporarily unavailable. Our team has been notified.',
      );
    }

    if (
      response.status === 503 ||
      code === 'PROVIDER_UNAVAILABLE' ||
      code === 'INTERNAL_ERROR' ||
      code === 'REQUEST_FAILED'
    ) {
      logger.warn(
        { provider: this.name, licence, status: response.status, messageCode: code },
        'Driving licence provider is unavailable',
      );
      throw errors.providerUnavailable(
        this.name,
        'Licence data is temporarily unavailable. Please try again.',
      );
    }

    if (response.status === 202 || code === 'ACCEPTED' || code === 'PROVIDER_NO_RESPONSE') {
      logger.warn(
        { provider: this.name, licence, orderId: body.order_id, messageCode: code },
        'Driving licence lookup is still pending at the provider',
      );
      throw errors.providerUnavailable(
        this.name,
        'The licence records service is still processing this request. Please try again shortly.',
      );
    }
  }

  private toResult(body: Way2ApiEnvelope, licence: string): DrivingLicenceLookupResult {
    const code = String(body.message_code ?? '');
    const reference = body.data?.order_id ?? body.order_id ?? null;

    if (code === 'INVALID_INPUT') {
      throw errors.validation(
        'That licence number and date of birth were not accepted by the records service.',
      );
    }

    // A failed verification still ships a `result` object full of nulls, so the
    // outcome flags decide, not the presence of a payload.
    if (
      body.success === false ||
      code === 'NO_RECORD_FOUND' ||
      code === 'VERIFICATION_FAILED' ||
      code === 'NOT_FOUND'
    ) {
      logger.info(
        { provider: this.name, licence, messageCode: code, charged: body.charged ?? null },
        'Driving licence lookup returned no record',
      );
      throw errors.licenceNotFound();
    }

    const result = body.data?.result;
    if (!result || typeof result !== 'object') {
      logger.error(
        { provider: this.name, licence, messageCode: code },
        'Driving licence provider returned a success envelope with no result payload',
      );
      throw errors.provider(
        this.name,
        'The licence records service returned an incomplete response. Please try again.',
      );
    }

    return { record: normalizeWay2ApiLicence(result), providerReference: reference };
  }
}
