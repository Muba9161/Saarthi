/**
 * Driving licence domain contract.
 *
 * Saarthi's own normalised model for an RTO licence record. Everything
 * provider-specific — field names, date sentinels, status vocabulary — is
 * converted in `apps/api/src/providers/driving-licence`, so the rest of the
 * platform never learns who the upstream is.
 *
 * The same two rules as the RC record apply: every field is nullable and an
 * absent value is `null` rather than a guess, and the holder's personal details
 * are grouped so the API can strip the whole block for callers who are not
 * authorised to see them.
 */

/** Personal details of the licence holder. Only for authorised callers. */
export interface DrivingLicenceHolder {
  name: string | null;
  fatherOrHusbandName: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  bloodGroup: string | null;
  citizenship: string | null;
  permanentAddress: string | null;
  permanentZip: string | null;
  temporaryAddress: string | null;
  temporaryZip: string | null;
}

export interface DrivingLicenceRecord {
  licenceNumber: string | null;
  state: string | null;

  /** `null` in its entirety when the caller may not see personal data. */
  holder: DrivingLicenceHolder | null;

  issuingAuthority: string | null;
  issuingAuthorityCode: string | null;

  issuedOn: string | null;
  validUntil: string | null;

  /**
   * Commercial (transport) entitlement, which expires separately from the
   * ordinary licence and is the one that matters for a goods-vehicle driver.
   */
  transportIssuedOn: string | null;
  transportValidUntil: string | null;

  /** Entitlement codes, e.g. `LMV-NT`, `MCWG`, `HTV`. */
  vehicleClasses: string[];

  /** The RTO holds a photograph. The image itself is never retrieved. */
  hasPhotograph: boolean | null;
  /** The provider flagged this as a reduced record rather than a full one. */
  partialRecord: boolean | null;
  /** Saarthi stripped the holder block for this caller. */
  redacted: boolean;
}

/** What the licence lookup endpoints return. */
export interface LicenceLookupResult {
  lookupId: string;
  licenceNumber: string;
  licence: DrivingLicenceRecord;
  /** Served from Saarthi's own store rather than a fresh provider call. */
  cached: boolean;
  retrievedAt: string;
  expiresAt: string | null;
  providerReference: string | null;
}

// ---------------------------------------------------------------------------
// Licence numbers
// ---------------------------------------------------------------------------

/** Uppercase and strip the separators people type. `dl-04 2011 0149646`. */
export function normalizeLicenceNumber(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Does a normalised string plausibly look like an Indian driving licence?
 *
 * Deliberately permissive. The canonical form is a two-letter state code, a
 * two-digit RTO code, a four-digit year and a serial — but issuing states have
 * varied the length and some older licences carry a different shape entirely.
 * Rejecting a real licence is worse than passing an odd one to the provider,
 * which is the authority; this only filters obvious rubbish before money is
 * spent.
 */
export function isPlausibleIndianLicence(value: string): boolean {
  if (!/^[A-Z0-9]{8,20}$/.test(value)) return false;
  // Every Indian licence begins with its issuing state's two-letter code.
  if (!/^[A-Z]{2}/.test(value)) return false;
  // And carries a numeric body — letters alone are not a licence number.
  return /\d{6,}/.test(value);
}

/**
 * Provider sentinel for "no transport entitlement".
 *
 * The upstream returns `1800-01-01` rather than null for a licence with no
 * commercial class. Rendering that as a real date would tell an operator their
 * driver's transport licence expired two centuries ago.
 */
export const LICENCE_NULL_DATE = '1800-01-01';

/** Entitlement codes that permit driving a commercial goods vehicle. */
const TRANSPORT_CLASS_PATTERN = /(TRANS|HTV|HMV|HGMV|LMV-TR|MGV|HPMV|PSV|TRAILER)/i;

/**
 * Can this licence lawfully be used to drive a commercial goods vehicle?
 *
 * Returns `null` when the record lists no classes at all — an unknown is not a
 * "no", and a fleet manager must not be told a driver is unqualified because
 * the RTO happened to publish nothing.
 */
export function hasTransportEntitlement(record: DrivingLicenceRecord): boolean | null {
  if (record.vehicleClasses.length === 0) return null;
  return record.vehicleClasses.some((entry) => TRANSPORT_CLASS_PATTERN.test(entry));
}
