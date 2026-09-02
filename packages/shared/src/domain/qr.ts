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
export type ScannerRelationship = (typeof ScannerRelationship)[keyof typeof ScannerRelationship];

/**
 * Scopes a relationship may ever see, before intersecting with the code.
 *
 * Read this table as the privacy policy in code form. Note what a stranger
 * gets: identity only — enough to confirm the person or vehicle in front of them
 * is a real, verified Saarthi subject, and nothing more.
 */
/**
 * What a scan answers with no session at all.
 *
 * A Saarthi sticker is meant to answer, for anyone standing in front of the
 * vehicle, the questions the paper RC and licence in the cab already answer: is
 * this vehicle registered, is it legal on the road today, and is the person
 * driving it licensed to. Requiring an account to read a sticker on a public
 * road defeats the artefact, so these four scopes resolve anonymously.
 *
 * What is deliberately *not* here, and still needs a relationship:
 *   CONTACT       the driver's phone number
 *   EMERGENCY     blood group and next of kin — responders on a live incident
 *   ASSIGNMENT    who is driving what, and where
 *   TRIP_STATUS   live trip state
 *   ORDER_STATUS  live consignment state
 *   HANDOVER      a write action, never granted to a stranger
 */
const PUBLIC_VERIFICATION_SCOPES: QrScope[] = [
  QrScope.IDENTITY,
  QrScope.VEHICLE_SUMMARY,
  QrScope.DRIVER_SUMMARY,
  QrScope.COMPLIANCE,
];

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

  // A signed-in account with no relationship must never see *less* than an
  // anonymous scanner, or signing in would narrow what a checkpoint officer can
  // read. It therefore inherits the public set rather than restating it.
  [ScannerRelationship.SIGNED_IN_STRANGER]: [...PUBLIC_VERIFICATION_SCOPES],

  // Only reachable when the code opts into public resolution and the owning
  // fleet has not switched anonymous scanning off.
  [ScannerRelationship.ANONYMOUS]: [...PUBLIC_VERIFICATION_SCOPES],
};

/** Scopes a fresh code gets by default, per subject type. */
const DEFAULT_SCOPES: Record<QrSubjectType, QrScope[]> = {
  // Both subject types carry *both* summary scopes. One scan of a truck should
  // answer for the truck and for the person driving it, which is what a roadside
  // check actually asks; the relationship ceiling still decides who sees what.
  [QrSubjectType.DRIVER]: [
    QrScope.IDENTITY,
    QrScope.DRIVER_SUMMARY,
    QrScope.VEHICLE_SUMMARY,
    QrScope.COMPLIANCE,
    QrScope.ASSIGNMENT,
    QrScope.EMERGENCY,
  ],
  [QrSubjectType.VEHICLE]: [
    QrScope.IDENTITY,
    QrScope.VEHICLE_SUMMARY,
    QrScope.DRIVER_SUMMARY,
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
 * Whether a fresh code for this subject resolves without a session.
 *
 * True only for the two subjects whose codes get printed and fixed to something
 * out in the world — a cab door, a lanyard. A trip, order or inventory code is
 * an internal handle that happens to be renderable as a QR, and one of those
 * answering to any passer-by would be a leak rather than a feature.
 *
 * The owning fleet can still close anonymous scanning across every code it has
 * issued with the `allowPublicScans` switch on its privacy policy.
 */
export function publicResolveDefaultFor(subjectType: QrSubjectType): boolean {
  return subjectType === QrSubjectType.DRIVER || subjectType === QrSubjectType.VEHICLE;
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

/**
 * What a scanner just read.
 *
 * A camera pointed at a yard will read things that are not Saarthi identity
 * codes: a terminal's pairing code, a consignment label, a courier's sticker.
 * Silence is the wrong answer to all of them — the driver holds the phone
 * steady, nothing happens, and there is no way to tell a bad scan from a bad
 * camera. So every outcome is named, and the caller can say which one it was.
 */
export type ScannedQr =
  /** A Saarthi identity code — a vehicle sticker or a driver badge. */
  | { kind: 'IDENTITY'; token: string }
  /** A device or terminal pairing credential, meant for an app, not a person. */
  | { kind: 'PAIRING'; target: 'DEVICE' | 'TERMINAL' }
  /** Read cleanly, and it is not ours. */
  | { kind: 'FOREIGN'; value: string };

/** 32 random bytes, base64url. Fixed length, so a truncated read is caught. */
const IDENTITY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

/**
 * Interpret the raw text a QR decoder produced.
 *
 * The host is deliberately *not* checked against the configured frontend. The
 * same sticker is scanned through a dev tunnel, a staging domain and
 * production, and a code printed last year still has last year's host baked
 * into it. What identifies the code is the token; where it was printed to point
 * is not a security property, because resolving it proves nothing on its own —
 * the API decides what any given scanner may see.
 */
export function readScannedQr(raw: string): ScannedQr {
  const value = raw.trim();
  if (!value) return { kind: 'FOREIGN', value };

  // A pairing credential is JSON, never a URL. Recognised so the driver can be
  // told they scanned the tablet's setup code rather than a vehicle.
  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as { kind?: unknown };
      if (parsed.kind === 'saarthi.terminal.pair') return { kind: 'PAIRING', target: 'TERMINAL' };
      if (parsed.kind === 'saarthi.device.pair') return { kind: 'PAIRING', target: 'DEVICE' };
    } catch {
      // Not JSON after all. Falls through to the remaining forms.
    }
    return { kind: 'FOREIGN', value };
  }

  // `/q/<token>`, with or without a scheme and host, with or without a query.
  const path = value.match(/\/q\/([A-Za-z0-9_-]+)/);
  if (path?.[1]) return { kind: 'IDENTITY', token: path[1] };

  // Typed by hand, from the short code printed under the sticker.
  if (IDENTITY_TOKEN_PATTERN.test(value)) return { kind: 'IDENTITY', token: value };

  return { kind: 'FOREIGN', value };
}
