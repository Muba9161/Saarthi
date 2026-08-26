import {
  FieldDisclosure,
  QR_FIELD_RULES,
  QrField,
  QrPrivacyProfile,
  applyMask,
  maskStrategyFor,
  profileForRelationship,
  profileLabel,
  resolveFieldDisclosure,
  sanitizeOverrides,
  type QrPrivacyOverrides,
  type ScannerRelationship,
  type UpdateQrPrivacyPolicyInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { cache } from '../../infra/cache';
import { logger } from '../../lib/logger';
import { AuditAction, recordAudit } from '../audit/audit.service';
import type { AuthContext } from '../../auth/context';

/**
 * QR field privacy, applied server-side.
 *
 * The scan pipeline builds the payload the *scopes* allow, and then this module
 * removes or masks individual values inside it. Doing it here, after assembly,
 * has one important property: a field added to a payload block in the future is
 * covered by the policy the moment it is registered in the field catalogue —
 * there is no second place to remember to check.
 *
 * Nothing here can widen disclosure. `resolveFieldDisclosure` is passed whether
 * the scope was granted at all, and a `false` there is final.
 */

const privacyLogger = logger.child({ module: 'qr:privacy' });

const POLICY_TTL_SECONDS = 120;

function policyCacheKey(organizationId: string): string {
  return `saarthi:${config.env}:qr:${organizationId}:privacy-policy`;
}

export interface ResolvedQrPolicy {
  overrides: QrPrivacyOverrides;
  allowPublicScans: boolean;
}

const DEFAULT_POLICY: ResolvedQrPolicy = { overrides: {}, allowPublicScans: true };

/**
 * The tenant's policy, or the safe default when they have never set one.
 *
 * Cached briefly: a scan at a gate should not wait on a policy read, and two
 * minutes is short enough that tightening a policy takes effect while the owner
 * is still looking at the screen.
 */
export async function getPrivacyPolicy(
  organizationId: string | null,
): Promise<ResolvedQrPolicy> {
  if (!organizationId) return DEFAULT_POLICY;

  const key = policyCacheKey(organizationId);
  const hit = await cache.get<ResolvedQrPolicy>(key);
  if (hit) return hit;

  const row = await prisma.qrPrivacyPolicy.findUnique({ where: { organizationId } });
  const policy: ResolvedQrPolicy = row
    ? {
        overrides: sanitizeOverrides(row.overrides),
        allowPublicScans: row.allowPublicScans,
      }
    : DEFAULT_POLICY;

  await cache.set(key, policy, POLICY_TTL_SECONDS);
  return policy;
}

export async function updatePrivacyPolicy(
  auth: AuthContext,
  organizationId: string,
  input: UpdateQrPrivacyPolicyInput,
): Promise<ResolvedQrPolicy> {
  const existing = await prisma.qrPrivacyPolicy.findUnique({ where: { organizationId } });

  // Sanitize before persisting, never on read: a stored policy must not be able
  // to grant something a later release decides is non-configurable.
  const overrides =
    input.overrides !== undefined
      ? sanitizeOverrides(input.overrides)
      : sanitizeOverrides(existing?.overrides);

  const allowPublicScans = input.allowPublicScans ?? existing?.allowPublicScans ?? true;

  const row = await prisma.qrPrivacyPolicy.upsert({
    where: { organizationId },
    create: {
      organizationId,
      overrides: overrides as never,
      allowPublicScans,
      updatedById: auth.user.id,
    },
    update: {
      overrides: overrides as never,
      allowPublicScans,
      updatedById: auth.user.id,
    },
  });

  await cache.delete(policyCacheKey(organizationId));

  await recordAudit({
    action: AuditAction.QR_PRIVACY_POLICY_UPDATED,
    entityType: 'QrPrivacyPolicy',
    entityId: row.id,
    actorUserId: auth.user.id,
    organizationId,
    before: existing
      ? { overrides: existing.overrides, allowPublicScans: existing.allowPublicScans }
      : undefined,
    after: { overrides, allowPublicScans },
  });

  privacyLogger.info(
    { organizationId, fields: Object.keys(overrides).length, allowPublicScans },
    'QR privacy policy updated',
  );

  return { overrides, allowPublicScans };
}

/**
 * The field catalogue as the settings screen needs it: every field, its default
 * rule, whether it may be changed, and the tenant's current override.
 */
export function describePolicy(policy: ResolvedQrPolicy) {
  return {
    allowPublicScans: policy.allowPublicScans,
    fields: Object.entries(QR_FIELD_RULES).map(([field, rule]) => ({
      field: field as QrField,
      label: rule.label,
      group: rule.group,
      description: rule.description,
      configurable: rule.configurable,
      defaultMinProfile: rule.minProfile,
      defaultMaskBelow: rule.maskBelow,
      maskStrategy: rule.mask,
      override: policy.overrides[field as QrField] ?? null,
      effectiveMinProfile:
        policy.overrides[field as QrField]?.minProfile ?? rule.minProfile,
      effectiveMaskBelow: policy.overrides[field as QrField]?.maskBelow ?? rule.maskBelow,
      disabled: policy.overrides[field as QrField]?.disabled ?? false,
    })),
    profiles: Object.values(QrPrivacyProfile).map((profile) => ({
      profile,
      label: profileLabel(profile),
    })),
  };
}

// ---------------------------------------------------------------------------
// Applying the policy to a resolved scan
// ---------------------------------------------------------------------------

/** What the scanner is told about their own access level. */
export interface ScanPrivacyReport {
  profile: QrPrivacyProfile;
  profileLabel: string;
  /** Fields shown, but not in full. */
  maskedFields: QrField[];
  /** Fields withheld entirely that this subject actually has data for. */
  hiddenFields: QrField[];
}

/**
 * A minimal structural view of the scan payload.
 *
 * Typed loosely on purpose: this module's job is to walk known field paths, not
 * to own the payload's shape. Coupling it to the full `ResolvedScan` interface
 * would mean every payload change had to be mirrored here even when no field in
 * the catalogue moved.
 */
interface MutableScanPayload {
  identity: {
    displayName: string;
    secondaryLabel: string | null;
    imageUrl: string | null;
    verified: boolean;
    organizationName: string | null;
  };
  contact?: { phone: string | null };
  vehicle?: {
    registrationNumber: string;
    vehicleType: string;
    truckType: string;
    capacityTons: number;
    manufacturer: string | null;
    model: string | null;
    year: number | null;
    status: string;
  };
  driver?: {
    experienceYears: number;
    licenseClass: string | null;
    scoreBand: string | null;
    totalTrips: number;
  };
  compliance?: unknown;
  assignment?: { driverName: string | null; vehicleRegistration: string | null };
  emergency?: {
    bloodGroup: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
  service?: { health: string; lastServiceDate: string | null };
  finance?: { financed: boolean };
  privacy?: ScanPrivacyReport;
}

export interface ApplyPrivacyInput {
  subjectType: 'DRIVER' | 'VEHICLE' | string;
  relationship: ScannerRelationship;
  policy: ResolvedQrPolicy;
  /** Which scopes actually survived the intersection, as field-level flags. */
  scopeFlags: Partial<Record<QrField, boolean>>;
}

/**
 * Mask and strip a resolved payload in place, and report what was affected.
 *
 * Returns the same object for convenience. Mutating rather than copying is
 * deliberate: a copy would risk a caller holding the pre-masked original, and
 * this object is on its way out of the process.
 */
export function applyPrivacyPolicy<T extends MutableScanPayload>(
  payload: T,
  input: ApplyPrivacyInput,
): T {
  const profile = profileForRelationship(input.relationship);
  const masked: QrField[] = [];
  const hidden: QrField[] = [];

  const decide = (field: QrField): FieldDisclosure => {
    const decision = resolveFieldDisclosure({
      field,
      profile,
      scopeGranted: input.scopeFlags[field] ?? false,
      overrides: input.policy.overrides,
    });
    return decision;
  };

  /**
   * Apply one field to one string value.
   *
   * Returns `undefined` when the field must disappear entirely, which callers
   * translate into deleting the key rather than sending `null` — a `null` on a
   * driver's phone reads as "this driver has no phone".
   */
  const stringField = (
    field: QrField,
    value: string | null | undefined,
  ): { keep: boolean; value: string | null } => {
    if (value === null || value === undefined || value === '') {
      return { keep: true, value: null };
    }
    const decision = decide(field);
    if (decision === FieldDisclosure.HIDDEN) {
      hidden.push(field);
      return { keep: false, value: null };
    }
    if (decision === FieldDisclosure.MASKED) {
      masked.push(field);
      return { keep: true, value: applyMask(value, maskStrategyFor(field)) };
    }
    return { keep: true, value };
  };

  const blockVisible = (field: QrField): boolean => {
    const decision = decide(field);
    if (decision === FieldDisclosure.HIDDEN) {
      hidden.push(field);
      return false;
    }
    return true;
  };

  const isDriver = input.subjectType === 'DRIVER';
  const isVehicle = input.subjectType === 'VEHICLE';

  // --- Identity ------------------------------------------------------------
  if (isDriver) {
    const name = stringField(QrField.DRIVER_NAME, payload.identity.displayName);
    // An identity block with no name at all is useless, so a hidden name falls
    // back to the generic label rather than an empty string.
    payload.identity.displayName = name.keep && name.value ? name.value : 'Saarthi driver';

    const photo = stringField(QrField.DRIVER_PHOTO, payload.identity.imageUrl);
    payload.identity.imageUrl = photo.keep ? photo.value : null;
  }

  if (isVehicle) {
    const registration = stringField(QrField.VEHICLE_REGISTRATION, payload.identity.displayName);
    payload.identity.displayName =
      registration.keep && registration.value ? registration.value : 'Saarthi vehicle';

    const photo = stringField(QrField.VEHICLE_PHOTO, payload.identity.imageUrl);
    payload.identity.imageUrl = photo.keep ? photo.value : null;
  }

  // --- Contact -------------------------------------------------------------
  if (payload.contact) {
    const phone = stringField(QrField.DRIVER_PHONE, payload.contact.phone);
    if (!phone.keep) delete payload.contact;
    else payload.contact.phone = phone.value;
  }

  // --- Vehicle block -------------------------------------------------------
  if (payload.vehicle) {
    const registration = stringField(QrField.VEHICLE_REGISTRATION, payload.vehicle.registrationNumber);
    if (registration.keep && registration.value) {
      payload.vehicle.registrationNumber = registration.value;
    }

    if (!blockVisible(QrField.VEHICLE_MAKE_MODEL)) {
      payload.vehicle.manufacturer = null;
      payload.vehicle.model = null;
      payload.vehicle.year = null;
    }
    if (!blockVisible(QrField.VEHICLE_STATUS)) {
      payload.vehicle.status = 'UNDISCLOSED';
    }
    if (!blockVisible(QrField.VEHICLE_TYPE)) {
      payload.vehicle.capacityTons = 0;
    }
  }

  // --- Driver summary ------------------------------------------------------
  if (payload.driver) {
    if (!blockVisible(QrField.DRIVER_SCORE_BAND)) payload.driver.scoreBand = null;
    if (!blockVisible(QrField.DRIVER_EXPERIENCE)) payload.driver.experienceYears = 0;

    const licence = stringField(QrField.DRIVER_LICENCE_NUMBER, payload.driver.licenseClass);
    payload.driver.licenseClass = licence.keep ? licence.value : null;
  }

  // --- Assignment ----------------------------------------------------------
  if (payload.assignment) {
    const driverName = stringField(QrField.DRIVER_NAME, payload.assignment.driverName);
    payload.assignment.driverName = driverName.keep ? driverName.value : null;

    const registration = stringField(
      QrField.VEHICLE_REGISTRATION,
      payload.assignment.vehicleRegistration,
    );
    payload.assignment.vehicleRegistration = registration.keep ? registration.value : null;
  }

  // --- Compliance, service, finance ---------------------------------------
  if (payload.compliance && !blockVisible(QrField.DOCUMENT_VALIDITY)) {
    delete payload.compliance;
  }

  if (payload.service) {
    if (!blockVisible(QrField.SERVICE_HEALTH)) {
      delete payload.service;
    } else if (!blockVisible(QrField.SERVICE_LAST_DATE)) {
      payload.service.lastServiceDate = null;
    }
  }

  if (payload.finance && !blockVisible(QrField.FINANCE_STATUS)) {
    delete payload.finance;
  }

  // --- Emergency -----------------------------------------------------------
  if (payload.emergency) {
    if (!blockVisible(QrField.EMERGENCY_BLOOD_GROUP)) payload.emergency.bloodGroup = null;
    if (!blockVisible(QrField.EMERGENCY_CONTACT)) {
      payload.emergency.emergencyContactName = null;
      payload.emergency.emergencyContactPhone = null;
    }
  }

  payload.privacy = {
    profile,
    profileLabel: profileLabel(profile),
    maskedFields: [...new Set(masked)],
    hiddenFields: [...new Set(hidden)],
  };

  return payload;
}
