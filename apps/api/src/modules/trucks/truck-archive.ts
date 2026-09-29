import { TruckStatus } from '@saarthi/shared';
import type { Prisma } from '../../database/prisma';

/**
 * Take a vehicle off the road: end its driver assignment, archive the row and
 * record why.
 *
 * One implementation for every reason a vehicle is archived — the operator
 * pressing Archive, an ownership deadline lapsing, a plate being released to
 * its verified owner — so none of them can leave a driver still pointing at a
 * vehicle that is gone. Runs inside the caller's transaction; `data` carries
 * whatever else that reason changes on the row.
 */
export async function archiveTruckRecord(
  db: Prisma.TransactionClient,
  truck: { id: string; organizationId: string },
  event: { type: string; description: string; actorUserId: string | null },
  data: Prisma.TruckUpdateInput = {},
): Promise<void> {
  const now = new Date();

  await db.truckAssignment.updateMany({
    where: { truckId: truck.id, status: 'ACTIVE' },
    data: { status: 'ENDED', unassignedAt: now },
  });
  await db.driver.updateMany({
    where: { currentTruckId: truck.id },
    data: { currentTruckId: null },
  });
  await db.truck.update({
    where: { id: truck.id },
    data: { archivedAt: now, status: TruckStatus.OFFLINE, currentDriverId: null, ...data },
  });
  await db.truckEvent.create({
    data: {
      truckId: truck.id,
      organizationId: truck.organizationId,
      type: event.type,
      description: event.description,
      actorUserId: event.actorUserId,
    },
  });
}
