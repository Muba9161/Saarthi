/**
 * Indian identity-document verification.
 *
 * Aadhaar, PAN, Voter ID (EPIC) and GSTIN. Four numbers, one shape: normalise
 * what a person typed, refuse it locally if it cannot possibly be real, then —
 * and only then — spend a billable provider call confirming it against the
 * government source.
 *
 * The local check is not a nicety. Every one of these numbers carries a
 * self-check (a Verhoeff digit on Aadhaar, a mod-36 digit on GSTIN, a fixed
 * grammar on PAN and EPIC), so a typo can be caught for free instead of being
 * billed for, and instead of being reported to a fleet manager as "not found"
 * when the truth is "you missed a digit".
 *
 * Nothing here talks to a network, and nothing here stores anything. The
 * provider adapters live in `apps/api/src/providers/identity`, and the
 * retention rules in the identity-verification module.
 */

import { IdentityDocumentKind, IdentityVerificationOutcome } from './enums';
import { DocumentOwnerType, VerificationSubjectType } from './enums';

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Strip the separators people type and uppercase what remains.
 *
 * Aadhaar is printed in `1234 5678 9012` groups, GSTINs get hyphenated in
 * spreadsheets, and a licence-style dash finds its way into everything. One
 * normalised form means one cache key and one billable call, not three.
 */
export function normalizeIdentityNumber(value: string): string {
  return value.toUpperCase().replace(/[\s.\-/]/g, '');
}

export const normalizeAadhaar = normalizeIdentityNumber;
export const normalizePan = normalizeIdentityNumber;
export const normalizeVoterId = normalizeIdentityNumber;
export const normalizeGstin = normalizeIdentityNumber;

// ---------------------------------------------------------------------------
// Aadhaar — Verhoeff
// ---------------------------------------------------------------------------

/**
 * The Verhoeff dihedral-group tables, as published by UIDAI.
 *
 * Verhoeff rather than Luhn because it is what Aadhaar actually uses: it
 * catches every single-digit error and every adjacent transposition, which are
 * the two mistakes a person copying twelve digits off a card actually makes.
 */
const VERHOEFF_D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** `true` when the digit string carries a valid trailing Verhoeff check digit. */
export function hasValidVerhoeffChecksum(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let checksum = 0;
  const reversed = digits.split('').reverse();
  for (let index = 0; index < reversed.length; index += 1) {
    const digit = Number(reversed[index]);
    checksum = VERHOEFF_D[checksum]![VERHOEFF_P[index % 8]![digit]!]!;
  }
  return checksum === 0;
}

/**
 * A structurally valid Aadhaar number.
 *
 * Twelve digits, not starting with 0 or 1 (UIDAI never issues those, so they
 * are the giveaway of a made-up number), and a correct Verhoeff check digit.
 * This says the number *could* have been issued — not that it was, and not to
 * whom. Only the provider can say that.
 */
export function isValidAadhaar(value: string): boolean {
  const normalized = normalizeAadhaar(value);
  if (!/^[2-9]\d{11}$/.test(normalized)) return false;
  return hasValidVerhoeffChecksum(normalized);
}

// ---------------------------------------------------------------------------
// PAN
// ---------------------------------------------------------------------------

/** Fourth character of a PAN: the class of holder it was issued to. */
export const PAN_HOLDER_TYPES: Readonly<Record<string, string>> = Object.freeze({
  A: 'Association of persons',
  B: 'Body of individuals',
  C: 'Company',
  F: 'Firm / LLP',
  G: 'Government',
  H: 'Hindu undivided family',
  J: 'Artificial juridical person',
  L: 'Local authority',
  P: 'Individual',
  T: 'Trust',
});

const PAN_PATTERN = /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/;

/**
 * A structurally valid PAN.
 *
 * Five letters, four digits, one letter — but the fourth letter is not free:
 * it is the holder class above, and the fifth is the first letter of the
 * surname or entity name. Checking the fourth character rejects a large share
 * of invented PANs before a call is billed for them.
 */
export function isValidPan(value: string): boolean {
  return PAN_PATTERN.test(normalizePan(value));
}

/** The kind of holder a PAN was issued to, from its fourth character. */
export function panHolderType(value: string): string | null {
  const normalized = normalizePan(value);
  if (!isValidPan(normalized)) return null;
  return PAN_HOLDER_TYPES[normalized.charAt(3)] ?? null;
}

/** `true` when the PAN belongs to a natural person rather than a business. */
export function isIndividualPan(value: string): boolean {
  return isValidPan(value) && normalizePan(value).charAt(3) === 'P';
}

// ---------------------------------------------------------------------------
// Voter ID (EPIC)
// ---------------------------------------------------------------------------

/**
 * EPIC numbers come in two shapes.
 *
 * The current one is three letters of state/AC code followed by seven digits.
 * Older cards — still perfectly valid, and the ones an experienced driver is
 * most likely to hold — carry two or three letters, a slash, and a longer
 * numeric tail. Rejecting the older form would refuse the very people this is
 * meant to onboard, so both are accepted; the separators are already gone by
 * the time this sees the value.
 */
const EPIC_PATTERNS = [/^[A-Z]{3}\d{7}$/, /^[A-Z]{2,3}\d{8,13}$/];

export function isValidVoterId(value: string): boolean {
  const normalized = normalizeVoterId(value);
  return EPIC_PATTERNS.some((pattern) => pattern.test(normalized));
}

// ---------------------------------------------------------------------------
// GSTIN
// ---------------------------------------------------------------------------

/** GST state codes, indexed by the first two digits of a GSTIN. */
export const GST_STATE_CODES: Readonly<Record<string, string>> = Object.freeze({
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other territory',
  '99': 'Centre jurisdiction',
});

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The GSTIN check character: a mod-36 weighted sum over the first fourteen
 * positions, alternating weights 1 and 2, folding each product back into base
 * 36. Cheap to compute and it catches the transpositions people make copying a
 * fifteen-character string off a tax invoice.
 */
export function gstinCheckCharacter(first14: string): string | null {
  if (first14.length !== 14) return null;
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const position = GSTIN_ALPHABET.indexOf(first14.charAt(index));
    if (position < 0) return null;
    const product = position * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_ALPHABET.charAt((36 - (sum % 36)) % 36);
}

/**
 * A structurally valid GSTIN.
 *
 * Fifteen characters: a state code, the holder's PAN, an entity number, a
 * literal `Z`, and the check character above. The embedded PAN is what lets a
 * business's GSTIN and PAN be cross-checked without a second provider call.
 */
export function isValidGstin(value: string): boolean {
  const normalized = normalizeGstin(value);
  if (!GSTIN_PATTERN.test(normalized)) return false;
  if (!(normalized.slice(0, 2) in GST_STATE_CODES)) return false;
  // Characters 3–12 are the holder's PAN, so they are held to the PAN grammar
  // — including the entity-type character. A GSTIN whose embedded PAN could
  // not have been issued was hand-edited, whatever its check character says.
  if (!isValidPan(normalized.slice(2, 12))) return false;
  return gstinCheckCharacter(normalized.slice(0, 14)) === normalized.charAt(14);
}

/** The PAN embedded in a GSTIN, or `null` if the GSTIN is not well formed. */
export function panFromGstin(value: string): string | null {
  const normalized = normalizeGstin(value);
  if (!isValidGstin(normalized)) return null;
  return normalized.slice(2, 12);
}

/** The state a GSTIN was registered in, from its leading two digits. */
export function gstStateFromGstin(value: string): string | null {
  const normalized = normalizeGstin(value);
  if (normalized.length < 2) return null;
  return GST_STATE_CODES[normalized.slice(0, 2)] ?? null;
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/**
 * What may be shown back on screen once a number has been verified.
 *
 * Aadhaar keeps four digits, which is the disclosure UIDAI itself permits and
 * is enough for a person to recognise their own card. PAN and GSTIN keep a
 * wider window because both are routinely printed on invoices and are not
 * secret in the way an Aadhaar number is.
 */
export function maskIdentityNumber(kind: IdentityDocumentKind, value: string): string {
  const normalized = normalizeIdentityNumber(value);
  if (normalized.length === 0) return '';

  switch (kind) {
    case IdentityDocumentKind.AADHAAR:
      return normalized.length <= 4
        ? '•'.repeat(normalized.length)
        : `XXXX XXXX ${normalized.slice(-4)}`;
    case IdentityDocumentKind.PAN:
      return normalized.length <= 5
        ? '•'.repeat(normalized.length)
        : `${normalized.slice(0, 3)}${'•'.repeat(Math.max(0, normalized.length - 5))}${normalized.slice(-2)}`;
    case IdentityDocumentKind.GST:
      return normalized.length <= 6
        ? '•'.repeat(normalized.length)
        : `${normalized.slice(0, 2)}${'•'.repeat(Math.max(0, normalized.length - 6))}${normalized.slice(-4)}`;
    case IdentityDocumentKind.VOTER_ID:
    default:
      return normalized.length <= 4
        ? '•'.repeat(normalized.length)
        : `${normalized.slice(0, 3)}${'•'.repeat(Math.max(0, normalized.length - 6))}${normalized.slice(-3)}`;
  }
}

/** The last four characters kept on the subject record. Empty when too short. */
export function identityLastFour(value: string): string {
  const normalized = normalizeIdentityNumber(value);
  return normalized.length >= 4 ? normalized.slice(-4) : '';
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** Extra field a kind needs before it can be checked at all. */
export type IdentitySecondFactor = 'NONE' | 'DATE_OF_BIRTH' | 'LINKED_PAN' | 'HOLDER_NAME';

export interface IdentityKindDefinition {
  kind: IdentityDocumentKind;
  label: string;
  /** What the subject calls it, for the empty state and the upload picker. */
  shortLabel: string;
  subjectType: VerificationSubjectType;
  ownerType: DocumentOwnerType;
  /** The `DOCUMENT_TYPES` code an upload of this document carries. */
  documentType: string;
  /** Placeholder in the number field, showing the printed grouping. */
  placeholder: string;
  /** Human description of the accepted format, shown under the field. */
  formatHint: string;
  /**
   * What else the check needs. `LINKED_PAN` is Aadhaar's: there is no public
   * standalone Aadhaar verification, so the online signal is whether the number
   * is linked to a known PAN. See `AADHAAR_ONLINE_LIMITATION`.
   */
  secondFactor: IdentitySecondFactor;
  /** `false` where no online source exists and the check stops at the checksum. */
  hasOnlineSource: boolean;
  description: string;
}

/**
 * Why Aadhaar is not verified the way the other three are.
 *
 * Full Aadhaar eKYC is only available to entities licensed by UIDAI as an
 * AUA/KUA, and it requires the holder's own OTP consent — it is not something a
 * fleet manager can run against a driver's card. What can be checked without
 * that licence is whether the number is well formed (Verhoeff) and whether it
 * is linked to a given PAN, which the Income Tax Department exposes. So an
 * Aadhaar with a PAN beside it gets a real online answer; one without stops at
 * the checksum and goes to a human reviewer, and says so on screen rather than
 * showing a green tick it has not earned.
 */
export const AADHAAR_ONLINE_LIMITATION =
  'Aadhaar has no public standalone verification — full eKYC needs a UIDAI licence and the ' +
  "holder's own OTP consent. Saarthi validates the number's UIDAI checksum and, when a PAN is " +
  'supplied, confirms the two are linked with the Income Tax Department.';

export const IDENTITY_KINDS: readonly IdentityKindDefinition[] = Object.freeze([
  {
    kind: IdentityDocumentKind.AADHAAR,
    label: 'Aadhaar',
    shortLabel: 'Aadhaar',
    subjectType: VerificationSubjectType.DRIVER,
    ownerType: DocumentOwnerType.DRIVER,
    documentType: 'DRIVER_AADHAAR',
    placeholder: '1234 5678 9012',
    formatHint: '12 digits, as printed on the card.',
    secondFactor: 'LINKED_PAN',
    hasOnlineSource: true,
    description:
      'Aadhaar number of the driver. Only the last four digits are kept on the driver record.',
  },
  {
    /*
     * The account holder's own Aadhaar — a Personal customer verifying
     * themselves, not a fleet verifying somebody it employs.
     *
     * A second entry rather than a widened first one, and the distinction is
     * the point rather than bookkeeping. Driver verification and account-holder
     * verification are different concepts with different requirements: a driver
     * must satisfy Aadhaar, PAN, Voter ID *and* a driving licence before they
     * may be assigned a vehicle, and that set is what `syncDriverVerificationStatus`
     * computes. A Personal account holder is asked for Aadhaar alone, because
     * they are proving who they are rather than that they may drive.
     *
     * Somebody can be both. An owner who ticks "I drive one of my vehicles
     * myself" gets a driver profile alongside their user record, and that
     * profile then carries the driver checks in full — on its own subject, with
     * its own rows. The two never stand in for one another: confirming a
     * Personal holder's Aadhaar does not make them a verified driver, and
     * verifying them as a driver does not silently verify the account.
     *
     * The number rules, the masking and the honest limits on what an Aadhaar
     * check can prove are shared, because those are properties of Aadhaar and
     * not of whose it is. See `AADHAAR_ONLINE_LIMITATION`.
     */
    kind: IdentityDocumentKind.AADHAAR,
    label: 'Aadhaar',
    shortLabel: 'Aadhaar',
    subjectType: VerificationSubjectType.USER,
    ownerType: DocumentOwnerType.USER,
    documentType: 'USER_AADHAAR',
    placeholder: '1234 5678 9012',
    formatHint: '12 digits, as printed on the card.',
    secondFactor: 'LINKED_PAN',
    hasOnlineSource: true,
    description:
      'Your own Aadhaar number. Only the last four digits are kept on your account.',
  },
  {
    kind: IdentityDocumentKind.PAN,
    label: 'PAN card',
    shortLabel: 'PAN',
    subjectType: VerificationSubjectType.DRIVER,
    ownerType: DocumentOwnerType.DRIVER,
    documentType: 'DRIVER_PAN',
    // `P` in the fourth position is the entity-type code for an individual,
    // which is what a driver's own PAN carries.
    placeholder: 'ABCPE1234F',
    formatHint: '10 characters — five letters, four digits, one letter.',
    secondFactor: 'HOLDER_NAME',
    hasOnlineSource: true,
    description: 'Permanent Account Number, verified against Income Tax Department records.',
  },
  {
    kind: IdentityDocumentKind.VOTER_ID,
    label: 'Voter ID (EPIC)',
    shortLabel: 'Voter ID',
    subjectType: VerificationSubjectType.DRIVER,
    ownerType: DocumentOwnerType.DRIVER,
    documentType: 'DRIVER_VOTER_ID',
    placeholder: 'ABC1234567',
    formatHint: 'The EPIC number printed on the card.',
    secondFactor: 'NONE',
    hasOnlineSource: true,
    description: 'Voter ID, verified against Election Commission records. Doubles as address proof.',
  },
  {
    kind: IdentityDocumentKind.GST,
    label: 'GST registration (GSTIN)',
    shortLabel: 'GSTIN',
    subjectType: VerificationSubjectType.ORGANIZATION,
    ownerType: DocumentOwnerType.ORGANIZATION,
    documentType: 'GST_CERTIFICATE',
    placeholder: '27ABCCE1234F1Z2',
    formatHint: '15 characters, starting with the two-digit state code.',
    secondFactor: 'NONE',
    hasOnlineSource: true,
    description:
      'Goods and Services Tax identification number, verified against the GST portal. ' +
      'Returns the registered legal name, trade name and filing status.',
  },
]);

/**
 * The definition for one kind, optionally for one subject.
 *
 * `subjectType` became necessary when Aadhaar stopped belonging to exactly one
 * subject: a driver's and an account holder's are the same document with the
 * same rules but different owners, different document codes and different
 * places to record the result.
 *
 * It is optional so that every existing one-argument call keeps the behaviour
 * it has — the first entry for the kind, which is still the driver's. Those
 * callers want the label, the placeholder, the format hint and the second
 * factor, and all four are properties of Aadhaar rather than of whose it is.
 * The callers that must not guess — the ones resolving a document code, or
 * deciding which checks a subject is asked for — pass the subject.
 */
export function identityKindDefinition(
  kind: IdentityDocumentKind,
  subjectType?: VerificationSubjectType,
): IdentityKindDefinition | undefined {
  return IDENTITY_KINDS.find(
    (definition) =>
      definition.kind === kind &&
      (subjectType === undefined || definition.subjectType === subjectType),
  );
}

/** The identity check a document type unlocks, if any. Drives the Verify button. */
export function identityKindForDocumentType(
  documentType: string,
): IdentityKindDefinition | undefined {
  return IDENTITY_KINDS.find((definition) => definition.documentType === documentType);
}

export function identityKindsForSubject(
  subjectType: VerificationSubjectType,
): IdentityKindDefinition[] {
  return IDENTITY_KINDS.filter((definition) => definition.subjectType === subjectType);
}

// ---------------------------------------------------------------------------
// Validation entry point
// ---------------------------------------------------------------------------

/** Is this number structurally capable of being real, for its kind? */
export function isValidIdentityNumber(kind: IdentityDocumentKind, value: string): boolean {
  switch (kind) {
    case IdentityDocumentKind.AADHAAR:
      return isValidAadhaar(value);
    case IdentityDocumentKind.PAN:
      return isValidPan(value);
    case IdentityDocumentKind.VOTER_ID:
      return isValidVoterId(value);
    case IdentityDocumentKind.GST:
      return isValidGstin(value);
    default:
      return false;
  }
}

/** The message shown when the local check refuses a number. */
export function identityFormatMessage(kind: IdentityDocumentKind): string {
  switch (kind) {
    case IdentityDocumentKind.AADHAAR:
      return 'That is not a valid Aadhaar number. It is 12 digits and carries a check digit — re-read it from the card.';
    case IdentityDocumentKind.PAN:
      return 'That is not a valid PAN. It is 10 characters: five letters, four digits, then one letter.';
    case IdentityDocumentKind.VOTER_ID:
      return 'That is not a valid Voter ID (EPIC) number. Check it against the card.';
    case IdentityDocumentKind.GST:
      return 'That is not a valid GSTIN. It is 15 characters and carries a check digit — re-read it from the certificate.';
    default:
      return 'That number is not valid.';
  }
}

// ---------------------------------------------------------------------------
// Records returned by the provider, normalised
// ---------------------------------------------------------------------------

/**
 * Every record below follows the same two rules as the RC and licence records:
 * every field is nullable and an absent value is `null` rather than a guess,
 * and personal details are grouped so the API can strip the block wholesale for
 * a caller who may not see them.
 */

export interface PanRecord {
  panNumber: string | null;
  /** Name on the PAN. Null for callers without the sensitive permission. */
  holderName: string | null;
  /** Category of holder, e.g. `Individual`. Derived from the fourth character. */
  holderType: string | null;
  /** `VALID`, `INVALID`, `DEACTIVATED`… as reported by the department. */
  panStatus: string | null;
  /** Whether the department reports this PAN linked to an Aadhaar. */
  aadhaarLinked: boolean | null;
  /** The submitted name matched the record. Null when no name was submitted. */
  nameMatch: boolean | null;
  lastUpdatedOn: string | null;
  redacted: boolean;
}

export interface VoterIdRecord {
  epicNumber: string | null;
  holderName: string | null;
  relativeName: string | null;
  relationType: string | null;
  gender: string | null;
  age: number | null;
  state: string | null;
  district: string | null;
  assemblyConstituency: string | null;
  parliamentaryConstituency: string | null;
  pollingStation: string | null;
  partNumber: string | null;
  redacted: boolean;
}

export interface AadhaarRecord {
  /** Never the full number — the masked form is all that leaves the server. */
  maskedNumber: string | null;
  /** The number passed the UIDAI Verhoeff check. */
  checksumValid: boolean;
  /** `true` / `false` from the link check; `null` when no PAN was supplied. */
  linkedToPan: boolean | null;
  /** The PAN the link was checked against, masked. */
  linkedPanMasked: string | null;
  /** Where the online answer came from, or null when there was none. */
  linkCheckSource: string | null;
  redacted: boolean;
}

export interface GstRecord {
  gstin: string | null;
  legalName: string | null;
  tradeName: string | null;
  /** `Active`, `Cancelled`, `Suspended`… as reported by the GST portal. */
  status: string | null;
  /** `Regular`, `Composition`, `Casual Taxable Person`… */
  taxpayerType: string | null;
  constitutionOfBusiness: string | null;
  registrationDate: string | null;
  cancellationDate: string | null;
  state: string | null;
  /** Principal place of business. Grouped with the personal block. */
  principalAddress: string | null;
  natureOfBusiness: string[];
  /** The PAN embedded in the GSTIN, derived locally, not from the provider. */
  embeddedPan: string | null;
  redacted: boolean;
}

export type IdentityRecord = AadhaarRecord | PanRecord | VoterIdRecord | GstRecord;

/** One stored identity check, as the API returns it. */
export interface IdentityVerificationSummary {
  id: string;
  kind: IdentityDocumentKind;
  subjectType: VerificationSubjectType;
  subjectId: string;
  /** The uploaded document this check backs, when it was started from one. */
  documentId: string | null;
  outcome: IdentityVerificationOutcome;
  /** Safe to display: `XXXX XXXX 9012`. The full number never leaves the server. */
  maskedNumber: string;
  /** Name the source holds, when the caller may see it. */
  holderName: string | null;
  /** Why a non-VERIFIED outcome came out that way, in one sentence. */
  reason: string | null;
  /** The normalised record, or null for a check that produced no record. */
  record: IdentityRecord | null;
  /** Served from Saarthi's own store rather than a fresh provider call. */
  cached: boolean;
  provider: string | null;
  providerReference: string | null;
  verifiedAt: string | null;
  checkedAt: string;
  /** When this stored answer stops being reused and a fresh call is billed. */
  expiresAt: string | null;
}

/** Is this outcome a green tick? */
export function isIdentityVerified(outcome: IdentityVerificationOutcome): boolean {
  return outcome === IdentityVerificationOutcome.VERIFIED;
}

/** Badge tone for an outcome, so every surface renders it the same way. */
export function identityOutcomeTone(
  outcome: IdentityVerificationOutcome,
): 'success' | 'warning' | 'destructive' {
  switch (outcome) {
    case IdentityVerificationOutcome.VERIFIED:
      return 'success';
    case IdentityVerificationOutcome.UNCONFIRMED:
      return 'warning';
    default:
      return 'destructive';
  }
}

export function identityOutcomeLabel(outcome: IdentityVerificationOutcome): string {
  switch (outcome) {
    case IdentityVerificationOutcome.VERIFIED:
      return 'Verified';
    case IdentityVerificationOutcome.NOT_FOUND:
      return 'No record found';
    case IdentityVerificationOutcome.MISMATCH:
      return 'Details do not match';
    case IdentityVerificationOutcome.INVALID_FORMAT:
      return 'Invalid number';
    case IdentityVerificationOutcome.UNCONFIRMED:
      return 'Awaiting review';
    default:
      return 'Unknown';
  }
}
