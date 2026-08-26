/**
 * QR field privacy.
 *
 * `qr.ts` decides *which categories* of information a scan may disclose — the
 * scope intersection. This module decides, within a granted category, how much
 * of each individual field the person holding the phone actually sees: the
 * whole value, a masked one, or nothing.
 *
 * Two properties hold no matter how an owner configures their policy:
 *
 *   1. **A policy can never widen disclosure.** The effective answer is the
 *      *narrowest* of the code's scopes, the scanner's relationship ceiling and
 *      the field policy. An owner who marks the driver's phone as public still
 *      does not expose it to a scanner whose relationship never granted CONTACT.
 *   2. **A field absent from the policy falls back to the safest default.**
 *      A policy row that fails to parse, or a field added in a later release,
 *      resolves closed rather than open.
 */

import { MaskStrategy } from './masking';
import { ScannerRelationship } from './qr';
import { QrScope } from './enums';

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * Who is looking, expressed as a privacy tier.
 *
 * Ordered: each profile can see everything the one below it can. The ordering
 * is what makes "minimum profile" a meaningful policy statement.
 */
export const QrPrivacyProfile = {
  /** Anyone who scans the sticker, with no Saarthi account at all. */
  PUBLIC: 'PUBLIC',
  /** Signed in to Saarthi, but unrelated to this vehicle or driver. */
  BASIC_VERIFIED: 'BASIC_VERIFIED',
  /** A counterparty on a live order, trip or relay leg; an incident responder. */
  OPERATIONAL: 'OPERATIONAL',
  /** Somebody inside the fleet that owns the subject. */
  OWNER: 'OWNER',
  /** Saarthi platform staff. */
  ADMIN: 'ADMIN',
} as const;
export type QrPrivacyProfile = (typeof QrPrivacyProfile)[keyof typeof QrPrivacyProfile];

const PROFILE_RANK: Record<QrPrivacyProfile, number> = {
  [QrPrivacyProfile.PUBLIC]: 0,
  [QrPrivacyProfile.BASIC_VERIFIED]: 1,
  [QrPrivacyProfile.OPERATIONAL]: 2,
  [QrPrivacyProfile.OWNER]: 3,
  [QrPrivacyProfile.ADMIN]: 4,
};

export const QR_PRIVACY_PROFILES = Object.values(QrPrivacyProfile) as QrPrivacyProfile[];

export function profileAtLeast(
  profile: QrPrivacyProfile,
  minimum: QrPrivacyProfile,
): boolean {
  return PROFILE_RANK[profile] >= PROFILE_RANK[minimum];
}

/** Map the scanner's established relationship onto a privacy profile. */
export function profileForRelationship(relationship: ScannerRelationship): QrPrivacyProfile {
  switch (relationship) {
    case ScannerRelationship.PLATFORM_STAFF:
      return QrPrivacyProfile.ADMIN;
    case ScannerRelationship.SAME_ORGANIZATION:
      return QrPrivacyProfile.OWNER;
    case ScannerRelationship.TRANSACTING_PARTNER:
    case ScannerRelationship.EMERGENCY_RESPONDER:
    case ScannerRelationship.RELAY_PARTNER:
      return QrPrivacyProfile.OPERATIONAL;
    case ScannerRelationship.SIGNED_IN_STRANGER:
      return QrPrivacyProfile.BASIC_VERIFIED;
    case ScannerRelationship.ANONYMOUS:
    default:
      return QrPrivacyProfile.PUBLIC;
  }
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * Every field a scan can disclose, as a stable key.
 *
 * These strings are persisted in an owner's policy, so they are append-only:
 * renaming one would silently reset that field to its default for every tenant
 * that had configured it.
 */
export const QrField = {
  VEHICLE_REGISTRATION: 'vehicle.registration',
  VEHICLE_MAKE_MODEL: 'vehicle.makeModel',
  VEHICLE_TYPE: 'vehicle.type',
  VEHICLE_STATUS: 'vehicle.status',
  VEHICLE_PHOTO: 'vehicle.photo',

  DRIVER_NAME: 'driver.name',
  DRIVER_PHOTO: 'driver.photo',
  DRIVER_PHONE: 'driver.phone',
  DRIVER_ADDRESS: 'driver.address',
  DRIVER_LICENCE_NUMBER: 'driver.licenceNumber',
  DRIVER_VERIFICATION: 'driver.verification',
  DRIVER_EXPERIENCE: 'driver.experience',
  DRIVER_SCORE_BAND: 'driver.scoreBand',

  DOCUMENT_RC_NUMBER: 'documents.rcNumber',
  DOCUMENT_CHASSIS_NUMBER: 'documents.chassisNumber',
  DOCUMENT_ENGINE_NUMBER: 'documents.engineNumber',
  DOCUMENT_INSURANCE_NUMBER: 'documents.insuranceNumber',
  DOCUMENT_VALIDITY: 'documents.validity',

  FINANCE_LOAN_NUMBER: 'finance.loanNumber',
  FINANCE_EMI: 'finance.emi',
  FINANCE_OUTSTANDING: 'finance.outstanding',
  FINANCE_STATUS: 'finance.status',

  FASTAG_REFERENCE: 'fastag.reference',
  FASTAG_BALANCE: 'fastag.balance',

  SERVICE_HEALTH: 'service.health',
  SERVICE_LAST_DATE: 'service.lastServiceDate',

  EMERGENCY_BLOOD_GROUP: 'emergency.bloodGroup',
  EMERGENCY_CONTACT: 'emergency.contact',
} as const;
export type QrField = (typeof QrField)[keyof typeof QrField];

export const ALL_QR_FIELDS = Object.values(QrField) as QrField[];

/** How a field resolves for a given scanner. */
export const FieldDisclosure = {
  HIDDEN: 'HIDDEN',
  MASKED: 'MASKED',
  FULL: 'FULL',
} as const;
export type FieldDisclosure = (typeof FieldDisclosure)[keyof typeof FieldDisclosure];

export interface QrFieldRule {
  /** Lowest profile that may see the field at all. */
  minProfile: QrPrivacyProfile;
  /** At or below this profile the value is masked rather than shown in full. */
  maskBelow: QrPrivacyProfile;
  /** How to mask it when masked. */
  mask: MaskStrategy;
  /** Whether an owner may loosen this field's rule from its default. */
  configurable: boolean;
  label: string;
  group: 'Vehicle' | 'Driver' | 'Documents' | 'Finance' | 'FASTag' | 'Service' | 'Emergency';
  description: string;
}

/**
 * Default policy.
 *
 * The defaults answer one question per field: *what does a stranger holding
 * this phone actually need?* A registration number is already painted on the
 * vehicle, so hiding it protects nothing. A chassis number is what someone
 * needs to forge paperwork against the vehicle, so it never leaves the fleet.
 * A driver's home address is not disclosed at any profile, by any policy.
 */
export const QR_FIELD_RULES: Record<QrField, QrFieldRule> = {
  [QrField.VEHICLE_REGISTRATION]: {
    minProfile: QrPrivacyProfile.PUBLIC,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.REGISTRATION,
    configurable: true,
    label: 'Registration number',
    group: 'Vehicle',
    description: 'Already painted on the vehicle, so disclosing it protects nothing.',
  },
  [QrField.VEHICLE_MAKE_MODEL]: {
    minProfile: QrPrivacyProfile.PUBLIC,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: true,
    label: 'Make and model',
    group: 'Vehicle',
    description: 'Visible to anyone standing in front of the vehicle.',
  },
  [QrField.VEHICLE_TYPE]: {
    minProfile: QrPrivacyProfile.PUBLIC,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: true,
    label: 'Vehicle type',
    group: 'Vehicle',
    description: 'Body type and capacity.',
  },
  [QrField.VEHICLE_STATUS]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: true,
    label: 'Operational status',
    group: 'Vehicle',
    description: 'Whether the vehicle is on a trip, idle or in the workshop.',
  },
  [QrField.VEHICLE_PHOTO]: {
    minProfile: QrPrivacyProfile.PUBLIC,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: true,
    label: 'Vehicle photo',
    group: 'Vehicle',
    description: 'Helps a scanner confirm they are at the right vehicle.',
  },

  [QrField.DRIVER_NAME]: {
    minProfile: QrPrivacyProfile.PUBLIC,
    // A stranger sees "Ramesh K." — enough to confirm the person in front of
    // them, not enough to look them up.
    maskBelow: QrPrivacyProfile.OPERATIONAL,
    mask: MaskStrategy.NAME,
    configurable: true,
    label: 'Driver name',
    group: 'Driver',
    description: 'Masked to a first name and last initial below operational access.',
  },
  [QrField.DRIVER_PHOTO]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: true,
    label: 'Driver photo',
    group: 'Driver',
    description: 'Shown to counterparties who must confirm who is collecting a load.',
  },
  [QrField.DRIVER_PHONE]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.OWNER,
    mask: MaskStrategy.PHONE,
    configurable: true,
    label: 'Driver phone',
    group: 'Driver',
    description: 'Masked outside the fleet — a full number invites cold calls and worse.',
  },
  [QrField.DRIVER_ADDRESS]: {
    // Never disclosed by a QR scan at any profile. A home address is the one
    // field where a wrong disclosure puts a person, not a business, at risk.
    minProfile: QrPrivacyProfile.ADMIN,
    maskBelow: QrPrivacyProfile.ADMIN,
    mask: MaskStrategy.HIDDEN,
    configurable: false,
    label: 'Driver address',
    group: 'Driver',
    description: 'Never shared through a QR scan, regardless of policy.',
  },
  [QrField.DRIVER_LICENCE_NUMBER]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.OWNER,
    mask: MaskStrategy.LICENCE,
    configurable: true,
    label: 'Licence number',
    group: 'Driver',
    description: 'Masked outside the fleet; a checkpoint sees the verification flag instead.',
  },
  [QrField.DRIVER_VERIFICATION]: {
    minProfile: QrPrivacyProfile.PUBLIC,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: false,
    label: 'Licence verified',
    group: 'Driver',
    description:
      'The whole point of the code: confirming the licence was checked, without disclosing it.',
  },
  [QrField.DRIVER_EXPERIENCE]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: true,
    label: 'Years of experience',
    group: 'Driver',
    description: 'Useful to a customer deciding who is carrying their load.',
  },
  [QrField.DRIVER_SCORE_BAND]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: true,
    label: 'Driving score band',
    group: 'Driver',
    description: 'A band such as "Good" — never the underlying number.',
  },

  [QrField.DOCUMENT_RC_NUMBER]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.OWNER,
    mask: MaskStrategy.LAST_FOUR,
    configurable: true,
    label: 'RC number',
    group: 'Documents',
    description: 'Masked outside the fleet.',
  },
  [QrField.DOCUMENT_CHASSIS_NUMBER]: {
    // A chassis number is what someone needs to raise paperwork against the
    // vehicle. It stays inside the fleet.
    minProfile: QrPrivacyProfile.OWNER,
    maskBelow: QrPrivacyProfile.OWNER,
    mask: MaskStrategy.LAST_FOUR,
    configurable: false,
    label: 'Chassis number',
    group: 'Documents',
    description: 'Never disclosed outside the owning fleet.',
  },
  [QrField.DOCUMENT_ENGINE_NUMBER]: {
    minProfile: QrPrivacyProfile.OWNER,
    maskBelow: QrPrivacyProfile.OWNER,
    mask: MaskStrategy.LAST_FOUR,
    configurable: false,
    label: 'Engine number',
    group: 'Documents',
    description: 'Never disclosed outside the owning fleet.',
  },
  [QrField.DOCUMENT_INSURANCE_NUMBER]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.OWNER,
    mask: MaskStrategy.LAST_FOUR,
    configurable: true,
    label: 'Insurance policy number',
    group: 'Documents',
    description: 'Masked outside the fleet — enough to quote at a claim, not to impersonate.',
  },
  [QrField.DOCUMENT_VALIDITY]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: true,
    label: 'Document validity',
    group: 'Documents',
    description: 'Whether insurance, fitness, permit and PUCC are current. Never the files.',
  },

  [QrField.FINANCE_LOAN_NUMBER]: {
    minProfile: QrPrivacyProfile.OWNER,
    maskBelow: QrPrivacyProfile.OWNER,
    mask: MaskStrategy.REFERENCE,
    configurable: false,
    label: 'Loan number',
    group: 'Finance',
    description: 'Private financial data. Never disclosed by a scan outside the fleet.',
  },
  [QrField.FINANCE_EMI]: {
    minProfile: QrPrivacyProfile.OWNER,
    maskBelow: QrPrivacyProfile.OWNER,
    mask: MaskStrategy.HIDDEN,
    configurable: false,
    label: 'EMI amount',
    group: 'Finance',
    description: 'Private financial data.',
  },
  [QrField.FINANCE_OUTSTANDING]: {
    minProfile: QrPrivacyProfile.OWNER,
    maskBelow: QrPrivacyProfile.OWNER,
    mask: MaskStrategy.HIDDEN,
    configurable: false,
    label: 'Outstanding balance',
    group: 'Finance',
    description: 'Private financial data.',
  },
  [QrField.FINANCE_STATUS]: {
    // "Financed" as a fact — with no numbers — is legitimately useful to a
    // buyer or an inspector, so unlike the amounts this one is offerable.
    minProfile: QrPrivacyProfile.OWNER,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: true,
    label: 'Under finance',
    group: 'Finance',
    description: 'Whether the vehicle is financed, with no amounts attached.',
  },

  [QrField.FASTAG_REFERENCE]: {
    minProfile: QrPrivacyProfile.OWNER,
    maskBelow: QrPrivacyProfile.OWNER,
    mask: MaskStrategy.REFERENCE,
    configurable: false,
    label: 'FASTag reference',
    group: 'FASTag',
    description: 'A payment instrument identifier. Fleet only.',
  },
  [QrField.FASTAG_BALANCE]: {
    minProfile: QrPrivacyProfile.OWNER,
    maskBelow: QrPrivacyProfile.OWNER,
    mask: MaskStrategy.HIDDEN,
    configurable: false,
    label: 'FASTag balance',
    group: 'FASTag',
    description: 'Fleet only.',
  },

  [QrField.SERVICE_HEALTH]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: true,
    label: 'Service health',
    group: 'Service',
    description: 'A rule-based verdict such as "Healthy" or "Service due".',
  },
  [QrField.SERVICE_LAST_DATE]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: true,
    label: 'Last service date',
    group: 'Service',
    description: 'When the vehicle was last serviced.',
  },

  [QrField.EMERGENCY_BLOOD_GROUP]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: false,
    label: 'Blood group',
    group: 'Emergency',
    description: 'Released to responders on an active incident only — see the EMERGENCY scope.',
  },
  [QrField.EMERGENCY_CONTACT]: {
    minProfile: QrPrivacyProfile.OPERATIONAL,
    maskBelow: QrPrivacyProfile.PUBLIC,
    mask: MaskStrategy.NONE,
    configurable: false,
    label: 'Emergency contact',
    group: 'Emergency',
    description: 'Released to responders on an active incident only.',
  },
};

/**
 * An owner's overrides, keyed by field.
 *
 * Only `minProfile` and `maskBelow` are configurable, and only for fields whose
 * rule says so. There is deliberately no way to change the mask *strategy*: an
 * owner choosing to show a phone number as "9876543210" instead of "98******10"
 * is a decision about somebody else's privacy.
 */
export interface QrFieldOverride {
  minProfile?: QrPrivacyProfile;
  maskBelow?: QrPrivacyProfile;
  /** Switch the field off entirely, regardless of profile. */
  disabled?: boolean;
}

export type QrPrivacyOverrides = Partial<Record<QrField, QrFieldOverride>>;

/**
 * Resolve one field for one scanner.
 *
 * `scopeGranted` is the outcome of the scope intersection in `qr.ts` and is
 * authoritative: when it is false the answer is HIDDEN no matter what the
 * policy says. That is the guarantee that a policy can only ever narrow.
 */
export function resolveFieldDisclosure(input: {
  field: QrField;
  profile: QrPrivacyProfile;
  scopeGranted: boolean;
  overrides?: QrPrivacyOverrides | null;
}): FieldDisclosure {
  const rule = QR_FIELD_RULES[input.field];
  if (!rule) return FieldDisclosure.HIDDEN;
  if (!input.scopeGranted) return FieldDisclosure.HIDDEN;

  const override = rule.configurable ? input.overrides?.[input.field] : undefined;
  if (override?.disabled) return FieldDisclosure.HIDDEN;

  const minProfile = override?.minProfile ?? rule.minProfile;
  if (!profileAtLeast(input.profile, minProfile)) return FieldDisclosure.HIDDEN;

  const maskBelow = override?.maskBelow ?? rule.maskBelow;
  if (profileAtLeast(input.profile, maskBelow)) return FieldDisclosure.FULL;

  // A field whose mask hides everything is simply not shown — an empty "••••"
  // row tells the scanner nothing and looks like a bug.
  return rule.mask === MaskStrategy.HIDDEN ? FieldDisclosure.HIDDEN : FieldDisclosure.MASKED;
}

/** The mask a field uses when it resolves to MASKED. */
export function maskStrategyFor(field: QrField): MaskStrategy {
  return QR_FIELD_RULES[field]?.mask ?? MaskStrategy.HIDDEN;
}

/**
 * Validate and normalise an owner-supplied policy.
 *
 * Unknown keys and overrides on non-configurable fields are dropped rather than
 * rejected: a client on an older build must not be able to fail the whole save,
 * and a field it does not know about must not be silently loosened.
 */
export function sanitizeOverrides(input: unknown): QrPrivacyOverrides {
  if (!input || typeof input !== 'object') return {};
  const output: QrPrivacyOverrides = {};

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const field = key as QrField;
    const rule = QR_FIELD_RULES[field];
    if (!rule || !rule.configurable) continue;
    if (!value || typeof value !== 'object') continue;

    const candidate = value as Record<string, unknown>;
    const override: QrFieldOverride = {};

    if (typeof candidate.disabled === 'boolean') override.disabled = candidate.disabled;
    if (
      typeof candidate.minProfile === 'string' &&
      QR_PRIVACY_PROFILES.includes(candidate.minProfile as QrPrivacyProfile)
    ) {
      override.minProfile = candidate.minProfile as QrPrivacyProfile;
    }
    if (
      typeof candidate.maskBelow === 'string' &&
      QR_PRIVACY_PROFILES.includes(candidate.maskBelow as QrPrivacyProfile)
    ) {
      override.maskBelow = candidate.maskBelow as QrPrivacyProfile;
    }

    if (Object.keys(override).length > 0) output[field] = override;
  }

  return output;
}

/** Profile label for the "you are seeing this as…" line on a scan result. */
export function profileLabel(profile: QrPrivacyProfile): string {
  switch (profile) {
    case QrPrivacyProfile.ADMIN:
      return 'Saarthi staff';
    case QrPrivacyProfile.OWNER:
      return 'Fleet member';
    case QrPrivacyProfile.OPERATIONAL:
      return 'Operational partner';
    case QrPrivacyProfile.BASIC_VERIFIED:
      return 'Verified Saarthi account';
    case QrPrivacyProfile.PUBLIC:
    default:
      return 'Public scan';
  }
}

// ---------------------------------------------------------------------------
// Scope → field mapping
// ---------------------------------------------------------------------------

/**
 * Which fields each scope carries.
 *
 * This is the join between the two halves of QR disclosure: `qr.ts` decides
 * which scopes survive, and this table turns that into per-field permission.
 * A field reachable from no scope is unreachable, full stop — which is why
 * `DRIVER_ADDRESS`, `FINANCE_LOAN_NUMBER`, the chassis and engine numbers and
 * the FASTag fields appear nowhere below. They are in the catalogue so the
 * settings screen can show an owner that Saarthi never discloses them.
 */
const SCOPE_FIELDS: Partial<Record<QrScope, QrField[]>> = {
  [QrScope.IDENTITY]: [
    QrField.VEHICLE_REGISTRATION,
    QrField.VEHICLE_PHOTO,
    QrField.DRIVER_NAME,
    QrField.DRIVER_PHOTO,
    QrField.DRIVER_VERIFICATION,
  ],
  [QrScope.CONTACT]: [QrField.DRIVER_PHONE],
  [QrScope.VEHICLE_SUMMARY]: [
    QrField.VEHICLE_MAKE_MODEL,
    QrField.VEHICLE_TYPE,
    QrField.VEHICLE_STATUS,
    QrField.SERVICE_HEALTH,
    QrField.SERVICE_LAST_DATE,
    QrField.FINANCE_STATUS,
  ],
  [QrScope.DRIVER_SUMMARY]: [
    QrField.DRIVER_EXPERIENCE,
    QrField.DRIVER_SCORE_BAND,
    QrField.DRIVER_LICENCE_NUMBER,
  ],
  [QrScope.COMPLIANCE]: [
    QrField.DOCUMENT_VALIDITY,
    QrField.DOCUMENT_RC_NUMBER,
    QrField.DOCUMENT_INSURANCE_NUMBER,
  ],
  [QrScope.ASSIGNMENT]: [QrField.DRIVER_NAME, QrField.VEHICLE_REGISTRATION],
  [QrScope.EMERGENCY]: [QrField.EMERGENCY_BLOOD_GROUP, QrField.EMERGENCY_CONTACT],
};

/** Turn granted scopes into per-field flags for `resolveFieldDisclosure`. */
export function scopeFieldFlags(
  granted: readonly QrScope[],
): Partial<Record<QrField, boolean>> {
  const flags: Partial<Record<QrField, boolean>> = {};
  for (const scope of granted) {
    for (const field of SCOPE_FIELDS[scope] ?? []) flags[field] = true;
  }
  return flags;
}

/** Fields Saarthi never discloses through a scan, whatever the policy says. */
export function neverDisclosedFields(): QrField[] {
  const reachable = new Set<QrField>();
  for (const fields of Object.values(SCOPE_FIELDS)) {
    for (const field of fields ?? []) reachable.add(field);
  }
  return ALL_QR_FIELDS.filter((field) => !reachable.has(field));
}
