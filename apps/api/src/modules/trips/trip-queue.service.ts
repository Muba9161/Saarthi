import {
  ACTIVE_TRIP_STATUSES,
  NotificationPriority,
  NotificationType,
  TripStatus,
  TruckStatus,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { notifyAsync } from '../notifications/notification.service';
import { broadcastTripUpdate, broadcastTruckStatus } from '../../realtime/realtime.service';

/**
 * Trips a driver raises from the app, and the rule that keeps the fleet first.
 *
 * A vehicle carries one trip at a time. A driver may still plan their next
 * one while a fleet trip is open, so theirs waits as a DRAFT — visible to the
 * office, not yet holding the vehicle — and is handed the vehicle when the
 * fleet trip ends. The reverse also holds: a fleet dispatch takes the vehicle
 * from a driver trip that has not started, which goes back to the queue.
 */

const queueLogger = logger.child({ module: 'trip-queue' });

/** Driver trips that hold the vehicle but have not moved, and so may yield. */
const YIELDABLE_STATUSES: TripStatus[] = [TripStatus.ASSIGNED, TripStatus.LOADING];

/**
 * The order queued driver trips run in: the driver's own order, then — for a
 * trip from before the queue could be reordered — the order they were added.
 */
export const QUEUE_ORDER = [
  { queuePosition: { sort: 'asc', nulls: 'last' } },
  { createdAt: 'asc' },
] as const satisfies Prisma.TripOrderByWithRelationInput[];

/** The place at the back of the vehicle's queue, for a trip joining it. */
export async function nextQueuePosition(truckId: string): Promise<number> {
  const last = await prisma.trip.aggregate({
    where: { truckId, driverCreated: true, status: TripStatus.DRAFT },
    _max: { queuePosition: true },
  });
  return (last._max.queuePosition ?? -1) + 1;
}

/** Whether the vehicle's current trip is a real one (not a service run). */
export async function holdsRealTrip(currentTripId: string | null): Promise<boolean> {
  if (!currentTripId) return false;
  const current = await prisma.trip.findUnique({
    where: { id: currentTripId },
    select: { adHoc: true, status: true },
  });
  return (
    current !== null &&
    !current.adHoc &&
    ACTIVE_TRIP_STATUSES.includes(current.status as TripStatus)
  );
}

/**
 * Give the vehicle up to a fleet dispatch, if the trip holding it is a driver
 * trip that has not started.
 *
 * Returns whether the vehicle was freed. A driver trip already under way is
 * never interrupted — the dispatch is refused instead, exactly as for any
 * other trip in progress.
 */
export async function yieldDriverTripToFleet(truckId: string, tripId: string): Promise<boolean> {
  const current = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { driverCreated: true, status: true },
  });
  if (!current?.driverCreated || !YIELDABLE_STATUSES.includes(current.status as TripStatus)) {
    return false;
  }

  // First in line again: it was next before the fleet's trip arrived.
  const first = await prisma.trip.aggregate({
    where: { truckId, driverCreated: true, status: TripStatus.DRAFT },
    _min: { queuePosition: true },
  });
  const queuePosition = (first._min.queuePosition ?? 1) - 1;

  await prisma.$transaction(async (tx) => {
    await tx.trip.update({ where: { id: tripId }, data: { status: TripStatus.DRAFT, queuePosition } });
    await tx.tripEvent.create({
      data: {
        tripId,
        type: 'STATUS_CHANGED',
        description: 'Moved back to the queue: the fleet assigned a trip to this vehicle.',
        metadata: { from: current.status, to: TripStatus.DRAFT } as never,
      },
    });
    await tx.truck.updateMany({
      where: { id: truckId, currentTripId: tripId },
      data: { currentTripId: null },
    });
  });
  return true;
}

/**
 * Hand a free vehicle to the next queued driver trip on it, in the driver's order.
 *
 * Called once a trip on the vehicle completes or is cancelled. Never throws: a
 * failure here must not undo the completion that triggered it, and the trip
 * simply stays queued for the driver or the office to pick up.
 */
export async function promoteQueuedDriverTrip(truckId: string): Promise<void> {
  try {
    const next = await prisma.trip.findFirst({
      where: { truckId, driverCreated: true, status: TripStatus.DRAFT },
      orderBy: [...QUEUE_ORDER],
      select: {
        id: true,
        reference: true,
        organizationId: true,
        driverId: true,
        originAddress: true,
        destinationAddress: true,
      },
    });
    if (!next) return;

    const promoted = await prisma.$transaction(async (tx) => {
      // Guarded on the vehicle still being free, so a dispatch that landed in
      // between keeps the vehicle and this trip keeps waiting.
      const claimed = await tx.truck.updateMany({
        where: { id: truckId, currentTripId: null, archivedAt: null },
        data: {
          status: TruckStatus.ASSIGNED,
          currentTripId: next.id,
          ...(next.driverId ? { currentDriverId: next.driverId } : {}),
        },
      });
      if (claimed.count === 0) return null;

      const trip = await tx.trip.update({
        where: { id: next.id },
        data: { status: TripStatus.ASSIGNED },
        select: { updatedAt: true },
      });
      await tx.tripEvent.create({
        data: {
          tripId: next.id,
          type: 'ASSIGNED',
          description: 'The vehicle is free: this queued trip is next.',
          metadata: { from: TripStatus.DRAFT, to: TripStatus.ASSIGNED } as never,
        },
      });
      if (next.driverId) {
        await tx.driver.update({ where: { id: next.driverId }, data: { availability: 'ON_TRIP' } });
      }
      return trip;
    });
    if (!promoted) return;

    const driver = next.driverId
      ? await prisma.driver.findUnique({ where: { id: next.driverId }, select: { userId: true } })
      : null;
    if (driver) {
      notifyAsync({
        userId: driver.userId,
        organizationId: next.organizationId,
        type: NotificationType.TRIP_ASSIGNED,
        title: 'Your next trip is ready',
        body: `${next.reference}: ${next.originAddress} → ${next.destinationAddress}`,
        priority: NotificationPriority.HIGH,
        actionUrl: `/driver/trips/${next.id}`,
      });
    }

    await broadcastTripUpdate({
      tripId: next.id,
      organizationId: next.organizationId,
      orderId: null,
      truckId,
      driverId: next.driverId,
      status: TripStatus.ASSIGNED,
      updatedAt: promoted.updatedAt.toISOString(),
    });
    await broadcastTruckStatus({
      truckId,
      organizationId: next.organizationId,
      status: TruckStatus.ASSIGNED,
      driverId: next.driverId,
      tripId: next.id,
      updatedAt: promoted.updatedAt.toISOString(),
    });
  } catch (error) {
    queueLogger.warn({ err: error, truckId }, 'Could not hand the vehicle to a queued driver trip');
  }
}
