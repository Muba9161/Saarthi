/**
 * Document type catalogue and expiry engine.
 *
 * Document types are configuration, not hard-coded UI strings: each entry knows
 * which owner it attaches to, whether it is mandatory for verification and
 * whether an expiry date is required.
 */

import {
  DocumentOwnerType,
  DocumentValidity,
  DocumentVerificationStatus,
  IdentityDocumentKind,
} from './enums';

export interface DocumentTypeDefinition {
  code: string;
  label: string;
  ownerType: DocumentOwnerType;
  /** Required before the subject can reach VERIFIED. */
  mandatory: boolean;
  /** An expiry date must be supplied at upload time. */
  requiresExpiry: boolean;
  description: string;
  /**
   * The instant identity check this document unlocks, when there is one.
   *
   * Set on the four documents whose *number* can be checked against a
   * government source — Aadhaar, PAN, Voter ID and the GST certificate. It is
   * what puts a "Verify" button beside the row instead of leaving the upload to
   * wait for a human reviewer, and it is why `documentNumber` is prompted for
   * (and required) on these types alone.
   */
  verifiableAs?: IdentityDocumentKind;
}

export const DOCUMENT_TYPES: DocumentTypeDefinition[] = [
  // --- Driver ---
  {
    code: 'DRIVING_LICENCE',
    label: 'Driving licence',
    ownerType: DocumentOwnerType.DRIVER,
    mandatory: true,
    requiresExpiry: true,
    description: 'Valid commercial driving licence for the vehicle class being driven.',
  },
  {
    code: 'DRIVER_IDENTITY_PROOF',
    label: 'Identity proof',
    ownerType: DocumentOwnerType.DRIVER,
    mandatory: true,
    requiresExpiry: false,
    description: 'Government-issued identity proof. Store the minimum data required.',
  },
  {
    code: 'DRIVER_ADDRESS_PROOF',
    label: 'Address proof',
    ownerType: DocumentOwnerType.DRIVER,
    mandatory: false,
    requiresExpiry: false,
    description: 'Proof of current residential address.',
  },
  {
    code: 'DRIVER_AADHAAR',
    label: 'Aadhaar card',
    ownerType: DocumentOwnerType.DRIVER,
    // Not mandatory: the catalogue already requires one generic identity proof,
    // and demanding all three of Aadhaar, PAN and Voter ID would block a driver
    // who legitimately holds only one of them. Uploading any of the three
    // satisfies the identity-proof requirement and can then be verified
    // instantly, which is the point.
    mandatory: false,
    requiresExpiry: false,
    verifiableAs: IdentityDocumentKind.AADHAAR,
    description:
      'Aadhaar card. The number is checked against its UIDAI checksum; only the last four digits are retained.',
  },
  {
    code: 'DRIVER_PAN',
    label: 'PAN card',
    ownerType: DocumentOwnerType.DRIVER,
    mandatory: false,
    requiresExpiry: false,
    verifiableAs: IdentityDocumentKind.PAN,
    description: 'PAN card, verified in real time against Income Tax Department records.',
  },
  {
    code: 'DRIVER_VOTER_ID',
    label: 'Voter ID (EPIC)',
    ownerType: DocumentOwnerType.DRIVER,
    mandatory: false,
    requiresExpiry: false,
    verifiableAs: IdentityDocumentKind.VOTER_ID,
    description:
      'Voter ID card, verified against Election Commission records. Also serves as address proof.',
  },
  {
    code: 'DRIVER_PHOTO',
    label: 'Profile photograph',
    ownerType: DocumentOwnerType.DRIVER,
    mandatory: false,
    requiresExpiry: false,
    description: 'Recent photograph used on the driver profile.',
  },
  {
    code: 'DRIVER_MEDICAL_CERTIFICATE',
    label: 'Medical certificate',
    ownerType: DocumentOwnerType.DRIVER,
    mandatory: false,
    requiresExpiry: true,
    description: 'Fitness-to-drive medical certificate.',
  },
  {
    code: 'DRIVER_POLICE_VERIFICATION',
    label: 'Police verification',
    ownerType: DocumentOwnerType.DRIVER,
    mandatory: false,
    requiresExpiry: true,
    description: 'Background verification certificate.',
  },

  // --- Truck ---
  {
    code: 'REGISTRATION_CERTIFICATE',
    label: 'Registration certificate (RC)',
    ownerType: DocumentOwnerType.TRUCK,
    mandatory: true,
    requiresExpiry: true,
    description: 'Vehicle registration certificate.',
  },
  {
    code: 'INSURANCE',
    label: 'Insurance',
    ownerType: DocumentOwnerType.TRUCK,
    mandatory: true,
    requiresExpiry: true,
    description: 'Motor insurance policy covering the vehicle.',
  },
  {
    code: 'FITNESS_CERTIFICATE',
    label: 'Fitness certificate',
    ownerType: DocumentOwnerType.TRUCK,
    mandatory: true,
    requiresExpiry: true,
    description: 'Vehicle fitness certificate.',
  },
  {
    code: 'PERMIT',
    label: 'Permit',
    ownerType: DocumentOwnerType.TRUCK,
    mandatory: true,
    requiresExpiry: true,
    description: 'National / state goods carriage permit.',
  },
  {
    code: 'POLLUTION_CERTIFICATE',
    label: 'Pollution certificate (PUC)',
    ownerType: DocumentOwnerType.TRUCK,
    mandatory: true,
    requiresExpiry: true,
    description: 'Pollution under control certificate.',
  },
  {
    code: 'ROAD_TAX',
    label: 'Road tax receipt',
    ownerType: DocumentOwnerType.TRUCK,
    mandatory: false,
    requiresExpiry: true,
    description: 'Proof of road tax payment.',
  },

  // --- Organization (owner / supplier / customer business) ---
  {
    code: 'BUSINESS_REGISTRATION',
    label: 'Business registration',
    ownerType: DocumentOwnerType.ORGANIZATION,
    mandatory: true,
    requiresExpiry: false,
    description: 'Certificate of incorporation or business registration.',
  },
  {
    code: 'TAX_REGISTRATION',
    label: 'Tax registration',
    ownerType: DocumentOwnerType.ORGANIZATION,
    mandatory: false,
    requiresExpiry: false,
    description: 'Tax registration certificate where applicable.',
  },
  {
    code: 'GST_CERTIFICATE',
    label: 'GST registration certificate',
    ownerType: DocumentOwnerType.ORGANIZATION,
    // Optional for the same reason as the driver identity documents above: a
    // small operator below the GST threshold has no GSTIN to give, and refusing
    // to verify them at all would be wrong. A business that *has* one gets an
    // instant, authoritative check on it.
    mandatory: false,
    requiresExpiry: false,
    verifiableAs: IdentityDocumentKind.GST,
    description:
      'GST registration certificate. The GSTIN is verified against the GST portal, which returns ' +
      'the registered legal name, trade name and filing status.',
  },
  {
    code: 'ORGANIZATION_ADDRESS_PROOF',
    label: 'Business address proof',
    ownerType: DocumentOwnerType.ORGANIZATION,
    mandatory: false,
    requiresExpiry: false,
    description: 'Proof of the registered business address.',
  },
  {
    code: 'BANK_PROOF',
    label: 'Bank account proof',
    ownerType: DocumentOwnerType.ORGANIZATION,
    mandatory: false,
    requiresExpiry: false,
    description: 'Cancelled cheque or bank statement for settlement.',
  },

  // --- User ---
  {
    code: 'USER_IDENTITY_PROOF',
    label: 'Identity proof',
    ownerType: DocumentOwnerType.USER,
    mandatory: true,
    requiresExpiry: false,
    description: 'Government-issued identity proof for the account holder.',
  },
  {
    /*
     * The account holder's own Aadhaar.
     *
     * Distinct from `DRIVER_AADHAAR`, which hangs off a driver profile and
     * counts towards the four checks that decide whether somebody may be
     * assigned a vehicle. This one hangs off the person's user record and
     * answers a different question: who holds this account.
     *
     * Not mandatory here, because `USER_IDENTITY_PROOF` above already requires
     * one identity document and an account holder may reasonably prove
     * themselves with a different one. What Aadhaar adds is that it can be
     * checked rather than only filed — see `verifiableAs`.
     */
    code: 'USER_AADHAAR',
    label: 'Aadhaar card',
    ownerType: DocumentOwnerType.USER,
    mandatory: false,
    requiresExpiry: false,
    verifiableAs: IdentityDocumentKind.AADHAAR,
    description:
      'Your Aadhaar card. The number is checked against its UIDAI checksum; only the last four digits are retained.',
  },

  // --- Order / Trip ---
  {
    code: 'INVOICE',
    label: 'Invoice',
    ownerType: DocumentOwnerType.ORDER,
    mandatory: false,
    requiresExpiry: false,
    description: 'Commercial invoice for the order.',
  },
  {
    code: 'E_WAY_BILL',
    label: 'E-way bill',
    ownerType: DocumentOwnerType.ORDER,
    mandatory: false,
    requiresExpiry: true,
    description: 'Goods movement document where applicable.',
  },
  {
    code: 'DELIVERY_PROOF',
    label: 'Proof of delivery',
    ownerType: DocumentOwnerType.TRIP,
    mandatory: false,
    requiresExpiry: false,
    description: 'Signed delivery challan or photograph captured at unloading.',
  },
  {
    code: 'LOADING_SLIP',
    label: 'Loading slip',
    ownerType: DocumentOwnerType.TRIP,
    mandatory: false,
    requiresExpiry: false,
    description: 'Weighbridge or loading slip captured at origin.',
  },
];

/**
 * Types that are no longer offered, kept only so rows already in the database
 * still resolve to a label.
 *
 * `TRUCK_PHOTO` is the one entry. A photograph of a vehicle is not paperwork:
 * it carries no number, no expiry and nothing an authority or a reviewer could
 * confirm, so filing it here put every vehicle picture into a verification
 * queue it could never meaningfully leave, and showed it as a file name with a
 * download button rather than as the picture it is. Vehicle photographs now
 * live in the media library under the `VEHICLE_EXTERIOR` purpose, where they
 * are previewed, replaced and deleted without a review step.
 *
 * Retired rather than deleted outright: documents uploaded before the move are
 * still read, labelled and downloaded exactly as they were. What changes is
 * that the type can no longer be chosen for a new upload — it is absent from
 * `DOCUMENT_TYPES`, so it is absent from the picker and from
 * `DOCUMENT_TYPE_CODES`, which is what the upload schema validates against.
 */
export const RETIRED_DOCUMENT_TYPES: DocumentTypeDefinition[] = [
  {
    code: 'TRUCK_PHOTO',
    label: 'Vehicle photograph',
    ownerType: DocumentOwnerType.TRUCK,
    mandatory: false,
    requiresExpiry: false,
    description: 'Kept with the vehicle’s photos rather than its documents.',
  },
];

export const DOCUMENT_TYPE_CODES = DOCUMENT_TYPES.map((definition) => definition.code);

export function documentTypesFor(ownerType: DocumentOwnerType): DocumentTypeDefinition[] {
  return DOCUMENT_TYPES.filter((definition) => definition.ownerType === ownerType);
}

/**
 * The definition for a code, including retired ones.
 *
 * Retired types are searched second and only as a fallback, so a stored
 * document keeps its label and its owner rule while nothing that builds a
 * choice — the upload picker, the mandatory list — can reach them.
 */
export function documentTypeDefinition(code: string): DocumentTypeDefinition | undefined {
  return (
    DOCUMENT_TYPES.find((definition) => definition.code === code) ??
    RETIRED_DOCUMENT_TYPES.find((definition) => definition.code === code)
  );
}

/** `true` when the code exists only for records uploaded before it was retired. */
export function isRetiredDocumentType(code: string): boolean {
  return RETIRED_DOCUMENT_TYPES.some((definition) => definition.code === code);
}

export function mandatoryDocumentTypes(ownerType: DocumentOwnerType): DocumentTypeDefinition[] {
  return documentTypesFor(ownerType).filter((definition) => definition.mandatory);
}

/**
 * Document types whose number can be checked against a government source.
 *
 * The UI reads this to decide whether a row gets a "Verify" button and whether
 * the upload form should insist on a document number — a scan of an Aadhaar
 * card with no number typed in cannot be verified, only looked at.
 */
export function verifiableDocumentTypes(
  ownerType?: DocumentOwnerType,
): DocumentTypeDefinition[] {
  const source = ownerType ? documentTypesFor(ownerType) : DOCUMENT_TYPES;
  return source.filter((definition) => definition.verifiableAs !== undefined);
}

/** `true` when this document type carries an instant identity check. */
export function isVerifiableDocumentType(code: string): boolean {
  return documentTypeDefinition(code)?.verifiableAs !== undefined;
}

// ---------------------------------------------------------------------------
// Expiry engine
// ---------------------------------------------------------------------------

/** Alert windows, in days, evaluated from soonest to latest. */
export const EXPIRY_ALERT_WINDOWS = [7, 15, 30] as const;
export const DEFAULT_EXPIRING_SOON_DAYS = 30;

export interface DocumentValidityInput {
  expiryDate: Date | string | null | undefined;
  verificationStatus: DocumentVerificationStatus;
}

export function daysUntil(date: Date | string, now: Date = new Date()): number {
  const target = typeof date === 'string' ? new Date(date) : date;
  const startOfTarget = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
  const startOfNow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((startOfTarget - startOfNow) / 86_400_000);
}

/**
 * Derive the dashboard-facing validity of a document.
 * Rejected/pending review always take precedence over expiry maths.
 */
export function resolveDocumentValidity(
  input: DocumentValidityInput,
  options: { expiringSoonDays?: number; now?: Date } = {},
): { validity: DocumentValidity; daysRemaining: number | null } {
  const { expiringSoonDays = DEFAULT_EXPIRING_SOON_DAYS, now = new Date() } = options;

  if (input.verificationStatus === DocumentVerificationStatus.REJECTED) {
    return { validity: DocumentValidity.REJECTED, daysRemaining: null };
  }

  const remaining = input.expiryDate ? daysUntil(input.expiryDate, now) : null;

  if (remaining !== null && remaining < 0) {
    return { validity: DocumentValidity.EXPIRED, daysRemaining: remaining };
  }

  if (
    input.verificationStatus === DocumentVerificationStatus.PENDING_VERIFICATION ||
    input.verificationStatus === DocumentVerificationStatus.UNDER_REVIEW
  ) {
    return { validity: DocumentValidity.PENDING_VERIFICATION, daysRemaining: remaining };
  }

  if (remaining === null) {
    return { validity: DocumentValidity.NO_EXPIRY, daysRemaining: null };
  }

  if (remaining <= expiringSoonDays) {
    return { validity: DocumentValidity.EXPIRING_SOON, daysRemaining: remaining };
  }

  return { validity: DocumentValidity.VALID, daysRemaining: remaining };
}

/** Validity states that block a subject from being considered compliant. */
export const BLOCKING_DOCUMENT_VALIDITIES: DocumentValidity[] = [
  DocumentValidity.EXPIRED,
  DocumentValidity.REJECTED,
];
