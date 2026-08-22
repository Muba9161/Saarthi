/**
 * Vehicle Registration Certificate (RC) domain contract.
 *
 * This is Saarthi's own normalised model. Nothing outside
 * `apps/api/src/providers/vehicle-rc` may know how the upstream RTO data
 * provider names its fields, so the provider can be replaced without a single
 * change to the API surface, the client or these types.
 *
 * Rules encoded here:
 *  * Every field is nullable. A provider that omits a field yields `null` —
 *    it is never guessed, defaulted or back-filled from another field.
 *  * Sensitive identity fields are grouped so the API can strip the whole set
 *    for callers who are not authorised to see them.
 */

/** Road-tax validity, as published by the RTO. */
export interface VehicleTaxInfo {
  validUntil: string | null;
  paidUntil: string | null;
}

/** National permit details, where the vehicle holds one. */
export interface VehicleNationalPermit {
  number: string | null;
  validUntil: string | null;
  issuedBy: string | null;
}

export interface VehiclePermitInfo {
  number: string | null;
  type: string | null;
  issuedOn: string | null;
  validFrom: string | null;
  validUntil: string | null;
  national: VehicleNationalPermit;
}

/** "Non-use" declaration — a vehicle formally off the road for a period. */
export interface VehicleNonUseInfo {
  status: string | null;
  from: string | null;
  to: string | null;
}

/**
 * Which fields the upstream provider itself returned masked. Distinct from
 * Saarthi's own authorisation redaction — see `VehicleRcRecord.redacted`.
 */
export interface VehicleMaskedFields {
  ownerName: boolean;
  chassisNumber: boolean;
  engineNumber: boolean;
}

/** Personal-data fields, only populated for authorised callers. */
export interface VehicleOwnerInfo {
  name: string | null;
  fatherName: string | null;
  serialNumber: string | null;
  mobileNumber: string | null;
  presentAddress: string | null;
  permanentAddress: string | null;
}

export interface VehicleRcRecord {
  registrationNumber: string | null;
  registrationDate: string | null;
  registrationStatus: string | null;

  /** `null` in its entirety when the caller may not see personal data. */
  owner: VehicleOwnerInfo | null;

  vehicleCategory: string | null;
  vehicleClass: string | null;
  bodyType: string | null;

  maker: string | null;
  model: string | null;
  variant: string | null;
  fuelType: string | null;
  color: string | null;
  emissionNorms: string | null;
  manufacturedOn: string | null;

  /** Identity fields — omitted for callers without the sensitive permission. */
  engineNumber: string | null;
  chassisNumber: string | null;

  cubicCapacity: number | null;
  cylinders: number | null;
  seatingCapacity: number | null;
  sleeperCapacity: number | null;
  standingCapacity: number | null;
  wheelbaseMm: number | null;

  grossVehicleWeight: number | null;
  unladenWeight: number | null;

  rto: string | null;
  rtoCode: string | null;

  insurer: string | null;
  insurancePolicyNumber: string | null;
  insuranceValidUntil: string | null;

  puccNumber: string | null;
  puccValidUntil: string | null;

  fitnessValidUntil: string | null;

  tax: VehicleTaxInfo;
  permit: VehiclePermitInfo;

  financed: boolean | null;
  financer: string | null;

  blacklistStatus: string | null;
  nocDetails: string | null;
  nonUse: VehicleNonUseInfo;
  challanDetails: string | null;

  /** Date the provider last refreshed this record against the RTO source. */
  dataAsOf: string | null;
  /** The provider flagged this as a reduced record rather than a full one. */
  partialRecord: boolean | null;
  maskedByProvider: VehicleMaskedFields;
  /** Saarthi stripped personal/identity fields for this caller. */
  redacted: boolean;
}

/** What `POST /api/v1/vehicles/lookup` returns. */
export interface VehicleLookupResult {
  /** Handle for the RC PDF endpoint; `null` when no document was stored. */
  lookupId: string;
  registrationNumber: string;
  vehicle: VehicleRcRecord;
  /** True when served from Saarthi's cache instead of a fresh provider call. */
  cached: boolean;
  retrievedAt: string;
  expiresAt: string | null;
  /** A stored RC PDF is available for download from Saarthi. */
  pdfAvailable: boolean;
  /** Provider order reference, useful when raising a support ticket. */
  providerReference: string | null;
}

// ---------------------------------------------------------------------------
// Registration numbers
// ---------------------------------------------------------------------------

/**
 * Does a normalised string plausibly look like an Indian registration number?
 *
 * Deliberately permissive: alongside the common `UP32AB1234` form, India has
 * Bharat series (`22BH1234AA`), defence, diplomatic and older short formats.
 * Rejecting a real plate is worse than passing an odd one to the provider,
 * which validates authoritatively — so this only filters obvious rubbish.
 */
export function isPlausibleIndianRegistration(value: string): boolean {
  if (!/^[A-Z0-9]{6,15}$/.test(value)) return false;
  // Must contain both letters and digits — "1234567" and "ABCDEFG" are not plates.
  if (!/[A-Z]/.test(value) || !/\d/.test(value)) return false;
  return (
    // State series, e.g. UP32AB1234, DL3CAB1234, MH12A1234.
    /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(value) ||
    // Bharat series, e.g. 22BH1234AA.
    /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(value) ||
    // Defence, e.g. 09A123456X.
    /^\d{2}[A-Z]\d{6}[A-Z]$/.test(value)
  );
}

export type RcValidity = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN';

/**
 * Validity band for an RC date (insurance, PUCC, fitness, tax), for the
 * compliance strip in the UI. `UNKNOWN` when the provider gave us nothing —
 * an absent date is never presented as valid.
 */
export function rcValidity(
  validUntil: string | null | undefined,
  options: { expiringSoonDays?: number; now?: Date } = {},
): { validity: RcValidity; daysRemaining: number | null } {
  const { expiringSoonDays = 30, now = new Date() } = options;
  if (!validUntil) return { validity: 'UNKNOWN', daysRemaining: null };

  const target = new Date(validUntil);
  if (Number.isNaN(target.getTime())) return { validity: 'UNKNOWN', daysRemaining: null };

  const days = Math.round(
    (Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()) -
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
      86_400_000,
  );

  if (days < 0) return { validity: 'EXPIRED', daysRemaining: days };
  if (days <= expiringSoonDays) return { validity: 'EXPIRING_SOON', daysRemaining: days };
  return { validity: 'VALID', daysRemaining: days };
}
