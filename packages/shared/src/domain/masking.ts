/**
 * Field masking.
 *
 * Masking is a *disclosure* decision, so it lives in shared code and is applied
 * on the server before a value ever reaches a response body. The client never
 * receives the full value and then hides it — that would put the secret in the
 * browser and the policy in the wrong place.
 *
 * Every function here is total: a null, an empty string or a value shorter than
 * the window it would keep returns a fully masked token rather than throwing or
 * leaking the original.
 */

/** Character used for every redacted position. */
const MASK_CHAR = '*';

/** What a fully redacted value looks like when nothing may be kept. */
export const REDACTED = '••••';

export const MaskStrategy = {
  /** Return the value unchanged. */
  NONE: 'NONE',
  /** `9876543210` → `98******10` */
  PHONE: 'PHONE',
  /** `DL-123456789012` → `DL-1234****9012` */
  LICENCE: 'LICENCE',
  /** `LOAN-123456789` → `LOAN-*****6789` */
  REFERENCE: 'REFERENCE',
  /** `ramesh@example.com` → `r****h@example.com` */
  EMAIL: 'EMAIL',
  /** `Ramesh Kumar` → `Ramesh K.` */
  NAME: 'NAME',
  /** `UP32AB1234` → `UP32AB****` */
  REGISTRATION: 'REGISTRATION',
  /** Keep only the last four characters. */
  LAST_FOUR: 'LAST_FOUR',
  /** Disclose nothing at all. */
  HIDDEN: 'HIDDEN',
} as const;
export type MaskStrategy = (typeof MaskStrategy)[keyof typeof MaskStrategy];

function repeat(count: number): string {
  return MASK_CHAR.repeat(Math.max(0, count));
}

/**
 * Keep `keepStart` leading and `keepEnd` trailing characters, mask the rest
 * one-for-one so the length of the original is preserved.
 *
 * If the value is too short for the window to hide at least one character, it
 * is masked entirely — keeping "98**10" of a six-digit secret discloses more
 * than it protects.
 */
export function maskMiddle(value: string, keepStart: number, keepEnd: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length <= keepStart + keepEnd) return repeat(trimmed.length);
  return (
    trimmed.slice(0, keepStart) +
    repeat(trimmed.length - keepStart - keepEnd) +
    trimmed.slice(trimmed.length - keepEnd)
  );
}

/** Leading run of letters and separators, e.g. `LOAN-` in `LOAN-123456789`. */
function splitPrefix(value: string): { prefix: string; body: string } {
  const match = /^([A-Za-z]+[-/\s]?)(.*)$/.exec(value);
  const prefix = match?.[1];
  const body = match?.[2];
  if (prefix === undefined || body === undefined || body.length === 0) {
    return { prefix: '', body: value };
  }
  return { prefix, body };
}

/** `+919876543210` / `9876543210` → `98******10`. */
export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return repeat(digits.length || 4);
  // The +91 country code is not a secret and is dropped rather than masked, so
  // the mask window applies to the subscriber number itself.
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return maskMiddle(national, 2, 2);
}

/** `DL-123456789012` → `DL-1234****9012`. */
export function maskLicenceNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.trim().toUpperCase();
  if (compact.length === 0) return null;
  const { prefix, body } = splitPrefix(compact);
  if (body.length <= 8) return prefix + repeat(body.length);
  return prefix + maskMiddle(body, 4, 4);
}

/** `LOAN-123456789` → `LOAN-*****6789`. Also used for mandates and accounts. */
export function maskReferenceNumber(
  value: string | null | undefined,
  keepEnd = 4,
): string | null {
  if (!value) return null;
  const compact = value.trim();
  if (compact.length === 0) return null;
  const { prefix, body } = splitPrefix(compact);
  if (body.length <= keepEnd) return prefix + repeat(body.length);
  return prefix + maskMiddle(body, 0, keepEnd);
}

/** `ramesh@example.com` → `r****h@example.com`. Domain is left intact. */
export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = value.lastIndexOf('@');
  if (at <= 0) return maskMiddle(value, 1, 1);
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const maskedLocal = local.length <= 2 ? repeat(local.length) : maskMiddle(local, 1, 1);
  return `${maskedLocal}${domain}`;
}

/** `Ramesh Kumar` → `Ramesh K.` — enough to confirm, not enough to trace. */
export function maskName(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (first === undefined || last === undefined) return null;
  if (parts.length === 1) return first;
  return `${first} ${last.charAt(0).toUpperCase()}.`;
}

/** `UP32AB1234` → `UP32AB****`: the RTO and series stay, the unique part goes. */
export function maskRegistrationNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, '').toUpperCase();
  if (compact.length <= 4) return repeat(compact.length);
  return maskMiddle(compact, compact.length - 4, 0);
}

export function maskLastFour(value: string | null | undefined): string | null {
  if (!value) return null;
  return maskMiddle(value.trim(), 0, 4);
}

/** Dispatch by strategy. Unknown strategies fail closed to fully hidden. */
export function applyMask(
  value: string | null | undefined,
  strategy: MaskStrategy,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  switch (strategy) {
    case MaskStrategy.NONE:
      return value;
    case MaskStrategy.PHONE:
      return maskPhone(value);
    case MaskStrategy.LICENCE:
      return maskLicenceNumber(value);
    case MaskStrategy.REFERENCE:
      return maskReferenceNumber(value);
    case MaskStrategy.EMAIL:
      return maskEmail(value);
    case MaskStrategy.NAME:
      return maskName(value);
    case MaskStrategy.REGISTRATION:
      return maskRegistrationNumber(value);
    case MaskStrategy.LAST_FOUR:
      return maskLastFour(value);
    case MaskStrategy.HIDDEN:
      return REDACTED;
    default:
      return REDACTED;
  }
}

/**
 * A value plus whether the caller is seeing all of it.
 *
 * Returned instead of a bare string so the UI can label a partial value
 * honestly ("masked for your access level") rather than presenting a masked
 * loan number as though it were the real one.
 */
export interface MaskedValue {
  value: string | null;
  masked: boolean;
}

export function masked(
  value: string | null | undefined,
  strategy: MaskStrategy,
): MaskedValue {
  if (value === null || value === undefined || value === '') {
    return { value: null, masked: false };
  }
  if (strategy === MaskStrategy.NONE) return { value, masked: false };
  return { value: applyMask(value, strategy), masked: true };
}
