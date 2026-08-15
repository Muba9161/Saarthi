/**
 * Document type catalogue and expiry engine.
 *
 * Document types are configuration, not hard-coded UI strings: each entry knows
 * which owner it attaches to, whether it is mandatory for verification and
 * whether an expiry date is required.
 */

import { DocumentOwnerType, DocumentValidity, DocumentVerificationStatus } from './enums';

export interface DocumentTypeDefinition {
  code: string;
  label: string;
  ownerType: DocumentOwnerType;
  /** Required before the subject can reach VERIFIED. */
  mandatory: boolean;
  /** An expiry date must be supplied at upload time. */
  requiresExpiry: boolean;
  description: string;
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
  {
    code: 'TRUCK_PHOTO',
    label: 'Vehicle photograph',
    ownerType: DocumentOwnerType.TRUCK,
    mandatory: false,
    requiresExpiry: false,
    description: 'Photograph of the vehicle for identification.',
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

export const DOCUMENT_TYPE_CODES = DOCUMENT_TYPES.map((definition) => definition.code);

export function documentTypesFor(ownerType: DocumentOwnerType): DocumentTypeDefinition[] {
  return DOCUMENT_TYPES.filter((definition) => definition.ownerType === ownerType);
}

export function documentTypeDefinition(code: string): DocumentTypeDefinition | undefined {
  return DOCUMENT_TYPES.find((definition) => definition.code === code);
}

export function mandatoryDocumentTypes(ownerType: DocumentOwnerType): DocumentTypeDefinition[] {
  return documentTypesFor(ownerType).filter((definition) => definition.mandatory);
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
