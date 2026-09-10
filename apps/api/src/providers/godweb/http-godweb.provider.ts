import { normalizeGodId } from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type {
  GodWebProvider,
  GodWebSalesperson,
  GodWebValidationOutcome,
} from './godweb.provider';

/**
 * HTTP adapter for the approved read-only GODWeb salesperson endpoint.
 *
 * One `GET`, an API key in a header, and a mapping. That is the whole adapter,
 * and its narrowness is the design: everything GODWeb-shaped is confined here,
 * so the sales module never learns what GODWeb's JSON looks like and GODWeb
 * never learns that Saarthi exists.
 *
 * ## Why the response mapping is forgiving
 *
 * The endpoint's exact payload is not settled — see the note in
 * `godweb.provider.ts`. Rather than guess one spelling and be wrong, the mapper
 * accepts the handful of spellings the same field realistically arrives under
 * (`godId` / `god_id` / `code`, `name` / `full_name`, and so on) and reads
 * through a `data`, `result` or `salesperson` envelope if there is one. This is
 * not laxity for its own sake: it means switching Saarthi onto the real
 * endpoint is a URL in `.env`, and a field that genuinely is not there comes
 * back as `null` rather than as a crash on somebody's first login.
 *
 * ## Why a 404 is not an error
 *
 * A GODID GODWeb does not recognise is an *answer*, and the salesman service
 * needs to act on it — that profile is rejected, permanently, and the person
 * is told their GODID is not recognised. Only a genuine failure to ask (a
 * timeout, a refused key, an unparseable body) throws, because that must leave
 * the profile pending and retryable instead.
 */

const PROVIDER_NAME = 'godweb';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

/** First non-empty string among the given keys. */
function pickString(source: JsonRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * Whether GODWeb says this person may still sell.
 *
 * Defaults to `true` when GODWeb says nothing about it, and that default is
 * deliberate: an endpoint that returns a record at all is asserting the person
 * exists, and inferring "inactive" from a missing field would lock out every
 * legitimate salesperson the moment GODWeb ships a payload without a status.
 * An explicit negative — `false`, `"inactive"`, `"suspended"`, `"disabled"`,
 * `"left"` — is honoured.
 */
function pickActive(source: JsonRecord): boolean {
  for (const key of ['active', 'isActive', 'is_active', 'enabled']) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lowered = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'active'].includes(lowered)) return true;
      if (['false', '0', 'no', 'inactive'].includes(lowered)) return false;
    }
  }

  const status = pickString(source, 'status', 'state', 'accountStatus', 'account_status');
  if (status) {
    const lowered = status.toLowerCase();
    if (['inactive', 'suspended', 'disabled', 'blocked', 'terminated', 'left'].includes(lowered)) {
      return false;
    }
  }

  return true;
}

/** Unwrap whichever envelope GODWeb wraps the record in, if any. */
function unwrap(body: JsonRecord): JsonRecord | null {
  for (const key of ['salesperson', 'salesman', 'data', 'result', 'record']) {
    const nested = asRecord(body[key]);
    if (nested) {
      // One more level: `{ data: { salesperson: {...} } }` is a real shape.
      const deeper = asRecord(nested.salesperson) ?? asRecord(nested.salesman);
      return deeper ?? nested;
    }
  }
  // A bare record, with the fields at the top level.
  return body;
}

export function normalizeGodWebSalesperson(
  body: JsonRecord,
  requestedGodId: string,
): GodWebSalesperson | null {
  const record = unwrap(body);
  if (!record) return null;

  /*
   * The GODID GODWeb echoed back, falling back to the one we asked about.
   *
   * The echo is preferred because GODWeb owns the canonical spelling. It is
   * then compared against the request below — an endpoint that answers with a
   * *different* identity is a bug or a misrouted proxy, and crediting a
   * commission to whoever it named would be the worst possible way to find out.
   */
  const echoed = pickString(record, 'godId', 'god_id', 'godID', 'code', 'id');
  const godId = normalizeGodId(echoed ?? requestedGodId);

  if (godId !== normalizeGodId(requestedGodId)) {
    logger.error(
      { provider: PROVIDER_NAME, requested: requestedGodId, answered: godId },
      'GODWeb answered with a different GODID than the one requested',
    );
    return null;
  }

  const firstName = pickString(record, 'firstName', 'first_name');
  const lastName = pickString(record, 'lastName', 'last_name');
  const composed = [firstName, lastName].filter(Boolean).join(' ').trim();

  return {
    godId,
    name: pickString(record, 'name', 'fullName', 'full_name', 'displayName') ?? (composed || null),
    phone: pickString(record, 'phone', 'mobile', 'phoneNumber', 'phone_number', 'contactNumber'),
    email: pickString(record, 'email', 'emailAddress', 'email_address'),
    externalSalespersonId: pickString(
      record,
      'salespersonId',
      'salesperson_id',
      'employeeId',
      'employee_id',
      'externalId',
      'external_id',
      'staffId',
    ),
    territory: pickString(record, 'territory', 'region', 'zone', 'area'),
    active: pickActive(record),
  };
}

export class HttpGodWebProvider implements GodWebProvider {
  readonly name = PROVIDER_NAME;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly validatePath: string;
  private readonly timeoutMs: number;

  constructor() {
    if (!config.godweb.baseUrl || !config.godweb.apiKey) {
      throw new Error(
        'GODWeb salesman validation requires GODWEB_BASE_URL and GODWEB_API_KEY to be configured.',
      );
    }
    this.baseUrl = config.godweb.baseUrl;
    this.apiKey = config.godweb.apiKey;
    this.validatePath = config.godweb.validatePath;
    this.timeoutMs = config.godweb.timeoutMs;
  }

  get configured(): boolean {
    return true;
  }

  async validateGodId(godId: string): Promise<GodWebValidationOutcome> {
    const normalized = normalizeGodId(godId);
    const path = this.validatePath.replace('{godId}', encodeURIComponent(normalized));
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          // Sent as well as the bearer token because GODWeb's own convention
          // is not settled; an endpoint that ignores one header is unharmed by
          // receiving both, and this saves a code change either way.
          'x-api-key': this.apiKey,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        logger.warn({ provider: this.name, godId: normalized }, 'GODWeb validation timed out');
        throw errors.providerTimeout(
          this.name,
          'GODWeb did not respond in time, so this GODID could not be verified. Try again shortly.',
        );
      }
      logger.error(
        { provider: this.name, godId: normalized, err: error },
        'GODWeb could not be reached',
      );
      throw errors.providerUnavailable(
        this.name,
        'GODWeb could not be reached, so this GODID could not be verified.',
      );
    } finally {
      clearTimeout(timeout);
    }

    // A GODID GODWeb has never heard of. A real answer, not a failure.
    if (response.status === 404) {
      return {
        found: false,
        salesperson: null,
        providerReference: response.headers.get('x-request-id'),
        message: 'GODWeb does not recognise this GODID.',
      };
    }

    if (response.status === 401 || response.status === 403) {
      // Saarthi's credential, not the salesperson's problem. Loud for us,
      // generic for them — nobody in the field can act on "bad API key".
      logger.error(
        { provider: this.name, status: response.status },
        'GODWeb rejected the Saarthi API key',
      );
      throw errors.providerUnavailable(
        this.name,
        'GODID verification is temporarily unavailable. Saarthi support has been notified.',
      );
    }

    if (!response.ok) {
      logger.error(
        { provider: this.name, status: response.status, godId: normalized },
        'GODWeb returned an error status',
      );
      throw errors.providerUnavailable(
        this.name,
        'GODWeb could not verify this GODID just now. Try again shortly.',
      );
    }

    const raw = await response.text().catch(() => '');
    if (!raw.trim()) {
      logger.error({ provider: this.name, godId: normalized }, 'GODWeb returned an empty body');
      throw errors.provider(this.name, 'GODWeb returned an unreadable response.');
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      logger.error({ provider: this.name, godId: normalized }, 'GODWeb returned a malformed body');
      throw errors.provider(this.name, 'GODWeb returned an unreadable response.');
    }

    const asObject = asRecord(body);
    if (!asObject) {
      throw errors.provider(this.name, 'GODWeb returned an unexpected response shape.');
    }

    /*
     * An explicit negative inside a 200.
     *
     * Some read APIs answer "not found" with a 200 and a flag rather than a
     * 404. Both have to mean the same thing here, or the same GODID would be
     * rejected on one deployment and left pending on another.
     */
    const found = asObject.found ?? asObject.exists ?? asObject.success;
    if (found === false) {
      return {
        found: false,
        salesperson: null,
        providerReference: pickString(asObject, 'requestId', 'request_id', 'reference'),
        message:
          pickString(asObject, 'message', 'error', 'detail') ??
          'GODWeb does not recognise this GODID.',
      };
    }

    const salesperson = normalizeGodWebSalesperson(asObject, normalized);
    if (!salesperson) {
      throw errors.provider(
        this.name,
        'GODWeb returned a record Saarthi could not read. This GODID has not been verified.',
      );
    }

    return {
      found: true,
      salesperson,
      providerReference: pickString(asObject, 'requestId', 'request_id', 'reference'),
      message: null,
    };
  }
}
