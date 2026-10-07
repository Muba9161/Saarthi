import { VehicleOwnershipStatus, ownerNamesMatch } from '@saarthi/shared';
import type { AuthContext } from '../../auth/context';
import { prisma } from '../../database/prisma';
import { AppError, errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { fetchRcForOwnershipClaim } from '../vehicle-lookup/vehicle-lookup.service';
import { storedRcOwnerName, verifiedNamesFor } from './vehicle-ownership.service';

/**
 * Claiming a plate another account holds.
 *
 * Apart from `vehicle-ownership.service.ts` because settling a claim may fetch
 * the RC, and the lookup service already depends on that module. The hand-over
 * itself (`releaseRegistration`) stays there.
 */

const serviceLogger = logger.child({ module: 'registration-claim' });

const PLATE_TAKEN = {
  fields: { registrationNumber: ['This registration number is already registered.'] },
};

/** Why a claim fails, each in terms the claimant can act on. Never the RC name. */
const REFUSAL = {
  aadhaarOnly:
    'Your Aadhaar is verified, but an Aadhaar check does not include your name, so it cannot be matched to the RC. Verify your PAN or Voter ID in Your identity, then add the vehicle again.',
  noVerifiedName:
    'This account has no government-verified name to match against the RC yet. Verify your PAN or Voter ID in Your identity, or your business GSTIN, then add the vehicle again.',
  noRtoOwner:
    'The RTO records name no owner for this number, so ownership cannot be checked. Check the number against the RC.',
  masked:
    'The RTO record shows the owner’s name masked, so it cannot be matched to your verified name. If the vehicle is yours, contact support.',
  mismatch:
    'The owner’s name on the RC does not match a verified name on this account. If the vehicle is yours, contact support.',
} as const;

/**
 * Is this plate free to add, and does another account's hold on it have to go?
 *
 * Registration numbers are unique across Saarthi, so whoever adds a plate first
 * would otherwise keep it from its owner for good. A hold that was never
 * confirmed gives way to an account whose verified name matches the RC; a
 * confirmed hold, or one on the same account, does not. Returns the vehicle to
 * release, or `null` when the plate is free.
 */
export async function resolveRegistrationClaim(
  auth: AuthContext,
  organizationId: string,
  registrationNumber: string,
  noun: 'truck' | 'vehicle',
): Promise<string | null> {
  const existing = await prisma.truck.findUnique({
    where: { registrationNumber },
    select: { id: true, organizationId: true, ownershipStatus: true },
  });
  if (!existing) return null;

  if (
    existing.organizationId === organizationId ||
    existing.ownershipStatus === VehicleOwnershipStatus.VERIFIED
  ) {
    throw errors.duplicate(
      `A ${noun} with registration ${registrationNumber} is already registered on Saarthi.`,
      PLATE_TAKEN,
    );
  }

  const refusal = await claimRefusal(auth, organizationId, registrationNumber);
  if (!refusal) return existing.id;

  throw errors.duplicate(
    `${registrationNumber} is held by another account that has not confirmed it owns it. ${refusal}`,
    PLATE_TAKEN,
  );
}

/** Why the claim fails, or `null` when a verified name on the account matches the RC owner. */
async function claimRefusal(
  auth: AuthContext,
  organizationId: string,
  registrationNumber: string,
): Promise<string | null> {
  // Names first: with none to compare, fetching the RC would be paid for nothing.
  const { names, aadhaarOnly } = await verifiedNamesFor(organizationId);
  if (names.length === 0) return aadhaarOnly ? REFUSAL.aadhaarOnly : REFUSAL.noVerifiedName;

  const rcName = await rcOwnerName(auth, registrationNumber);
  if (!rcName) return REFUSAL.noRtoOwner;
  if (rcName.includes('*')) return REFUSAL.masked;
  return names.some((name) => ownerNamesMatch(rcName, name)) ? null : REFUSAL.mismatch;
}

/**
 * The RC owner's name, fetching the record when Saarthi holds none.
 *
 * A provider failure is reported as one, not as a refusal: the claimant may
 * well own the vehicle, and trying again later is the right advice.
 */
async function rcOwnerName(auth: AuthContext, registrationNumber: string): Promise<string | null> {
  const stored = await storedRcOwnerName(registrationNumber);
  if (stored) return stored;

  try {
    await fetchRcForOwnershipClaim(auth, registrationNumber);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.statusCode === 404) return null;

    serviceLogger.warn(
      { errorCode: error.code },
      'Could not fetch the RC to settle a registration claim',
    );
    throw errors.providerUnavailable(
      'vehicle-rc',
      `The RTO record for ${registrationNumber} could not be fetched just now, so your name cannot be checked against it. Please try again in a few minutes.`,
    );
  }

  return storedRcOwnerName(registrationNumber);
}
