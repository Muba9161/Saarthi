import { IdentityDocumentKind } from './enums';

/**
 * What a driver must pass before they count as verified.
 *
 * Four checks, each against the authority that issued the record: the driving
 * licence with the licensing authority, and Aadhaar, PAN and Voter ID with
 * their own sources. A driver is verified when all four are confirmed and not
 * before — no subset of them stands in for the rest.
 *
 * Kept pure and in `shared` because the same list has to be enforced on the
 * server (where it decides the driver's status) and shown on the client (where
 * it tells somebody what is still outstanding). Two copies of this rule would
 * drift, and the drift would look like the platform lying about who is
 * verified.
 *
 * A caveat worth knowing when reading `AADHAAR_ONLINE_LIMITATION`: Aadhaar has
 * no public standalone verification, so it reaches a confirmed state only when
 * a linked PAN is supplied with it. That is a real constraint on how quickly a
 * driver can complete this list, not something this module can decide away.
 */

/** The four checks, in the order they are asked for and displayed. */
export type DriverCheckKey = 'DRIVING_LICENCE' | 'AADHAAR' | 'PAN' | 'VOTER_ID';

export interface DriverCheckDefinition {
  key: DriverCheckKey;
  label: string;
  /** The `DOCUMENT_TYPES` code whose upload carries this number. */
  documentType: string;
  /**
   * The identity kind this check runs as, for the three that go through the
   * identity module. The licence is `undefined` — it is verified against the
   * driving licence register, not an identity source.
   */
  identityKind?: IdentityDocumentKind;
  /** What to do about it, when it has not been done. */
  hint: string;
}

export const DRIVER_VERIFICATION_CHECKS: readonly DriverCheckDefinition[] = Object.freeze([
  {
    key: 'DRIVING_LICENCE',
    label: 'Driving licence',
    documentType: 'DRIVING_LICENCE',
    hint: 'Check the licence number against the licensing authority.',
  },
  {
    key: 'AADHAAR',
    label: 'Aadhaar',
    documentType: 'DRIVER_AADHAAR',
    identityKind: IdentityDocumentKind.AADHAAR,
    hint: 'Upload the Aadhaar card and verify its number. Supplying the linked PAN is what turns this into a real online check.',
  },
  {
    key: 'PAN',
    label: 'PAN',
    documentType: 'DRIVER_PAN',
    identityKind: IdentityDocumentKind.PAN,
    hint: 'Upload the PAN card and verify its number against Income Tax Department records.',
  },
  {
    key: 'VOTER_ID',
    label: 'Voter ID',
    documentType: 'DRIVER_VOTER_ID',
    identityKind: IdentityDocumentKind.VOTER_ID,
    hint: 'Upload the Voter ID and verify its EPIC number against Election Commission records.',
  },
]);

/** The four timestamps a driver row carries, one per check. */
export interface DriverCheckTimestamps {
  licenceVerifiedAt?: Date | string | null;
  aadhaarVerifiedAt?: Date | string | null;
  panVerifiedAt?: Date | string | null;
  voterIdVerifiedAt?: Date | string | null;
}

export interface DriverCheckState extends DriverCheckDefinition {
  verified: boolean;
  /** ISO 8601, or `null` when this check has not passed. */
  verifiedAt: string | null;
}

export interface DriverVerificationChecklist {
  /** True only when every check has passed. This is "fully verified". */
  complete: boolean;
  items: DriverCheckState[];
  /** Labels of the checks still outstanding, in display order. */
  outstanding: string[];
  verifiedCount: number;
  totalCount: number;
  /** One line fit for a badge tooltip, a toast or a case note. */
  summary: string;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timestampFor(
  key: DriverCheckKey,
  timestamps: DriverCheckTimestamps,
): Date | string | null | undefined {
  switch (key) {
    case 'DRIVING_LICENCE':
      return timestamps.licenceVerifiedAt;
    case 'AADHAAR':
      return timestamps.aadhaarVerifiedAt;
    case 'PAN':
      return timestamps.panVerifiedAt;
    case 'VOTER_ID':
      return timestamps.voterIdVerifiedAt;
    default:
      return null;
  }
}

/**
 * Where a driver stands against the four checks.
 *
 * A check counts as passed only if it carries a timestamp — the moment its
 * authority confirmed it. Presence of the *document* is not enough and never
 * has been: a scan proves somebody uploaded a file, not that the number on it
 * is real.
 */
export function driverVerificationChecklist(
  timestamps: DriverCheckTimestamps,
): DriverVerificationChecklist {
  const items: DriverCheckState[] = DRIVER_VERIFICATION_CHECKS.map((definition) => {
    const verifiedAt = isoOrNull(timestampFor(definition.key, timestamps));
    return { ...definition, verified: verifiedAt !== null, verifiedAt };
  });

  const outstanding = items.filter((item) => !item.verified).map((item) => item.label);
  const verifiedCount = items.length - outstanding.length;
  const complete = outstanding.length === 0;

  return {
    complete,
    items,
    outstanding,
    verifiedCount,
    totalCount: items.length,
    summary: complete
      ? 'All four checks confirmed — licence, Aadhaar, PAN and Voter ID.'
      : `${verifiedCount} of ${items.length} checks confirmed. Still needed: ${outstanding.join(
          ', ',
        )}.`,
  };
}

/**
 * Is this driver fully verified?
 *
 * The single question the server asks before letting a driver's status reach
 * VERIFIED, exported on its own so a caller that needs only the boolean does
 * not have to build the display model to get it.
 */
export function isDriverFullyVerified(timestamps: DriverCheckTimestamps): boolean {
  return driverVerificationChecklist(timestamps).complete;
}

/** The check an uploaded document type belongs to, if any. Drives the Verify button. */
export function driverCheckForDocumentType(
  documentType: string,
): DriverCheckDefinition | undefined {
  return DRIVER_VERIFICATION_CHECKS.find(
    (definition) => definition.documentType === documentType,
  );
}
