import type { VehicleRcRecord } from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { detectMimeType } from '../storage/storage.provider';
import {
  emptyVehicleRcRecord,
  type VehicleRcLookup,
  type VehicleRcLookupResult,
  type VehicleRcPdfDocument,
  type VehicleRcProvider,
} from './vehicle-rc.provider';

/**
 * Way2API "Vehicle RC Text + PDF" adapter.
 *
 * Contract notes that shape this file:
 *  * Every response is HTTP-shaped *and* body-shaped. A 200 does not mean the
 *    vehicle was found — `success` reports the verification outcome — so the
 *    body is always inspected before the record is trusted.
 *  * `message_code` is a fixed vocabulary; we branch on it rather than parsing
 *    the human message, which is free to change.
 *  * `pdf_url` is temporary. We fetch the bytes immediately and store our own
 *    copy; the provider link is never handed to a browser.
 *  * The API key is read from configuration and never logged, echoed in an
 *    error, or included in anything that reaches a client.
 */

const RC_PATH = '/api/v1/rc/text-pdf';
const PROVIDER_NAME = 'way2api';

/** Provider status vocabulary, from the published integration rules. */
type MessageCode =
  | 'OK'
  | 'ACCEPTED'
  | 'PROVIDER_NO_RESPONSE'
  | 'VERIFICATION_FAILED'
  | 'NO_RECORD_FOUND'
  | 'INVALID_INPUT'
  | 'REQUEST_FAILED'
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'INSUFFICIENT_BALANCE'
  | 'NO_API_ACCESS'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'PROVIDER_UNAVAILABLE';

interface Way2ApiEnvelope {
  status?: string;
  status_code?: number;
  charged?: boolean;
  success?: boolean;
  message?: string;
  message_code?: MessageCode | string;
  order_id?: string;
  data?: {
    order_id?: string;
    error_code?: string;
    result?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Field coercion
// ---------------------------------------------------------------------------

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

/** Finite number, or `null`. The provider sends numerics as strings ("149.00"). */
function numeric(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Number(raw.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** ISO `YYYY-MM-DD`, or `null`. Anything unparseable is dropped, never guessed. */
function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function boolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const raw = text(value);
  if (raw === null) return null;
  if (/^(true|yes|y|1)$/i.test(raw)) return true;
  if (/^(false|no|n|0)$/i.test(raw)) return false;
  return null;
}

/** Structured provider extras (challan, NOC) flattened to text for display. */
function textOrJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return text(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized === '{}' || serialized === '[]' ? null : serialized;
  } catch {
    return null;
  }
}

/**
 * Map a Way2API `data.result` payload onto Saarthi's RC record.
 *
 * Exported so the mapping can be unit-tested against a captured payload with
 * no network involved. Unknown provider fields are ignored rather than passed
 * through — the normalised model is the contract, not the provider's shape.
 */
export function normalizeWay2ApiRecord(result: Record<string, unknown>): VehicleRcRecord {
  const record = emptyVehicleRcRecord();
  const metadata = (result.response_metadata ?? {}) as Record<string, unknown>;

  record.registrationNumber = text(result.rc_number);
  record.registrationDate = isoDate(result.registration_date);
  record.registrationStatus = text(result.rc_status);

  record.owner = {
    name: text(result.owner_name),
    fatherName: text(result.father_name),
    serialNumber: text(result.owner_number),
    mobileNumber: text(result.mobile_number),
    presentAddress: text(result.present_address),
    permanentAddress: text(result.permanent_address),
  };

  record.vehicleCategory = text(result.vehicle_category);
  record.vehicleClass = text(result.vehicle_category_description);
  record.bodyType = text(result.body_type);

  record.maker = text(result.maker_description);
  record.model = text(result.maker_model);
  record.variant = text(result.variant);
  record.fuelType = text(result.fuel_type);
  record.color = text(result.color);
  record.emissionNorms = text(result.norms_type);
  record.manufacturedOn =
    text(result.manufacturing_date_formatted) ?? text(result.manufacturing_date);

  record.engineNumber = text(result.vehicle_engine_number);
  record.chassisNumber = text(result.vehicle_chasi_number);

  record.cubicCapacity = numeric(result.cubic_capacity);
  record.cylinders = numeric(result.no_cylinders);
  record.seatingCapacity = numeric(result.seat_capacity);
  record.sleeperCapacity = numeric(result.sleeper_capacity);
  record.standingCapacity = numeric(result.standing_capacity);
  record.wheelbaseMm = numeric(result.wheelbase);

  record.grossVehicleWeight = numeric(result.vehicle_gross_weight);
  record.unladenWeight = numeric(result.unladen_weight);

  record.rto = text(result.registered_at);
  record.rtoCode = text(result.rto_code);

  record.insurer = text(result.insurance_company);
  record.insurancePolicyNumber = text(result.insurance_policy_number);
  record.insuranceValidUntil = isoDate(result.insurance_upto);

  record.puccNumber = text(result.pucc_number);
  record.puccValidUntil = isoDate(result.pucc_upto);

  record.fitnessValidUntil = isoDate(result.fit_up_to);

  record.tax = {
    validUntil: isoDate(result.tax_upto),
    paidUntil: isoDate(result.tax_paid_upto),
  };

  record.permit = {
    number: text(result.permit_number),
    type: text(result.permit_type),
    issuedOn: isoDate(result.permit_issue_date),
    validFrom: isoDate(result.permit_valid_from),
    validUntil: isoDate(result.permit_valid_upto),
    national: {
      number: text(result.national_permit_number),
      validUntil: isoDate(result.national_permit_upto),
      issuedBy: text(result.national_permit_issued_by),
    },
  };

  record.financed = boolean(result.financed);
  record.financer = text(result.financer);

  record.blacklistStatus = text(result.blacklist_status);
  record.nocDetails = textOrJson(result.noc_details);
  record.nonUse = {
    status: text(result.non_use_status),
    from: isoDate(result.non_use_from),
    to: isoDate(result.non_use_to),
  };
  record.challanDetails = textOrJson(result.challan_details);

  record.dataAsOf = isoDate(result.latest_by);
  record.partialRecord = boolean(result.less_info);
  record.maskedByProvider = {
    ownerName: boolean(metadata.masked_owner_name) ?? boolean(result.masked_name) ?? false,
    chassisNumber: boolean(metadata.masked_chassis) ?? false,
    engineNumber: boolean(metadata.masked_engine) ?? false,
  };

  return record;
}

/** Registration number reduced for logs — enough to correlate, not to identify. */
export function maskRegistration(value: string): string {
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class Way2ApiRcProvider implements VehicleRcProvider {
  readonly name = PROVIDER_NAME;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    if (!config.vehicleRc.apiKey) {
      throw new Error('Way2API vehicle RC lookup requires WAY2API_API_KEY to be configured.');
    }
    this.apiKey = config.vehicleRc.apiKey;
    this.baseUrl = config.vehicleRc.baseUrl;
    this.timeoutMs = config.vehicleRc.timeoutMs;
  }

  get configured(): boolean {
    return true;
  }

  async lookup(input: VehicleRcLookup): Promise<VehicleRcLookupResult> {
    const plate = maskRegistration(input.registrationNumber);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${RC_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ rc_number: input.registrationNumber }),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        logger.warn({ provider: this.name, plate }, 'Vehicle RC lookup timed out');
        throw errors.providerTimeout(
          this.name,
          'The vehicle records service took too long to respond. Please try again.',
        );
      }
      logger.error(
        { provider: this.name, plate },
        'Vehicle RC lookup could not reach the provider',
      );
      throw errors.providerUnavailable(
        this.name,
        'Vehicle data is temporarily unavailable. Please try again.',
      );
    } finally {
      clearTimeout(timeout);
    }

    const body = await this.readBody(response, plate);
    this.assertTransportOk(response, body, plate);
    return this.toResult(body, plate);
  }

  /** Parse the envelope. A non-JSON body is a provider fault, not a crash here. */
  private async readBody(response: Response, plate: string): Promise<Way2ApiEnvelope> {
    const raw = await response.text().catch(() => '');
    if (!raw.trim()) {
      logger.error(
        { provider: this.name, plate, status: response.status },
        'Vehicle RC provider returned an empty body',
      );
      throw errors.provider(
        this.name,
        'The vehicle records service returned an unreadable response. Please try again.',
      );
    }
    try {
      return JSON.parse(raw) as Way2ApiEnvelope;
    } catch {
      logger.error(
        { provider: this.name, plate, status: response.status },
        'Vehicle RC provider returned a malformed body',
      );
      throw errors.provider(
        this.name,
        'The vehicle records service returned an unreadable response. Please try again.',
      );
    }
  }

  /**
   * Transport- and account-level failures.
   *
   * Credential, balance and entitlement problems are *our* faults, not the
   * caller's: they are logged loudly for the operator and surfaced to the user
   * as a generic outage, never as "the API key is invalid".
   */
  private assertTransportOk(response: Response, body: Way2ApiEnvelope, plate: string): void {
    const code = String(body.message_code ?? '');

    if (response.status === 429 || code === 'RATE_LIMITED') {
      logger.warn({ provider: this.name, plate }, 'Vehicle RC provider rate limit reached');
      throw errors.providerRateLimited(
        this.name,
        'Too many vehicle lookups right now. Please wait a moment and try again.',
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
        'Vehicle RC provider rejected the Saarthi account — check the API key, balance and entitlements',
      );
      throw errors.providerUnavailable(
        this.name,
        'Vehicle lookups are temporarily unavailable. Our team has been notified.',
      );
    }

    if (
      response.status === 503 ||
      code === 'PROVIDER_UNAVAILABLE' ||
      code === 'INTERNAL_ERROR' ||
      code === 'REQUEST_FAILED'
    ) {
      logger.warn(
        { provider: this.name, plate, status: response.status, messageCode: code },
        'Vehicle RC provider is unavailable',
      );
      throw errors.providerUnavailable(
        this.name,
        'Vehicle data is temporarily unavailable. Please try again.',
      );
    }

    // 202 / pending: the order was accepted (and billed) but no record came back.
    if (response.status === 202 || code === 'ACCEPTED' || code === 'PROVIDER_NO_RESPONSE') {
      logger.warn(
        { provider: this.name, plate, orderId: body.order_id, messageCode: code },
        'Vehicle RC lookup is still pending at the provider',
      );
      throw errors.providerUnavailable(
        this.name,
        'The vehicle records service is still processing this request. Please try again shortly.',
      );
    }
  }

  /** Verification outcome and payload extraction. */
  private toResult(body: Way2ApiEnvelope, plate: string): VehicleRcLookupResult {
    const code = String(body.message_code ?? '');
    const reference = body.data?.order_id ?? body.order_id ?? null;

    if (code === 'INVALID_INPUT') {
      throw errors.validation('That registration number was not accepted by the records service.');
    }

    if (
      body.success === false ||
      code === 'NO_RECORD_FOUND' ||
      code === 'VERIFICATION_FAILED' ||
      code === 'NOT_FOUND'
    ) {
      logger.info(
        { provider: this.name, plate, messageCode: code, charged: body.charged ?? null },
        'Vehicle RC lookup returned no record',
      );
      throw errors.vehicleNotFound();
    }

    const result = body.data?.result;
    if (!result || typeof result !== 'object') {
      logger.error(
        { provider: this.name, plate, messageCode: code },
        'Vehicle RC provider returned a success envelope with no result payload',
      );
      throw errors.provider(
        this.name,
        'The vehicle records service returned an incomplete response. Please try again.',
      );
    }

    const record = normalizeWay2ApiRecord(result);
    const pdfUrl = text(result.pdf_url);

    return {
      record,
      pdfUrl: pdfUrl && /^https?:\/\//i.test(pdfUrl) ? pdfUrl : null,
      providerReference: reference,
    };
  }

  /**
   * Pull the temporary document down.
   *
   * The response is size-capped and the type is decided by magic bytes, so a
   * hijacked or mis-served link cannot put anything but a real PDF into
   * Saarthi's storage.
   */
  async downloadPdf(url: string): Promise<VehicleRcPdfDocument> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/pdf' },
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.warn(
          { provider: this.name, status: response.status },
          'RC document could not be downloaded from the provider',
        );
        throw errors.pdfUnavailable('The RC document could not be retrieved. Please try again.');
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      if (buffer.byteLength === 0) {
        throw errors.pdfUnavailable('The RC document could not be retrieved. Please try again.');
      }
      if (buffer.byteLength > config.vehicleRc.pdfMaxBytes) {
        logger.warn(
          { provider: this.name, size: buffer.byteLength },
          'RC document exceeded the configured size limit and was discarded',
        );
        throw errors.pdfUnavailable('The RC document is larger than Saarthi accepts.');
      }

      const mimeType = detectMimeType(buffer);
      if (mimeType !== 'application/pdf') {
        logger.warn(
          { provider: this.name, detected: mimeType },
          'RC document link did not return a PDF',
        );
        throw errors.pdfUnavailable('The RC document could not be retrieved. Please try again.');
      }

      return { content: buffer, mimeType };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw errors.providerTimeout(
          this.name,
          'The RC document took too long to download. Please try again.',
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
