import { DeviceAssignmentStatus } from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { unpairSelf } from './pairing.service';

const driverPhoneLogger = logger.child({ module: 'devices:driver-phone' });

/**
 * End assigned drivers' phone pairings when the assignment behind them changes.
 *
 * An assigned driver's phone stays paired across shifts, so something has to
 * end it when the owner moves that driver: unassigning them, assigning someone
 * else, approving a different driver onto the vehicle, or releasing the driver
 * from the fleet. Each goes through the ordinary unpair, so the phone's token
 * is revoked and the Hardware tab shows it as previously fitted.
 *
 * Only standing pairings (`releaseOnSignOff` false) are touched; a phone paired
 * for one shift already ends with that shift.
 *
 * Called after the caller's transaction commits — `unpairSelf` opens its own —
 * and best-effort per phone: one that fails to release must not undo the
 * assignment change the owner just made.
 */
export async function releaseDriverPhones(
  scope: { vehicleId: string; exceptDriverId?: string } | { driverId: string },
  reason: string,
): Promise<number> {
  const rows = await prisma.deviceAssignment.findMany({
    where: {
      status: DeviceAssignmentStatus.ACTIVE,
      releaseOnSignOff: false,
      ...('driverId' in scope
        ? { driverId: scope.driverId }
        : {
            vehicleId: scope.vehicleId,
            AND: [
              { driverId: { not: null } },
              ...(scope.exceptDriverId ? [{ driverId: { not: scope.exceptDriverId } }] : []),
            ],
          }),
    },
    select: { deviceId: true, vehicleId: true },
  });

  let released = 0;
  for (const row of rows) {
    try {
      await unpairSelf(row.deviceId, reason);
      released += 1;
    } catch (error) {
      driverPhoneLogger.warn(
        { err: error, deviceId: row.deviceId, vehicleId: row.vehicleId },
        'Could not release a driver phone after an assignment change',
      );
    }
  }
  return released;
}
