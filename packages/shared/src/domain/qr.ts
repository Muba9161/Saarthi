/**
 * QR identity scoping.
 *
 * A Saarthi QR code is a capability token, not a printed database id. The code
 * carries an opaque random string; every scan is resolved server-side and the
 * disclosed fields are the *intersection* of two things:
 *
 *   1. what the code was issued to disclose (its scopes), and
 *   2. what the scanner is entitled to see (their relationship to the subject).
 *
 * Printing a sticker therefore can never widen disclosure, and revoking a code
 * closes it everywhere at once. This module is the second half of that rule.
 */

import { QrScope, QrSubjectType } from './enums';

/** How the scanner relates to the scanned subject. */
export const ScannerRelationship = {
  /** Same tenant as the subject. */
  SAME_ORGANIZATION: 'SAME_ORGANIZATION',
  /** Saarthi staff — support or platform admin. */
  PLATFORM_STAFF: 'PLATFORM_STAFF',
  /** A counterparty on a live order/trip with the subject. */
  TRANSACTING_PARTNER: 'TRANSACTING_PARTNER',
  /** A responder on an active SOS incident involving the subject. */
  EMERGENCY_RESPONDER: 'EMERGENCY_RESPONDER',
  /** The assigned last-mile partner on the relevant relay leg. */
  RELAY_PARTNER: 'RELAY_PARTNER',
  /** Signed in, but no relationship to this subject. */
  SIGNED_IN_STRANGER: 'SIGNED_IN_STRANGER',
  /** No session at all. */
  ANONYMOUS: 'ANONYMOUS',
} as const;
export type ScannerRelationship =
  (typeof ScannerRelationship)[keyof typeof ScannerRelationship];

/**
 * Scopes a relationship may ever see, before intersecting with the code.
 *
 * Read this table as the privacy policy in code form. Note what a stranger
 * gets: identity only — enough to confirm the person or vehicle in front of them
 * is a real, verified Saarthi subject, and nothing more.
 */
const RELATIONSHIP_CEILING: Record<ScannerRelationship, QrScope[]> = {
  [ScannerRelationship.SAME_ORGANIZATION]: [
    QrScope.IDENTITY,
    QrScope.CONTACT,
    QrScope.VEHICLE_SUMMARY,
    QrScope.DRIVER_SUMMARY,
    QrScope.COMPLIANCE,
    QrScope.ASSIGNMENT,
    QrScope.TRIP_STATUS,
    QrScope.ORDER_STATUS,
    QrScope.EMERGENCY,
    QrScope.HANDOVER,
  ],

  [ScannerRelationship.PLATFORM_STAFF]: [
    QrScope.IDENTITY,
    QrScope.CONTACT,
    QrScope.VEHICLE_SUMMARY,
    QrScope.DRIVER_SUMMARY,
    QrScope.COMPLIANCE,
    QrScope.ASSIGNMENT,
    QrScope.TRIP_STATUS,
    QrScope.ORDER_STATUS,
    QrScope.EMERGENCY,
    QrScope.HANDOVER,
  ],

  // A supplier loading the truck or a customer receiving it needs to know the
  // vehicle is the right one and is legal — not the driver's home address.
  [ScannerRelationship.TRANSACTING_PARTNER]: [
    QrScope.IDENTITY,
    QrScope.VEHICLE_SUMMARY,
    QrScope.COMPLIANCE,
    QrScope.TRIP_STATUS,
    QrScope.ORDER_STATUS,
    QrScope.HANDOVER,
  ],

  // The one relationship that unlocks medical data, and only while an incident
  // is open. Enforced in the service, not the UI.
  [ScannerRelationship.EMERGENCY_RESPONDER]: [
    QrScope.IDENTITY,
    QrScope.CONTACT,
    QrScope.VEHICLE_SUMMARY,
    QrScope.EMERGENCY,
  ],

  [ScannerRelationship.RELAY_PARTNER]: [
    QrScope.IDENTITY,
    QrScope.VEHICLE_SUMMARY,
    QrScope.ORDER_STATUS,
    QrScope.HANDOVER,
  ],

  [ScannerRelationship.SIGNED_IN_STRANGER]: [QrScope.IDENTITY],

  // Only reachable when the code explicitly opts into public resolution.
  [ScannerRelationship.ANONYMOUS]: [QrScope.IDENTITY],
};

/** Scopes a fresh code gets by default, per subject type. */
const DEFAULT_SCOPES: Record<QrSubjectType, QrScope[]> = {
  [QrSubjectType.DRIVER]: [
    QrScope.IDENTITY,
    QrScope.DRIVER_SUMMARY,
    QrScope.COMPLIANCE,
    QrScope.ASSIGNMENT,
    QrScope.EMERGENCY,
  ],
  [QrSubjectType.VEHICLE]: [
    QrScope.IDENTITY,
    QrScope.VEHICLE_SUMMARY,
    QrScope.COMPLIANCE,
    QrScope.ASSIGNMENT,
    QrScope.TRIP_STATUS,
    QrScope.HANDOVER,
  ],
  [QrSubjectType.USER]: [QrScope.IDENTITY, QrScope.CONTACT],
  [QrSubjectType.TRIP]: [QrScope.IDENTITY, QrScope.TRIP_STATUS, QrScope.VEHICLE_SUMMARY],
  [QrSubjectType.ORDER]: [QrScope.IDENTITY, QrScope.ORDER_STATUS, QrScope.HANDOVER],
  [QrSubjectType.VEHICLE_LISTING]: [QrScope.IDENTITY, QrScope.VEHICLE_SUMMARY, QrScope.COMPLIANCE],
  [QrSubjectType.INVENTORY_LOCATION]: [QrScope.IDENTITY],
  [QrSubjectType.TRANSFER_HUB]: [QrScope.IDENTITY],
  [QrSubjectType.RELAY_DELIVERY]: [QrScope.IDENTITY, QrScope.ORDER_STATUS, QrScope.HANDOVER],
};

export function defaultScopesFor(subjectType: QrSubjectType): QrScope[] {
  return [...(DEFAULT_SCOPES[subjectType] ?? [QrScope.IDENTITY])];
}

/**
 * What this scan may actually disclose.
 *
 * `EMERGENCY` needs `emergencyContextActive` on top of the relationship — the
 * responder relationship alone is not enough, because a responder from a past
 * incident must not keep medical access forever.
 */
export function resolveGrantedScopes(input: {
  codeScopes: readonly QrScope[];
  relationship: ScannerRelationship;
  emergencyContextActive?: boolean;
  handoverContextActive?: boolean;
}): QrScope[] {
  const ceiling = RELATIONSHIP_CEILING[input.relationship] ?? [QrScope.IDENTITY];

  return input.codeScopes.filter((scope) => {
    if (!ceiling.includes(scope)) return false;

    // Medical and emergency-contact data is released only during an incident.
    if (scope === QrScope.EMERGENCY) {
      return input.emergencyContextActive === true;
    }
    // The handover capability is a write action, so it needs a live leg to act
    // on rather than merely a partner relationship.
    if (scope === QrScope.HANDOVER) {
      return (
        input.handoverContextActive === true ||
        input.relationship === ScannerRelationship.SAME_ORGANIZATION ||
        input.relationship === ScannerRelationship.PLATFORM_STAFF
      );
    }
    return true;
  });
}

export function hasScope(granted: readonly QrScope[], scope: QrScope): boolean {
  return granted.includes(scope);
}

/**
 * Human explanation of why a field is missing.
 *
 * Shown instead of a blank or a zero, so the person holding the phone knows the
 * data exists but is not theirs to see.
 */
export function scopeDeniedReason(scope: QrScope): string {
  switch (scope) {
    case QrScope.CONTACT:
      return 'Contact details are shared only within the operating fleet.';
    case QrScope.EMERGENCY:
      return 'Emergency details are released only to responders on an active incident.';
    case QrScope.COMPLIANCE:
      return 'Document validity is shared with the fleet and its transacting partners.';
    case QrScope.ASSIGNMENT:
      return 'Assignment details are shared only within the operating fleet.';
    case QrScope.HANDOVER:
      return 'Handover actions are available only to the assigned partner on a live leg.';
    default:
      return 'This information is not shared with your account.';
  }
}

/**
 * Printable sticker presets. Sizes are millimetres, at trim.
 *
 * Not arbitrary numbers. The ID card is CR80 — the same as a bank or access
 * card — so it fits a lanyard holder someone already owns. The door sticker is
 * 100 mm because that is about the smallest square whose code still scans from
 * three metres on a phone. The bumper strip is proportioned to sit above a
 * tailgate plate without covering it.
 */
export const QR_BADGE_PRESETS = {
  vehicleSticker: {
    key: 'vehicle-sticker',
    label: 'Vehicle door sticker',
    widthMm: 100,
    heightMm: 100,
    description: 'Square sticker for the cab door or body panel. Reads from about three metres.',
  },
  vehicleWindscreen: {
    key: 'vehicle-windscreen',
    label: 'Windscreen sticker',
    widthMm: 90,
    heightMm: 55,
    description:
      'Compact sticker for a corner of the windscreen, where it cannot obstruct the view. Can be reverse-printed for fitting inside the glass.',
  },
  vehicleStrip: {
    key: 'vehicle-strip',
    label: 'Vehicle bumper strip',
    widthMm: 150,
    heightMm: 60,
    description: 'Landscape strip for the tailgate, above the number plate.',
  },
  driverCard: {
    key: 'driver-card',
    label: 'Driver ID card',
    widthMm: 85.6,
    heightMm: 54,
    description: 'CR80 card that fits a standard lanyard holder.',
  },
} as const;

export type QrBadgePreset = (typeof QR_BADGE_PRESETS)[keyof typeof QR_BADGE_PRESETS];

export const QR_BADGE_PRESET_KEYS = [
  'vehicle-sticker',
  'vehicle-windscreen',
  'vehicle-strip',
  'driver-card',
] as const;
export type QrBadgePresetKey = (typeof QR_BADGE_PRESET_KEYS)[number];

export function badgePreset(key: string): QrBadgePreset {
  return (
    Object.values(QR_BADGE_PRESETS).find((preset) => preset.key === key) ??
    QR_BADGE_PRESETS.vehicleSticker
  );
}

/** The preset that suits a subject, when the caller does not name one. */
export function defaultBadgePresetFor(subjectType: QrSubjectType): QrBadgePresetKey {
  if (subjectType === QrSubjectType.DRIVER || subjectType === QrSubjectType.USER) {
    return 'driver-card';
  }
  return 'vehicle-sticker';
}

/**
 * Short human-typeable form of a token.
 *
 * A dirty windscreen sticker will eventually fail to scan, and a gate operator
 * needs a fallback that does not involve reading 43 base64url characters aloud.
 * The first 8 characters are shown grouped; the API accepts a prefix lookup on
 * them and then requires the full token, so the short form is a convenience for
 * finding the record, never an authentication factor on its own.
 */
export function shortTokenLabel(token: string): string {
  const cleaned = token.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
}

/** The URL a scanner's camera opens. Built in one place so it never drifts. */
export function qrTargetUrl(frontendUrl: string, token: string): string {
  return `${frontendUrl.replace(/\/$/, '')}/q/${token}`;
}
