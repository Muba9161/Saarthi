import {
  BACKHAUL_COMMISSION_RULE,
  NotificationPriority,
  NotificationType,
  OPEN_RETURN_LOAD_STATUSES,
  ReturnLoadMatchStatus,
  ReturnLoadStatus,
  TripLegType,
  formatPercent,
  returnLoadStateMachine,
} from '@saarthi/shared';
import { prisma, type Db } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { notifyOrganization } from '../notifications/notification.service';

/**
 * Backhaul lifecycle: a bid placed on a vehicle's return leg, the booking when
 * a customer accepts it, and the return trip completing.
 *
 * Kept apart from the matching service on purpose. The requirement and order
 * pipelines call into these functions, and the matching service itself reads
 * orders — so this file depends on nothing but the database, which keeps the
 * dependency running one way.
 */

const lifecycleLogger = logger.child({ module: 'return-loads:lifecycle' });

/**
 * A bid may be placed on a vehicle's return leg only while that backhaul is
 * enabled and still looking for a load, and only offering that vehicle.
 */
export async function assertBackhaulBid(input: {
  organizationId: string;
  returnLoadRequestId: string;
  vehicleId: string;
}): Promise<void> {
  const request = await prisma.returnLoadRequest.findUnique({
    where: { id: input.returnLoadRequestId },
    select: {
      organizationId: true,
      truckId: true,
      status: true,
      availableUntil: true,
      commissionAcceptedAt: true,
    },
  });
  if (!request || request.organizationId !== input.organizationId) {
    throw errors.notFound('Backhaul');
  }
  if (!request.commissionAcceptedAt) {
    throw errors.businessRule(
      'Enable backhaul on the completed trip before bidding on its return leg.',
    );
  }
  if (
    !OPEN_RETURN_LOAD_STATUSES.includes(request.status as ReturnLoadStatus) ||
    request.availableUntil.getTime() < Date.now()
  ) {
    throw errors.businessRule('This backhaul is no longer looking for a load.');
  }
  if (request.truckId !== input.vehicleId) {
    throw errors.businessRule('A backhaul bid has to offer the vehicle that is returning.');
  }
}

export interface BookedBackhaul {
  returnLoadRequestId: string;
  reference: string;
  organizationId: string;
  orderId: string;
}

/**
 * Book the backhaul an accepted quote was offered on.
 *
 * Runs inside the acceptance transaction, so the order, its trip and the
 * request can never disagree about whether this was a return load. A backhaul
 * that has since been cancelled or has expired is not booked: the job goes
 * ahead as an ordinary one, at the ordinary commission.
 */
export async function bookBackhaul(
  tx: Db,
  input: { returnLoadRequestId: string; orderId: string; tripId: string },
): Promise<BookedBackhaul | null> {
  const request = await tx.returnLoadRequest.findUnique({
    where: { id: input.returnLoadRequestId },
    select: { id: true, reference: true, organizationId: true, status: true, outboundTripId: true },
  });
  if (!request) return null;

  const check = returnLoadStateMachine.assertTransition(
    request.status as ReturnLoadStatus,
    ReturnLoadStatus.BOOKED,
  );
  if (!check.allowed) {
    lifecycleLogger.info(
      { returnLoadRequestId: request.id, status: request.status, orderId: input.orderId },
      'Backhaul no longer active at acceptance; the job runs as an ordinary order',
    );
    return null;
  }

  const now = new Date();
  await tx.returnLoadRequest.update({
    where: { id: request.id },
    data: { status: ReturnLoadStatus.BOOKED, matchedOrderId: input.orderId },
  });
  await tx.order.update({
    where: { id: input.orderId },
    data: { isReturnLoad: true, returnLoadRequestId: request.id },
  });
  await tx.trip.update({
    where: { id: input.tripId },
    data: {
      legType: TripLegType.RETURN,
      parentTripId: request.outboundTripId,
      returnLoadRequestId: request.id,
    },
  });

  // The order that won, if it came from a scored match, and every other
  // suggestion for this vehicle — it is no longer free.
  await tx.returnLoadMatch.updateMany({
    where: { returnLoadRequestId: request.id, orderId: input.orderId },
    data: { status: ReturnLoadMatchStatus.ACCEPTED, respondedAt: now },
  });
  await tx.returnLoadMatch.updateMany({
    where: {
      returnLoadRequestId: request.id,
      orderId: { not: input.orderId },
      status: { in: [ReturnLoadMatchStatus.SUGGESTED, ReturnLoadMatchStatus.OFFERED] },
    },
    data: { status: ReturnLoadMatchStatus.EXPIRED },
  });

  return {
    returnLoadRequestId: request.id,
    reference: request.reference,
    organizationId: request.organizationId,
    orderId: input.orderId,
  };
}

/** Tell the owner their vehicle will not come home empty. Called after the booking commits. */
export async function notifyBackhaulBooked(
  booked: BookedBackhaul,
  orderReference: string,
): Promise<void> {
  await notifyOrganization(booked.organizationId, {
    type: NotificationType.RETURN_LOAD_BOOKED,
    title: 'Backhaul booked',
    body: `${orderReference} fills the return leg of ${booked.reference}. Saarthi's commission on this job is ${formatPercent(BACKHAUL_COMMISSION_RULE.rate * 100)} of your profit, taken from the customer's final payment.`,
    priority: NotificationPriority.NORMAL,
    actionUrl: `/orders/${booked.orderId}`,
    data: { returnLoadRequestId: booked.returnLoadRequestId, orderId: booked.orderId },
  });
}

/** A return leg delivered: its backhaul is complete. */
export async function completeBackhaulForTrip(trip: {
  id: string;
  legType: string;
  returnLoadRequestId: string | null;
}): Promise<void> {
  if (trip.legType !== TripLegType.RETURN || !trip.returnLoadRequestId) return;

  // Conditional on BOOKED, so a repeated completion cannot move it twice.
  const moved = await prisma.returnLoadRequest.updateMany({
    where: { id: trip.returnLoadRequestId, status: ReturnLoadStatus.BOOKED },
    data: { status: ReturnLoadStatus.COMPLETED, completedAt: new Date() },
  });
  if (moved.count === 1) {
    lifecycleLogger.info(
      { tripId: trip.id, returnLoadRequestId: trip.returnLoadRequestId },
      'Backhaul completed with its return trip',
    );
  }
}
