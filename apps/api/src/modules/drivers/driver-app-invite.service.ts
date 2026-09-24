import { NotificationChannel, NotificationPriority, NotificationType } from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { cache } from '../../infra/cache';
import { notify } from '../notifications/notification.service';
import type { AuthContext } from '../../auth/context';

/**
 * Asking drivers to install the Saarthi Driver App.
 *
 * The app is where a driver's phone reports the vehicle's location — the
 * source telemetry falls back to on a vehicle with no tracker, and the phone a
 * Bluetooth OBD unit reports through. So the owner is offered this beside the
 * tracker when they first open telemetry.
 *
 * Sent in-app, by push and by SMS, since a driver without the app may only be
 * reachable by text. Each driver is asked at most once an hour however often
 * the button is pressed.
 */

const RESEND_AFTER_SECONDS = 60 * 60;

/**
 * Which of the organization's drivers have already been asked to install the
 * app — read from the invitations actually sent, so it survives the one-hour
 * resend window. Lets the vehicle form say "your drivers have been asked"
 * instead of asking the owner to notify them again.
 */
export async function driverAppInviteStatus(
  auth: AuthContext,
): Promise<{ invitedDriverIds: string[]; driverCount: number }> {
  const organizationId = auth.organizationId;
  if (!organizationId) throw errors.organizationRequired();

  const drivers = await prisma.driver.findMany({
    where: { organizationId, archivedAt: null },
    select: { id: true, userId: true },
  });
  if (drivers.length === 0) return { invitedDriverIds: [], driverCount: 0 };

  const invited = await prisma.notification.findMany({
    where: {
      organizationId,
      type: NotificationType.DRIVER_APP_INVITE,
      userId: { in: drivers.map((driver) => driver.userId) },
    },
    select: { userId: true },
    distinct: ['userId'],
  });
  const invitedUsers = new Set(invited.map((row) => row.userId));

  return {
    invitedDriverIds: drivers.filter((driver) => invitedUsers.has(driver.userId)).map((driver) => driver.id),
    driverCount: drivers.length,
  };
}

export async function inviteDriversToApp(
  auth: AuthContext,
  driverIds: string[],
): Promise<{ notified: number; skipped: number }> {
  const organizationId = auth.organizationId;
  if (!organizationId) throw errors.organizationRequired();

  const drivers = await prisma.driver.findMany({
    where: { id: { in: driverIds }, organizationId, archivedAt: null },
    select: { id: true, userId: true },
  });
  if (drivers.length === 0) throw errors.notFound('Driver');

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true },
  });

  let notified = 0;
  for (const driver of drivers) {
    const key = `drivers:app-invite:${driver.id}`;
    if (await cache.get<boolean>(key)) continue;
    await cache.set(key, true, RESEND_AFTER_SECONDS);

    await notify({
      userId: driver.userId,
      organizationId,
      type: NotificationType.DRIVER_APP_INVITE,
      title: 'Install the Saarthi Driver App',
      body: `${organization.name} asks you to install the Saarthi Driver App, so your trips and the vehicle's location are recorded. Open Saarthi to download it.`,
      priority: NotificationPriority.HIGH,
      actionUrl: '/driver',
      channels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.SMS],
    });
    notified += 1;
  }

  return { notified, skipped: drivers.length - notified };
}
