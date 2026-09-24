import {
  DriverAvailability,
  MembershipStatus,
  NotificationPriority,
  NotificationType,
  OrganizationType,
  RoleName,
  VerificationStatus,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { assertTenantAccess } from '../../server/guards';
import { notify } from '../notifications/notification.service';
import { allocateInviteCode } from '../organizations/fleet-invite.service';
import { moveDriverRecords } from './driver-fleet-move';
import type { AuthContext } from '../../auth/context';

/**
 * Removing a driver from a fleet — never deleting them.
 *
 * The driver is a person with a career, not a row the fleet owns. So removal:
 *
 *   • ends their fleet membership (kept, marked REMOVED, for the record);
 *   • takes them off any vehicle they were assigned to;
 *   • seats them back in an organization of their own, available for work;
 *   • keeps everything they have done — trips, scores, achievements — keyed to
 *     them, so it still shows as their experience;
 *   • takes their own documents and QR badge with them.
 *
 * Afterwards they sign in exactly as before, and the next fleet that wants
 * them gives them a joining code (`joinFleet`).
 */

const releaseLogger = logger.child({ module: 'drivers:release' });

const driverWithUser = {
  user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
} as const;

/** What the released driver is told. */
interface ReleaseNotice {
  title: string;
  body: string;
}

/** The owner removing a driver from their fleet. */
export async function releaseDriver(
  auth: AuthContext,
  driverId: string,
): Promise<{ driverId: string; seatOrganizationId: string }> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, include: driverWithUser });
  if (!driver) throw errors.notFound('Driver');
  assertTenantAccess(auth, driver.organizationId, 'Driver');

  if (driver.availability === DriverAvailability.ON_TRIP) {
    throw errors.businessRule('This driver is on an active trip. Finish or reassign it first.');
  }

  const fleet = await prisma.organization.findUniqueOrThrow({
    where: { id: driver.organizationId },
    select: { name: true },
  });
  return releaseFromFleet(driver, {
    title: `You are no longer with ${fleet.name}`,
    body: 'Your trips, scores and documents are still yours. You are available for work — enter a joining code whenever a new fleet takes you on.',
  });
}

/**
 * Every driver of a fleet whose account is being permanently closed.
 *
 * System-initiated — no owner is acting — so it runs without an auth context,
 * and releases a driver even if a trip was left open: the fleet it belonged
 * to no longer exists to finish it.
 */
export async function releaseAllDriversOfFleet(fleetId: string, fleetName: string): Promise<number> {
  const drivers = await prisma.driver.findMany({ where: { organizationId: fleetId }, include: driverWithUser });
  for (const driver of drivers) {
    await releaseFromFleet(driver, {
      title: `${fleetName} has closed its Saarthi account`,
      body: 'Your trips, scores and documents are still yours. You are available for work — enter a joining code whenever a new fleet takes you on.',
    });
  }
  return drivers.length;
}

async function releaseFromFleet(
  driver: {
    id: string;
    userId: string;
    organizationId: string;
    user: { firstName: string; lastName: string; email: string; phone: string | null };
  },
  notice: ReleaseNotice,
): Promise<{ driverId: string; seatOrganizationId: string }> {
  const driverId = driver.id;
  const fleetId = driver.organizationId;
  const seatInviteCode = await allocateInviteCode();

  const seatOrganizationId = await prisma.$transaction(async (tx) => {
    // Off every vehicle of this fleet.
    await tx.truckAssignment.updateMany({
      where: { driverId, status: 'ACTIVE' },
      data: { status: 'ENDED', unassignedAt: new Date() },
    });
    await tx.truck.updateMany({
      where: { currentDriverId: driverId },
      data: { currentDriverId: null, status: 'AVAILABLE' },
    });

    // The membership stays, as the record that they worked here.
    await tx.membership.updateMany({
      where: { userId: driver.userId, organizationId: fleetId },
      data: { status: MembershipStatus.REMOVED, isPrimary: false },
    });

    // A seat of their own, exactly like a driver who registered without a code.
    const seat = await tx.organization.create({
      data: {
        name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
        type: OrganizationType.FLEET_OWNER,
        email: driver.user.email,
        phone: driver.user.phone,
        inviteCode: seatInviteCode,
        isPersonalSeat: true,
        verificationStatus: VerificationStatus.PENDING,
      },
    });
    await tx.membership.create({
      data: {
        userId: driver.userId,
        organizationId: seat.id,
        role: RoleName.DRIVER,
        status: MembershipStatus.ACTIVE,
        isPrimary: true,
      },
    });

    await tx.driver.update({
      where: { id: driverId },
      data: {
        organizationId: seat.id,
        currentTruckId: null,
        availability: DriverAvailability.AVAILABLE,
        archivedAt: null,
      },
    });
    await moveDriverRecords(tx, { driverId, userId: driver.userId, toOrganizationId: seat.id });

    // Their signed-in sessions follow them, so they are not locked out of
    // their own account by a fleet they no longer belong to.
    await tx.session.updateMany({
      where: { userId: driver.userId, organizationId: fleetId, revokedAt: null },
      data: { organizationId: seat.id },
    });

    return seat.id;
  });

  await notify({
    userId: driver.userId,
    type: NotificationType.SYSTEM,
    title: notice.title,
    body: notice.body,
    priority: NotificationPriority.HIGH,
    actionUrl: '/driver',
  }).catch((error: unknown) => {
    releaseLogger.warn({ driverId, error }, 'Could not notify the released driver');
  });

  releaseLogger.info({ driverId, fleetId, seatOrganizationId }, 'Driver released from fleet');
  return { driverId, seatOrganizationId };
}
