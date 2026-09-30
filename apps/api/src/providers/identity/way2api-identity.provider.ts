import {
  gstStateFromGstin,
  maskIdentityNumber,
  panFromGstin,
  panHolderType,
  IdentityDocumentKind,
  type GstRecord,
  type PanRecord,
  type VoterIdRecord,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  emptyGstRecord,
  emptyPanRecord,
  emptyVoterIdRecord,
  type AadhaarPanLinkInput,
  type AadhaarPanLinkOutcome,
  type GstLookupInput,
  type IdentityLookupOutcome,
  type IdentityVerificationProvider,
  type PanLookupInput,
  type VoterIdLookupInput,
} from './identity.provider';

/**
 * Way2API identity verification adapter — PAN, Voter ID, GSTIN and the
 * Aadhaar–PAN link check.
 *
 * Same envelope contract as the RC and licence endpoints, and the same two
 * traps handled once here rather than at every call site:
 *
 *  * A `200` does not mean the number was found. `message_code` is the fixed
 *    vocabulary to branch on, and a failed verification still ships a `result`
 *    object full of nulls — so the outcome flags decide, never the presence of
 *    a payload.
 *  * Account-level failures (bad key, spent balance, no entitlement) come back
 *    looking like ordinary responses. They are operator faults: logged loudly
 *    for us, reported to the caller as a generic outage.
 *
 * What is *not* here is any Aadhaar KYC endpoint, because the provider does not
 * resell one — see `AADHAAR_ONLINE_LIMITATION` in @saarthi/shared.
 */

const PROVIDER_NAME = 'way2api';

const PAN_PATH = '/api/v1/pan/verify';
const VOTER_PATH = '/api/v1/voter-id/verify';
const GST_PATH = '/api/v1/gst/verify';
const AADHAAR_PAN_LINK_PATH = '/api/v1/aadhaar/aadhaar_pan_link_check';

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

// ---------------------------------------------------------------------------
// Field coercion
// ---------------------------------------------------------------------------

/** Trimmed string, or `null` for absent, blank or placeholder values. */
function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const upper = trimmed.toUpperCase();
  if (upper === 'NA' || upper === 'N/A' || upper === 'NULL' || upper === '-') return null;
  return trimmed;
}

function boolish(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const raw = text(value);
  if (raw === null) return null;
  if (/^(true|yes|y|1|linked|active)$/i.test(raw)) return true;
  if (/^(false|no|n|0|not linked|inactive)$/i.test(raw)) return false;
  return null;
}

function integer(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** ISO `YYYY-MM-DD`, or `null`. Accepts the `dd/mm/yyyy` the provider also uses. */
function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const dmy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(raw);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => text(entry))
      .filter((entry): entry is string => entry !== null);
  }
  if (!Array.isArray(value)) return [];
  return value.map((entry) => text(entry)).filter((entry): entry is string => entry !== null);
}

/**
 * Read the first key the provider actually populated.
 *
 * The identity endpoints are not consistent with one another about field names
 * — `name` / `full_name` / `holder_name` all appear across them — so each
 * mapping lists the aliases it accepts rather than betting on one.
 */
function pick(result: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (result[key] !== undefined && result[key] !== null) return result[key];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Normalisers — exported so they can be unit-tested against captured payloads
// with no network involved.
// ---------------------------------------------------------------------------

export function normalizeWay2ApiPan(
  result: Record<string, unknown>,
  submitted: PanLookupInput,
): PanRecord {
  const record = emptyPanRecord();

  record.panNumber = text(pick(result, 'pan', 'pan_number', 'panNumber')) ?? submitted.panNumber;
  record.holderName = text(pick(result, 'name', 'full_name', 'holder_name', 'registered_name'));
  record.holderType =
    text(pick(result, 'category', 'pan_type', 'holder_type')) ?? panHolderType(record.panNumber);
  // The department's words ("EXISTING AND VALID") over its one-letter code
  // ("E"); read separately so an empty description still falls back to the code.
  record.panStatus =
    text(pick(result, 'pan_status_desc')) ?? text(pick(result, 'status', 'pan_status'));
  record.aadhaarLinked = boolish(
    pick(result, 'aadhaar_linked', 'aadhaar_seeding_status', 'is_aadhaar_linked'),
  );
  record.lastUpdatedOn = isoDate(
    pick(result, 'pan_modified_date', 'last_updated', 'last_updated_on', 'updated_at'),
  );

  // Name matching is Saarthi's own comparison unless the provider did it: the
  // question a fleet has is whether the card belongs to the person in front of
  // them, and a provider that only echoes the name has not answered it.
  const providerMatch = boolish(pick(result, 'name_match', 'is_name_match', 'name_matched'));
  if (providerMatch !== null) {
    record.nameMatch = providerMatch;
  } else if (submitted.holderName && record.holderName) {
    record.nameMatch = looseNameMatch(submitted.holderName, record.holderName);
  }

  return record;
}

export function normalizeWay2ApiVoterId(
  result: Record<string, unknown>,
  submitted: VoterIdLookupInput,
): VoterIdRecord {
  const record = emptyVoterIdRecord();

  record.epicNumber =
    text(pick(result, 'epic_number', 'epic_no', 'voter_id', 'epicNumber')) ?? submitted.epicNumber;
  record.holderName = text(pick(result, 'name', 'full_name', 'voter_name'));
  record.relativeName = text(
    pick(result, 'relation_name', 'relative_name', 'rln_name', 'father_name'),
  );
  record.relationType = text(pick(result, 'relation_type', 'rln_type'));
  record.gender = text(pick(result, 'gender', 'sex'));
  record.age = integer(pick(result, 'age'));
  record.state = text(pick(result, 'state', 'state_name'));
  record.district = text(pick(result, 'district', 'district_name'));
  record.assemblyConstituency = text(
    pick(result, 'assembly_constituency', 'ac_name', 'ac_no'),
  );
  record.parliamentaryConstituency = text(
    pick(result, 'parliamentary_constituency', 'pc_name', 'pc_no'),
  );
  record.pollingStation = text(pick(result, 'polling_station', 'ps_name'));
  record.partNumber = text(pick(result, 'part_number', 'part_no'));

  return record;
}

/** The GST portal's address parts, in the order an address is written. */
const GST_ADDRESS_PARTS = ['bno', 'flno', 'bnm', 'st', 'loc', 'city', 'dst', 'stcd', 'pncd'] as const;

/** The portal's principal address object (`pradr.addr`), or null. */
function gstAddressBlock(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const block = value as Record<string, unknown>;
  return block.addr && typeof block.addr === 'object' ? (block.addr as Record<string, unknown>) : block;
}

function formatGstAddress(address: Record<string, unknown> | null): string | null {
  if (!address) return null;
  const parts = GST_ADDRESS_PARTS.map((key) => text(address[key])).filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(', ') : null;
}

export function normalizeWay2ApiGst(
  result: Record<string, unknown>,
  submitted: GstLookupInput,
): GstRecord {
  const record = emptyGstRecord();

  record.gstin = text(pick(result, 'gstin', 'gst_number', 'gstNumber')) ?? submitted.gstin;
  record.legalName = text(pick(result, 'legal_name', 'lgnm', 'legal_name_of_business'));
  record.tradeName = text(pick(result, 'trade_name', 'tradeNam', 'trade_name_of_business'));
  record.status = text(pick(result, 'status', 'gst_status', 'sts', 'registration_status'));
  record.taxpayerType = text(pick(result, 'taxpayer_type', 'dty', 'dealer_type'));
  record.constitutionOfBusiness = text(pick(result, 'constitution_of_business', 'ctb'));
  record.registrationDate = isoDate(pick(result, 'registration_date', 'rgdt', 'date_of_registration'));
  record.cancellationDate = isoDate(pick(result, 'cancellation_date', 'cxdt'));
  const address = gstAddressBlock(pick(result, 'pradr'));
  record.state =
    text(pick(result, 'state', 'state_jurisdiction')) ??
    text(address?.stcd) ??
    gstStateFromGstin(record.gstin);
  record.principalAddress =
    text(pick(result, 'principal_address', 'address', 'pradr')) ?? formatGstAddress(address);
  record.natureOfBusiness = stringList(pick(result, 'nature_of_business', 'nba'));
  // Derived locally from the GSTIN's own characters, not from the response —
  // which is what makes it a cross-check rather than an echo.
  record.embeddedPan = panFromGstin(record.gstin);

  return record;
}

/**
 * Name comparison for the PAN check.
 *
 * Deliberately loose. The department's record is an uppercase legal name with
 * initials in places a person would spell out, and half of India's names have
 * two defensible transliterations. An exact-match rule would reject the correct
 * card far more often than it would catch the wrong one, so this compares the
 * *set* of significant name parts and tolerates initials and ordering.
 */
export function looseNameMatch(submitted: string, official: string): boolean {
  const parts = (value: string): string[] =>
    value
      .toUpperCase()
      .replace(/[^A-Z\s]/g, ' ')
      .split(/\s+/)
      .filter((part) => part.length > 1);

  const submittedParts = parts(submitted);
  const officialParts = parts(official);
  if (submittedParts.length === 0 || officialParts.length === 0) return false;

  // Every significant part of the shorter name must appear in the longer one.
  const [shorter, longer] =
    submittedParts.length <= officialParts.length
      ? [submittedParts, officialParts]
      : [officialParts, submittedParts];

  return shorter.every((part) => longer.includes(part));
}

/**
 * Does the provider's masked PAN agree with the PAN the caller supplied?
 *
 * The link endpoint takes the Aadhaar alone and answers with the PAN it is
 * linked to, masked (`EKXXXXXX6F`). Saarthi is asked whether it is linked to
 * *this* PAN, so every character the mask leaves visible must match. `null`
 * when there is no usable mask to compare against.
 */
export function maskedPanMatches(maskedPan: string | null, panNumber: string): boolean | null {
  if (!maskedPan) return null;
  const masked = maskedPan.toUpperCase().replace(/\s/g, '');
  if (masked.length !== panNumber.length) return null;

  let compared = 0;
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === 'X' || char === '*') continue;
    if (char !== panNumber[index]) return false;
    compared += 1;
  }
  return compared > 0 ? true : null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class Way2ApiIdentityProvider implements IdentityVerificationProvider {
  readonly name = PROVIDER_NAME;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    if (!config.identity.apiKey) {
      throw new Error('Identity verification requires WAY2API_API_KEY to be configured.');
    }
    this.apiKey = config.identity.apiKey;
    this.baseUrl = config.identity.baseUrl;
    this.timeoutMs = config.identity.timeoutMs;
  }

  get configured(): boolean {
    return true;
  }

  async verifyPan(input: PanLookupInput): Promise<IdentityLookupOutcome<PanRecord>> {
    const masked = maskIdentityNumber(IdentityDocumentKind.PAN, input.panNumber);
    // The endpoint takes the number alone; the holder's name is compared by
    // Saarthi against the name it returns (see `normalizeWay2ApiPan`).
    const envelope = await this.call(PAN_PATH, { pan_number: input.panNumber }, 'PAN', masked);
    return this.toOutcome(envelope, 'PAN', masked, (result) =>
      normalizeWay2ApiPan(result, input),
    );
  }

  async verifyVoterId(input: VoterIdLookupInput): Promise<IdentityLookupOutcome<VoterIdRecord>> {
    const masked = maskIdentityNumber(IdentityDocumentKind.VOTER_ID, input.epicNumber);
    const envelope = await this.call(VOTER_PATH, { voter_id: input.epicNumber }, 'Voter ID', masked);
    return this.toOutcome(envelope, 'Voter ID', masked, (result) =>
      normalizeWay2ApiVoterId(result, input),
    );
  }

  async verifyGstin(input: GstLookupInput): Promise<IdentityLookupOutcome<GstRecord>> {
    const masked = maskIdentityNumber(IdentityDocumentKind.GST, input.gstin);
    const envelope = await this.call(GST_PATH, { gst_number: input.gstin }, 'GST', masked);
    return this.toOutcome(envelope, 'GST', masked, (result) => normalizeWay2ApiGst(result, input));
  }

  async checkAadhaarPanLink(input: AadhaarPanLinkInput): Promise<AadhaarPanLinkOutcome> {
    const masked = maskIdentityNumber(IdentityDocumentKind.AADHAAR, input.aadhaarNumber);
    // The endpoint takes the Aadhaar alone and names the PAN it is linked to;
    // the comparison with the PAN supplied is made here, below.
    const envelope = await this.call(
      AADHAAR_PAN_LINK_PATH,
      { aadhaar_number: input.aadhaarNumber },
      'Aadhaar–PAN link',
      masked,
    );

    const reference = envelope.data?.order_id ?? envelope.order_id ?? null;
    const code = String(envelope.message_code ?? '');

    if (code === 'INVALID_INPUT') {
      throw errors.validation(
        'The Aadhaar number was not accepted by the records service. Check it and try again.',
      );
    }

    const rawResult = envelope.data?.result;
    const result =
      rawResult && typeof rawResult === 'object' ? (rawResult as Record<string, unknown>) : {};
    const message = text(envelope.message) ?? text(pick(result, 'detailed_reason'));

    // `linking_status` is the documented flag; the others are tolerated aliases.
    const linked =
      boolish(
        pick(
          result,
          'linking_status',
          'is_linked',
          'linked',
          'aadhaar_linked',
          'aadhaar_seeding_status',
          'status',
        ),
      ) ?? (envelope.success === true ? null : false);

    if (linked === true) {
      const panMatch = maskedPanMatches(
        text(pick(result, 'masked_pan', 'pan', 'pan_number')),
        input.panNumber,
      );
      if (panMatch === false) {
        return {
          linked: false,
          providerReference: reference,
          message:
            'This Aadhaar is linked to a different PAN. Enter the PAN it is linked to and try again.',
        };
      }
      if (panMatch === null) {
        logger.warn(
          { provider: this.name, label: 'Aadhaar–PAN link', masked, orderId: reference },
          'Aadhaar–PAN link answer carried no masked PAN to compare; trusting the link flag',
        );
      }
    }

    return { linked, providerReference: reference, message };
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private async call(
    path: string,
    body: Record<string, unknown>,
    label: string,
    masked: string,
  ): Promise<Way2ApiEnvelope> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        logger.warn({ provider: this.name, label, masked }, `${label} verification timed out`);
        throw errors.providerTimeout(
          this.name,
          'The verification service took too long to respond. Please try again.',
        );
      }
      logger.error(
        { provider: this.name, label, masked },
        `${label} verification could not reach the provider`,
      );
      throw errors.providerUnavailable(
        this.name,
        'Verification is temporarily unavailable. Please try again.',
      );
    } finally {
      clearTimeout(timeout);
    }

    const envelope = await this.readBody(response, label, masked);
    this.assertTransportOk(response, envelope, label, masked);
    return envelope;
  }

  private async readBody(
    response: Response,
    label: string,
    masked: string,
  ): Promise<Way2ApiEnvelope> {
    const raw = await response.text().catch(() => '');
    if (!raw.trim()) {
      logger.error(
        { provider: this.name, label, masked, status: response.status },
        `${label} provider returned an empty body`,
      );
      throw errors.provider(
        this.name,
        'The verification service returned an unreadable response. Please try again.',
      );
    }
    try {
      return JSON.parse(raw) as Way2ApiEnvelope;
    } catch {
      logger.error(
        { provider: this.name, label, masked, status: response.status },
        `${label} provider returned a malformed body`,
      );
      throw errors.provider(
        this.name,
        'The verification service returned an unreadable response. Please try again.',
      );
    }
  }

  /**
   * Transport- and account-level failures.
   *
   * Identical branching to the licence provider, and intentionally duplicated
   * rather than extracted: these are two independently billed services whose
   * error vocabularies happen to agree today. A shared helper would make a
   * divergence upstream silently change the behaviour of both.
   */
  private assertTransportOk(
    response: Response,
    body: Way2ApiEnvelope,
    label: string,
    masked: string,
  ): void {
    const code = String(body.message_code ?? '');

    if (response.status === 429 || code === 'RATE_LIMITED') {
      logger.warn({ provider: this.name, label, masked }, `${label} provider rate limit reached`);
      throw errors.providerRateLimited(
        this.name,
        'Too many verifications right now. Please wait a moment and try again.',
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
        { provider: this.name, label, status: response.status, messageCode: code },
        `${label} provider rejected the Saarthi account — check the API key, balance and entitlements`,
      );
      throw errors.providerUnavailable(
        this.name,
        'Verification is temporarily unavailable. Our team has been notified.',
      );
    }

    // SOURCE_UNAVAILABLE arrives as a 422 that looks like a lookup, but the
    // government source behind the provider never answered: an outage, not "no
    // record" and not "not linked".
    if (
      response.status === 503 ||
      code === 'PROVIDER_UNAVAILABLE' ||
      code === 'SOURCE_UNAVAILABLE' ||
      code === 'INTERNAL_ERROR' ||
      code === 'REQUEST_FAILED'
    ) {
      logger.warn(
        { provider: this.name, label, masked, status: response.status, messageCode: code },
        `${label} provider is unavailable`,
      );
      throw errors.providerUnavailable(
        this.name,
        'Verification is temporarily unavailable. Please try again.',
      );
    }

    if (response.status === 202 || code === 'ACCEPTED' || code === 'PROVIDER_NO_RESPONSE') {
      logger.warn(
        { provider: this.name, label, masked, orderId: body.order_id, messageCode: code },
        `${label} verification is still pending at the provider`,
      );
      throw errors.providerUnavailable(
        this.name,
        'The verification service is still processing this request. Please try again shortly.',
      );
    }
  }

  /**
   * Turn an envelope into an outcome.
   *
   * A negative answer about the number is a *result*, not an error — see the
   * provider contract. Only a success envelope with no payload at all is
   * treated as a fault, because that is Saarthi being unable to say anything.
   */
  private toOutcome<TRecord>(
    body: Way2ApiEnvelope,
    label: string,
    masked: string,
    normalize: (result: Record<string, unknown>) => TRecord,
  ): IdentityLookupOutcome<TRecord> {
    const code = String(body.message_code ?? '');
    const reference = body.data?.order_id ?? body.order_id ?? null;
    const message = text(body.message);

    if (code === 'INVALID_INPUT') {
      throw errors.validation(
        `That ${label} number was not accepted by the records service. Check it and try again.`,
      );
    }

    if (
      body.success === false ||
      code === 'NO_RECORD_FOUND' ||
      code === 'VERIFICATION_FAILED' ||
      code === 'NOT_FOUND'
    ) {
      logger.info(
        { provider: this.name, label, masked, messageCode: code, charged: body.charged ?? null },
        `${label} verification returned no record`,
      );
      return { found: false, record: null, providerReference: reference, message };
    }

    const result = body.data?.result;
    if (!result || typeof result !== 'object') {
      logger.error(
        { provider: this.name, label, masked, messageCode: code },
        `${label} provider returned a success envelope with no result payload`,
      );
      throw errors.provider(
        this.name,
        'The verification service returned an incomplete response. Please try again.',
      );
    }

    return {
      found: true,
      record: normalize(result as Record<string, unknown>),
      providerReference: reference,
      message,
    };
  }
}
