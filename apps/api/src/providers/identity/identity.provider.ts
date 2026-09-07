import type {
  AadhaarRecord,
  GstRecord,
  PanRecord,
  VoterIdRecord,
} from '@saarthi/shared';

/**
 * Identity verification provider contract.
 *
 * Mirrors the RC and licence providers: everything upstream-specific stays
 * behind this interface, and the service layer only ever sees Saarthi's own
 * normalised records.
 *
 * Each method reports *the source's answer*, including a negative one. A number
 * the source has never heard of is a `found: false` result, not an exception —
 * "this PAN does not exist" is a successful verification with a negative
 * outcome, and the service records it as such. Exceptions are reserved for
 * Saarthi failing to get an answer at all: a timeout, a rejected API key, an
 * exhausted balance.
 */

export interface IdentityLookupOutcome<TRecord> {
  /** The source holds a record for this number. */
  found: boolean;
  /** Null whenever `found` is false. */
  record: TRecord | null;
  /** The provider's order id, for support tickets and billing queries. */
  providerReference: string | null;
  /** The source's own explanation of a negative answer, when it gave one. */
  message: string | null;
}

export interface PanLookupInput {
  /** Already normalised, e.g. `ABCDE1234F`. */
  panNumber: string;
  /**
   * When supplied, the provider is asked to match it against the record, which
   * turns "this PAN exists" into "this PAN belongs to this person".
   */
  holderName?: string | undefined;
}

export interface VoterIdLookupInput {
  /** Already normalised EPIC number. */
  epicNumber: string;
}

export interface GstLookupInput {
  /** Already normalised 15-character GSTIN. */
  gstin: string;
}

export interface AadhaarPanLinkInput {
  /** Already normalised 12-digit Aadhaar. */
  aadhaarNumber: string;
  /** Already normalised PAN to check the link against. */
  panNumber: string;
}

export interface AadhaarPanLinkOutcome {
  /** `true` linked, `false` not linked, `null` the source would not say. */
  linked: boolean | null;
  providerReference: string | null;
  message: string | null;
}

export interface IdentityVerificationProvider {
  readonly name: string;
  readonly configured: boolean;
  verifyPan(input: PanLookupInput): Promise<IdentityLookupOutcome<PanRecord>>;
  verifyVoterId(input: VoterIdLookupInput): Promise<IdentityLookupOutcome<VoterIdRecord>>;
  verifyGstin(input: GstLookupInput): Promise<IdentityLookupOutcome<GstRecord>>;
  /**
   * The closest thing to an online Aadhaar check available without a UIDAI
   * licence — see `AADHAAR_ONLINE_LIMITATION` in @saarthi/shared.
   */
  checkAadhaarPanLink(input: AadhaarPanLinkInput): Promise<AadhaarPanLinkOutcome>;
}

// ---------------------------------------------------------------------------
// Empty records — the base a normaliser fills in
// ---------------------------------------------------------------------------

export function emptyPanRecord(): PanRecord {
  return {
    panNumber: null,
    holderName: null,
    holderType: null,
    panStatus: null,
    aadhaarLinked: null,
    nameMatch: null,
    lastUpdatedOn: null,
    redacted: false,
  };
}

export function emptyVoterIdRecord(): VoterIdRecord {
  return {
    epicNumber: null,
    holderName: null,
    relativeName: null,
    relationType: null,
    gender: null,
    age: null,
    state: null,
    district: null,
    assemblyConstituency: null,
    parliamentaryConstituency: null,
    pollingStation: null,
    partNumber: null,
    redacted: false,
  };
}

export function emptyGstRecord(): GstRecord {
  return {
    gstin: null,
    legalName: null,
    tradeName: null,
    status: null,
    taxpayerType: null,
    constitutionOfBusiness: null,
    registrationDate: null,
    cancellationDate: null,
    state: null,
    principalAddress: null,
    natureOfBusiness: [],
    embeddedPan: null,
    redacted: false,
  };
}

export function emptyAadhaarRecord(): AadhaarRecord {
  return {
    maskedNumber: null,
    checksumValid: false,
    linkedToPan: null,
    linkedPanMasked: null,
    linkCheckSource: null,
    redacted: false,
  };
}
