import {
  IdentityVerificationOutcome,
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  VehicleOwnershipStatus,
  VerificationSubjectType,
  ownerNamesMatch,
  type VehicleOwnershipView,
  type VehicleRcRecord,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { AuthContext } from '../../auth/context';
import { accountHolderUserId } from '../identity-verification/personal-onboarding.guard';
import { notifyOrganization } from '../notifications/notification.service';
import { archiveTruckRecord } from '../trucks/truck-archive';

/**
 * Vehicle ownership — is the account holding a plate the one that owns it?
 *
 * The rules are in `@saarthi/shared` (`domain/vehicle-ownership.ts`); this is
 * where they meet the data. Entirely automatic and entirely local: it reads
 * Saarthi's own store, never calls a provider, and nothing waits on a person.
 */

const serviceLogger = logger.child({ module: 'vehicle-ownership' });

/** The ownership columns, for callers that only need the view. */
export const ownershipSelect = {
  ownershipStatus: true,
  ownershipVerifiedAt: true,
  ownershipNote: true,
} satisfies Prisma.TruckSelect;

type OwnershipColumns = Prisma.TruckGetPayload<{ select: typeof ownershipSelect }>;

export function ownershipView(truck: OwnershipColumns): VehicleOwnershipView {
  return {
    status: truck.ownershipStatus as VehicleOwnershipStatus,
    verifiedAt: truck.ownershipVerifiedAt?.toISOString() ?? null,
    note: truck.ownershipNote,
  };
}

/**
 * A new plate is a new claim: what was confirmed for the old number says
 * nothing about the vehicle behind the new one.
 */
export function ownershipResetForNewPlate() {
  return {
    ownershipStatus: VehicleOwnershipStatus.PENDING,
    ownershipVerifiedAt: null,
    ownershipNote: null,
    ownershipCheckedAt: null,
  } satisfies Prisma.TruckUpdateInput;
}

/** A released row is history; its plate now belongs to another account. */
export function assertNotReleased(truck: { ownershipStatus: string }): void {
  if (truck.ownershipStatus === VehicleOwnershipStatus.RELEASED) {
    throw errors.businessRule(
      'This vehicle was released to the account that proved it owns it, so it can no longer be changed or restored.',
    );
  }
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * The government-verified names that can stand for this account.
 *
 * The business's GST legal and trade names and any verified business PAN, plus
 * the verified PAN and Voter ID names of its directors — the owner-role
 * members, or the account holder when there is none. Aadhaar is not a source:
 * its check returns no name. Profile names are not either; anyone can type one.
 */
async function verifiedNamesFor(organizationId: string): Promise<string[]> {
  const [organization, directors] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { gstLegalName: true, gstTradeName: true, gstVerifiedAt: true },
    }),
    prisma.membership.findMany({
      where: { organizationId, status: 'ACTIVE', role: { in: [...OPERATOR_OWNER_ROLES] } },
      select: { userId: true },
    }),
  ]);

  const directorIds = directors.map((membership) => membership.userId);
  if (directorIds.length === 0) {
    const holder = await accountHolderUserId(organizationId);
    if (holder) directorIds.push(holder);
  }

  const checks = await prisma.identityVerification.findMany({
    where: {
      outcome: IdentityVerificationOutcome.VERIFIED,
      holderName: { not: null },
      OR: [
        { subjectType: VerificationSubjectType.ORGANIZATION, subjectId: organizationId },
        { subjectType: VerificationSubjectType.USER, subjectId: { in: directorIds } },
      ],
    },
    select: { holderName: true },
  });

  const names = checks.map((check) => check.holderName);
  if (organization?.gstVerifiedAt) names.push(organization.gstLegalName, organization.gstTradeName);
  return names.filter((name): name is string => Boolean(name?.trim()));
}

/**
 * The registered owner's name from the most recent stored RC record.
 *
 * Any account's lookup will do: the record describes the vehicle, not who
 * asked, and it is only compared here — never returned.
 */
async function storedRcOwnerName(registrationNumber: string): Promise<string | null> {
  const lookup = await prisma.vehicleLookup.findFirst({
    where: { registrationNumber },
    orderBy: { fetchedAt: 'desc' },
    select: { responseData: true },
  });
  const record = lookup?.responseData as unknown as VehicleRcRecord | null;
  return record?.owner?.name?.trim() || null;
}

type NameMatchOutcome = { matched: true } | { matched: false; note: string };

/** The RC owner against the account's verified names. The note never repeats the RC name. */
async function matchOwnerName(
  organizationId: string,
  registrationNumber: string,
): Promise<NameMatchOutcome> {
  const rcName = await storedRcOwnerName(registrationNumber);
  if (!rcName) {
    return {
      matched: false,
      note: 'No RTO record has been fetched for this vehicle yet. Verify it against the RC, then check again.',
    };
  }
  if (rcName.includes('*')) {
    return {
      matched: false,
      note: 'The RTO record shows the owner’s name masked, so it cannot be matched to this account.',
    };
  }

  const names = await verifiedNamesFor(organizationId);
  if (names.length === 0) {
    return {
      matched: false,
      note: 'There is no government-verified name on this account yet. Verify your PAN or Voter ID, or your business GSTIN, then check again.',
    };
  }
  if (names.some((name) => ownerNamesMatch(rcName, name))) return { matched: true };

  return {
    matched: false,
    note: 'The RC owner’s name does not match a verified name on this account, so its owner details stay masked.',
  };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Settle a vehicle's ownership from the evidence Saarthi already holds.
 *
 * Run when a vehicle is added, when its RC is fetched, when the owner presses
 * "Check again", and by the sweep — which is what picks up a PAN verified
 * since. A confirmed or released vehicle is left as it is: ownership, once
 * decided, is not re-decided by a later lookup.
 */
export async function evaluateOwnership(truckId: string): Promise<VehicleOwnershipView> {
  const truck = await prisma.truck.findUnique({
    where: { id: truckId },
    select: { id: true, organizationId: true, registrationNumber: true, ...ownershipSelect },
  });
  if (!truck) throw errors.notFound('Vehicle');
  if (truck.ownershipStatus !== VehicleOwnershipStatus.PENDING) return ownershipView(truck);

  const outcome = await matchOwnerName(truck.organizationId, truck.registrationNumber);
  const now = new Date();

  if (!outcome.matched) {
    const updated = await prisma.truck.update({
      where: { id: truck.id },
      data: { ownershipNote: outcome.note, ownershipCheckedAt: now },
      select: ownershipSelect,
    });
    return ownershipView(updated);
  }

  const [updated] = await prisma.$transaction([
    prisma.truck.update({
      where: { id: truck.id },
      data: {
        ownershipStatus: VehicleOwnershipStatus.VERIFIED,
        ownershipVerifiedAt: now,
        ownershipNote: null,
        ownershipCheckedAt: now,
      },
      select: ownershipSelect,
    }),
    prisma.truckEvent.create({
      data: {
        truckId: truck.id,
        organizationId: truck.organizationId,
        type: 'OWNERSHIP_VERIFIED',
        description: 'Ownership confirmed: the RC owner matches a verified name on this account.',
      },
    }),
  ]);
  return ownershipView(updated);
}

/** The owner's "Check again" button. */
export async function checkOwnership(
  auth: AuthContext,
  truckId: string,
): Promise<VehicleOwnershipView> {
  const truck = await prisma.truck.findUnique({
    where: { id: truckId },
    select: { organizationId: true },
  });
  if (!truck || (!auth.isPlatformAdmin && truck.organizationId !== auth.organizationId)) {
    throw errors.notFound('Vehicle');
  }
  return evaluateOwnership(truckId);
}

// ---------------------------------------------------------------------------
// A plate already on Saarthi
// ---------------------------------------------------------------------------

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
  organizationId: string,
  registrationNumber: string,
  noun: 'truck' | 'vehicle',
): Promise<string | null> {
  const existing = await prisma.truck.findUnique({
    where: { registrationNumber },
    select: { id: true, organizationId: true, ownershipStatus: true },
  });
  if (!existing) return null;

  const fields = {
    fields: { registrationNumber: ['This registration number is already registered.'] },
  };

  if (
    existing.organizationId !== organizationId &&
    existing.ownershipStatus !== VehicleOwnershipStatus.VERIFIED
  ) {
    const outcome = await matchOwnerName(organizationId, registrationNumber);
    if (outcome.matched) return existing.id;

    throw errors.duplicate(
      `${registrationNumber} is held by another account that has not confirmed it owns it. ` +
        'If it is yours, fetch its RC details on this form and make sure your PAN, Voter ID or business GSTIN is verified, so your name can be matched to the RC.',
      fields,
    );
  }

  throw errors.duplicate(
    `A ${noun} with registration ${registrationNumber} is already registered on Saarthi.`,
    fields,
  );
}

/**
 * Hand a plate back to its verified owner: archive the unconfirmed holder's
 * row, keep its history, and free the number. Runs inside the transaction that
 * creates the owner's vehicle, so the plate is never held by neither or both.
 */
export async function releaseRegistration(
  tx: Prisma.TransactionClient,
  truckId: string,
): Promise<{ organizationId: string; registrationNumber: string }> {
  const truck = await tx.truck.findUniqueOrThrow({
    where: { id: truckId },
    select: { id: true, organizationId: true, registrationNumber: true },
  });

  await archiveTruckRecord(
    tx,
    truck,
    {
      type: 'OWNERSHIP_RELEASED',
      description: `${truck.registrationNumber} was released to the account that proved it owns it.`,
      actorUserId: null,
    },
    {
      // The unique column must be free for the owner; the id keeps it unique.
      registrationNumber: `RELEASED-${truck.id}`,
      releasedRegistrationNumber: truck.registrationNumber,
      ownershipStatus: VehicleOwnershipStatus.RELEASED,
      ownershipNote: 'Released to the account that proved it owns this vehicle.',
    },
  );

  return { organizationId: truck.organizationId, registrationNumber: truck.registrationNumber };
}

/** Tell the account that lost a plate why. Called after the transaction commits. */
export function notifyRegistrationReleased(released: {
  organizationId: string;
  registrationNumber: string;
}): void {
  void notifyOrganization(released.organizationId, {
    roles: OPERATOR_OWNER_ROLES,
    type: NotificationType.VERIFICATION_RESULT,
    title: 'Vehicle released to its owner',
    body:
      `${released.registrationNumber} was added by an account whose verified name matches the RC, ` +
      'so it has been removed from yours. Its history stays in your archived vehicles. If you believe this is wrong, contact support.',
    priority: NotificationPriority.HIGH,
    actionUrl: '/fleet/vehicles',
  }).catch((error: unknown) =>
    serviceLogger.warn({ error }, 'Could not notify an account that its vehicle was released'),
  );
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

const SWEEP_BATCH = 200;
const RECHECK_AFTER_MS = 6 * 3_600_000;

/**
 * Re-check unconfirmed vehicles, oldest check first, so a PAN or GSTIN
 * verified after the vehicle was added confirms it without anyone asking.
 * Nothing is ever archived for being unconfirmed: the vehicle keeps working,
 * masked, and the real owner can still claim the plate.
 */
export async function runVehicleOwnershipSweep(): Promise<{ checked: number }> {
  const recheckBefore = new Date(Date.now() - RECHECK_AFTER_MS);
  const due = await prisma.truck.findMany({
    where: {
      ownershipStatus: VehicleOwnershipStatus.PENDING,
      OR: [{ ownershipCheckedAt: null }, { ownershipCheckedAt: { lt: recheckBefore } }],
    },
    orderBy: { ownershipCheckedAt: { sort: 'asc', nulls: 'first' } },
    take: SWEEP_BATCH,
    select: { id: true },
  });

  let checked = 0;
  for (const { id } of due) {
    try {
      await evaluateOwnership(id);
      checked += 1;
    } catch (error) {
      serviceLogger.warn({ truckId: id, error }, 'Ownership re-check failed');
    }
  }
  return { checked };
}
