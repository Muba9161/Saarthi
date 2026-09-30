import {
  Feature,
  MAX_VEHICLE_SHARES,
  NotificationPriority,
  NotificationType,
  VehicleOwnershipStatus,
  VehicleShareStatus,
  type SharedWithMe,
  type VehicleShareView,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import type { AuthContext } from '../../auth/context';
import { notifyAsync } from '../notifications/notification.service';
import { resolveSubscription } from '../subscriptions/entitlements.service';
import { sharedVehicleView, vehicleViewInclude } from './shared-vehicle.view';

/**
 * Vehicle sharing — who may see and use another account's vehicle.
 *
 * The rules are in `@saarthi/shared` (`domain/vehicle-sharing.ts`). This module
 * is the only door a shared person has onto a vehicle: every read and write of
 * theirs goes through `requireActiveShare`, and none of the owner's own
 * endpoints were loosened to let them in. That keeps the owner's screens
 * exactly as private as they were, and what a shared person sees is a list
 * someone chose rather than whatever an owner endpoint happens to return.
 */

/** Shares that still hold one of the vehicle's places: invited, or accepted. */
const OPEN_STATUSES: VehicleShareStatus[] = [VehicleShareStatus.PENDING, VehicleShareStatus.ACTIVE];

const fullName = (user: { firstName: string; lastName: string }): string =>
  `${user.firstName} ${user.lastName}`.trim();

/**
 * Sharing rides on the owner's plan. When the owner's subscription lapses the
 * share stops working — the shared person sees nothing and can add nothing —
 * and it comes back by itself if the owner renews, because the share itself
 * is left as it was. Read from the same resolved subscription every other
 * plan rule reads, so a lapsed plan falls to the lapsed floor, which does not
 * include sharing.
 */
async function ownerPlanAllowsSharing(organizationId: string): Promise<boolean> {
  const subscription = await resolveSubscription(organizationId);
  return subscription.features.includes(Feature.VEHICLE_SHARING);
}

/** A vehicle can be shared while it is on the road and its owner has shown it is theirs. */
function assertShareable(vehicle: { archivedAt: Date | null; ownershipStatus: string }): void {
  if (vehicle.archivedAt) {
    throw errors.businessRule('This vehicle is archived, so it cannot be shared.');
  }
  if (vehicle.ownershipStatus !== VehicleOwnershipStatus.VERIFIED) {
    throw errors.businessRule(
      'Confirm that you own this vehicle before sharing it. Its Ownership card shows how.',
    );
  }
}

/** The owner's vehicle, or a 404 that does not say whether it exists elsewhere. */
async function ownedVehicle(auth: AuthContext, vehicleId: string) {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: {
      id: true,
      organizationId: true,
      registrationNumber: true,
      archivedAt: true,
      ownershipStatus: true,
    },
  });
  if (!vehicle || (!auth.isPlatformAdmin && vehicle.organizationId !== auth.organizationId)) {
    throw errors.notFound('Vehicle');
  }
  return vehicle;
}

// ---------------------------------------------------------------------------
// The owner's side
// ---------------------------------------------------------------------------

export async function listShares(
  auth: AuthContext,
  vehicleId: string,
): Promise<VehicleShareView[]> {
  await ownedVehicle(auth, vehicleId);
  const shares = await prisma.vehicleShare.findMany({
    where: { vehicleId, status: { in: OPEN_STATUSES } },
    orderBy: { invitedAt: 'asc' },
    include: { sharedWith: { select: { firstName: true, lastName: true, email: true } } },
  });
  return shares.map((share) => ({
    id: share.id,
    status: share.status as VehicleShareStatus,
    sharedWith: { name: fullName(share.sharedWith), email: share.sharedWith.email },
    invitedAt: share.invitedAt.toISOString(),
    respondedAt: share.respondedAt?.toISOString() ?? null,
  }));
}

/**
 * Invite another Saarthi account to a vehicle, by the email it signs in with.
 *
 * Only an existing account can be invited: sharing is for two people who are
 * both on Saarthi, and the person has to accept before they see anything.
 */
export async function shareVehicle(
  auth: AuthContext,
  vehicleId: string,
  email: string,
): Promise<VehicleShareView> {
  const vehicle = await ownedVehicle(auth, vehicleId);
  assertShareable(vehicle);

  const recipient = await prisma.user.findUnique({
    where: { email },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!recipient) {
    throw errors.notFound(
      'Saarthi account',
      'No Saarthi account uses that email. Ask them to sign up first, then share again.',
    );
  }
  if (recipient.id === auth.user.id) {
    throw errors.validation('This vehicle is already yours.');
  }

  const [sameAccount, openShares, existing] = await Promise.all([
    prisma.membership.findFirst({
      where: { userId: recipient.id, organizationId: vehicle.organizationId, status: 'ACTIVE' },
      select: { id: true },
    }),
    prisma.vehicleShare.count({
      where: { vehicleId, status: { in: OPEN_STATUSES }, sharedWithUserId: { not: recipient.id } },
    }),
    prisma.vehicleShare.findUnique({
      where: { vehicleId_sharedWithUserId: { vehicleId, sharedWithUserId: recipient.id } },
      select: { status: true },
    }),
  ]);

  if (sameAccount) {
    throw errors.businessRule(
      `${fullName(recipient)} is already on this account and can see the vehicle.`,
    );
  }
  if (existing && OPEN_STATUSES.includes(existing.status as VehicleShareStatus)) {
    throw errors.conflict(`This vehicle is already shared with ${fullName(recipient)}.`);
  }
  if (openShares >= MAX_VEHICLE_SHARES) {
    throw errors.businessRule(
      `A vehicle can be shared with up to ${MAX_VEHICLE_SHARES} people. Stop sharing with someone first.`,
    );
  }

  // One row per vehicle and person: sharing again after a decline or an end
  // reopens it as a fresh invitation.
  const now = new Date();
  const share = await prisma.vehicleShare.upsert({
    where: { vehicleId_sharedWithUserId: { vehicleId, sharedWithUserId: recipient.id } },
    create: {
      vehicleId,
      ownerOrganizationId: vehicle.organizationId,
      sharedWithUserId: recipient.id,
      invitedById: auth.user.id,
    },
    update: {
      ownerOrganizationId: vehicle.organizationId,
      invitedById: auth.user.id,
      status: VehicleShareStatus.PENDING,
      invitedAt: now,
      respondedAt: null,
      endedAt: null,
    },
  });

  notifyAsync({
    userId: recipient.id,
    type: NotificationType.SYSTEM,
    title: 'A vehicle was shared with you',
    body: `${fullName(auth.user)} wants to share ${vehicle.registrationNumber} with you. Accept it under Vehicles → Shared with me.`,
    priority: NotificationPriority.NORMAL,
    actionUrl: '/fleet/vehicles?view=shared',
  });

  return {
    id: share.id,
    status: share.status as VehicleShareStatus,
    sharedWith: { name: fullName(recipient), email: recipient.email },
    invitedAt: share.invitedAt.toISOString(),
    respondedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Ending a share — either side
// ---------------------------------------------------------------------------

/**
 * Stop sharing. The owner's account can end any share of its vehicle; the
 * person it was shared with can leave it. Anyone else gets a 404.
 */
export async function endShare(
  auth: AuthContext,
  shareId: string,
  ownerMayManage: boolean,
): Promise<void> {
  const share = await prisma.vehicleShare.findUnique({
    where: { id: shareId },
    include: { vehicle: { select: { registrationNumber: true } } },
  });
  const isRecipient = share?.sharedWithUserId === auth.user.id;
  const isOwner =
    ownerMayManage && (auth.isPlatformAdmin || share?.ownerOrganizationId === auth.organizationId);
  if (!share || (!isRecipient && !isOwner)) throw errors.notFound('Share');
  if (!OPEN_STATUSES.includes(share.status as VehicleShareStatus)) return;

  await prisma.vehicleShare.update({
    where: { id: share.id },
    data: { status: VehicleShareStatus.REVOKED, endedAt: new Date() },
  });

  // Tell the other side, so nobody finds out by a vehicle quietly vanishing.
  notifyAsync(
    isRecipient
      ? {
          userId: share.invitedById,
          type: NotificationType.SYSTEM,
          title: 'Vehicle no longer shared',
          body: `${fullName(auth.user)} stopped using ${share.vehicle.registrationNumber}.`,
        }
      : {
          userId: share.sharedWithUserId,
          type: NotificationType.SYSTEM,
          title: 'Vehicle no longer shared',
          body: `${share.vehicle.registrationNumber} is no longer shared with you.`,
        },
  );
}

// ---------------------------------------------------------------------------
// The shared person's side
// ---------------------------------------------------------------------------

/** Accept or decline an invitation made to this person. */
export async function respondToShare(
  auth: AuthContext,
  shareId: string,
  accept: boolean,
): Promise<void> {
  const share = await prisma.vehicleShare.findUnique({
    where: { id: shareId },
    include: {
      vehicle: { select: { registrationNumber: true, archivedAt: true, ownershipStatus: true } },
    },
  });
  if (!share || share.sharedWithUserId !== auth.user.id) throw errors.notFound('Share');
  if (share.status !== VehicleShareStatus.PENDING) {
    throw errors.conflict('This invitation has already been answered or withdrawn.');
  }
  if (accept) {
    assertShareable(share.vehicle);
    if (!(await ownerPlanAllowsSharing(share.ownerOrganizationId))) {
      throw errors.businessRule(
        'The owner’s Saarthi plan no longer includes sharing, so this invitation cannot be accepted right now.',
      );
    }
  }

  await prisma.vehicleShare.update({
    where: { id: share.id },
    data: {
      status: accept ? VehicleShareStatus.ACTIVE : VehicleShareStatus.DECLINED,
      respondedAt: new Date(),
    },
  });

  notifyAsync({
    userId: share.invitedById,
    type: NotificationType.SYSTEM,
    title: accept ? 'Vehicle share accepted' : 'Vehicle share declined',
    body: `${fullName(auth.user)} ${accept ? 'accepted' : 'declined'} ${share.vehicle.registrationNumber}.`,
  });
}

/** Invitations waiting on this person, and the vehicles they can use. */
export async function sharedWithMe(auth: AuthContext): Promise<SharedWithMe> {
  const shares = await prisma.vehicleShare.findMany({
    where: { sharedWithUserId: auth.user.id, status: { in: OPEN_STATUSES } },
    orderBy: { invitedAt: 'desc' },
    include: { vehicle: { include: vehicleViewInclude } },
  });

  const organizationIds = [...new Set(shares.map((share) => share.ownerOrganizationId))];
  const inviterIds = [...new Set(shares.map((share) => share.invitedById))];
  const [organizations, inviters] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: organizationIds } },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { id: { in: inviterIds } },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  const ownerName = new Map(organizations.map((org) => [org.id, org.name]));
  const inviterName = new Map(inviters.map((user) => [user.id, fullName(user)]));

  // Whose plans still include sharing — one lookup per owner, not per share.
  const entitled = new Set<string>();
  await Promise.all(
    organizationIds.map(async (organizationId) => {
      if (await ownerPlanAllowsSharing(organizationId)) entitled.add(organizationId);
    }),
  );

  // A vehicle that has left the road, lost its confirmed owner, or whose
  // owner's plan has lapsed is not offered at all — neither as an invitation
  // nor as something to open.
  const usable = shares.filter(
    (share) =>
      !share.vehicle.archivedAt &&
      share.vehicle.ownershipStatus === VehicleOwnershipStatus.VERIFIED &&
      entitled.has(share.ownerOrganizationId),
  );

  return {
    invitations: usable
      .filter((share) => share.status === VehicleShareStatus.PENDING)
      .map((share) => {
        const view = sharedVehicleView(share, ownerName.get(share.ownerOrganizationId) ?? '');
        return {
          shareId: share.id,
          registrationNumber: view.registrationNumber,
          typeLabel: view.typeLabel,
          ownerName: view.ownerName,
          invitedBy: inviterName.get(share.invitedById) ?? view.ownerName,
          invitedAt: share.invitedAt.toISOString(),
        };
      }),
    vehicles: usable
      .filter((share) => share.status === VehicleShareStatus.ACTIVE)
      .map((share) => sharedVehicleView(share, ownerName.get(share.ownerOrganizationId) ?? '')),
  };
}

/**
 * The gate every shared-vehicle read and write passes: an accepted share, made
 * to this person, of a vehicle still on the road with a confirmed owner whose
 * plan still includes sharing.
 * Anything else is a 404, so a share id says nothing to somebody else.
 */
export async function requireActiveShare(auth: AuthContext, shareId: string) {
  const share = await prisma.vehicleShare.findUnique({
    where: { id: shareId },
    include: { vehicle: { include: vehicleViewInclude } },
  });
  if (
    !share ||
    share.sharedWithUserId !== auth.user.id ||
    share.status !== VehicleShareStatus.ACTIVE ||
    share.vehicle.archivedAt ||
    share.vehicle.ownershipStatus !== VehicleOwnershipStatus.VERIFIED ||
    !(await ownerPlanAllowsSharing(share.ownerOrganizationId))
  ) {
    throw errors.notFound('Shared vehicle');
  }
  return share;
}
