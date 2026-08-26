import type { DrivingLicenceRecord } from '@saarthi/shared';

/**
 * Driving licence provider contract.
 *
 * Mirrors the vehicle RC provider: everything upstream-specific stays behind
 * this interface, and the service layer only ever sees a
 * `DrivingLicenceRecord`.
 */

export interface DrivingLicenceLookup {
  /** Already normalised, e.g. `MH0320140001234`. */
  licenceNumber: string;
  /** The provider verifies the number against this, so it is required. */
  dateOfBirth: Date;
}

export interface DrivingLicenceLookupResult {
  record: DrivingLicenceRecord;
  providerReference: string | null;
}

export interface DrivingLicenceProvider {
  readonly name: string;
  readonly configured: boolean;
  lookup(input: DrivingLicenceLookup): Promise<DrivingLicenceLookupResult>;
}

/** A licence record with every field null — the base a normaliser fills in. */
export function emptyDrivingLicenceRecord(): DrivingLicenceRecord {
  return {
    licenceNumber: null,
    state: null,
    holder: null,
    issuingAuthority: null,
    issuingAuthorityCode: null,
    issuedOn: null,
    validUntil: null,
    transportIssuedOn: null,
    transportValidUntil: null,
    vehicleClasses: [],
    hasPhotograph: null,
    partialRecord: null,
    redacted: false,
  };
}
