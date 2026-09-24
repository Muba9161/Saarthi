import { DocumentOwnerType, QrSubjectType } from '@saarthi/shared';
import type { Db } from '../../database/prisma';

/**
 * Take a driver's own records with them when they change organization.
 *
 * A driver's licence, their documents and their QR badge are theirs, not the
 * fleet's, so they follow the driver — into a fleet they join, and back to
 * their own seat when a fleet releases them. Trips, fuel and toll rows stay
 * with the fleet they were driven for; they remain the driver's experience
 * because they are still keyed to the driver.
 */
export async function moveDriverRecords(
  db: Db,
  input: { driverId: string; userId: string; toOrganizationId: string },
): Promise<void> {
  await Promise.all([
    db.document.updateMany({
      where: {
        OR: [
          { ownerType: DocumentOwnerType.DRIVER, ownerId: input.driverId },
          { ownerType: DocumentOwnerType.USER, ownerId: input.userId },
        ],
      },
      data: { organizationId: input.toOrganizationId },
    }),
    db.qrCode.updateMany({
      where: {
        OR: [
          { subjectType: QrSubjectType.DRIVER, subjectId: input.driverId },
          { subjectType: QrSubjectType.USER, subjectId: input.userId },
        ],
      },
      data: { organizationId: input.toOrganizationId },
    }),
  ]);
}
