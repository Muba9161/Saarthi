import { RequirementStatus } from '@saarthi/shared';
import { prisma } from '../../database/prisma';

/**
 * Closing a requirement out once the work it produced has finished.
 *
 * Deliberately its own module with no imports beyond Prisma. The orders and
 * travel modules call into it when their own records reach an end state, and
 * `award.service.ts` imports *them* — so putting this anywhere else would make
 * that a cycle. It also keeps the contract honest: this is the only thing the
 * fulfilment pipelines are allowed to do to a requirement.
 */

/**
 * Mark the requirement behind an order or booking as fulfilled.
 *
 * Silent when there is no requirement, when it is not the requirement's own
 * order, or when it was already closed — every caller sits on a happy path
 * that must not fail because a bookkeeping row moved first.
 */
export async function markRequirementFulfilled(
  link: { orderId?: string | null; bookingId?: string | null },
  description: string,
): Promise<void> {
  const where = link.orderId
    ? { orderId: link.orderId }
    : link.bookingId
      ? { bookingId: link.bookingId }
      : null;
  if (!where) return;

  const requirement = await prisma.requirement.findFirst({
    where,
    select: { id: true, status: true },
  });
  if (!requirement || requirement.status !== RequirementStatus.AWARDED) return;

  await prisma.requirement.update({
    where: { id: requirement.id },
    data: { status: RequirementStatus.FULFILLED, fulfilledAt: new Date() },
  });
  await prisma.requirementEvent.create({
    data: {
      requirementId: requirement.id,
      type: 'FULFILLED',
      description,
      actorUserId: null,
    },
  });
}

/**
 * Reopen nothing, but record that the work fell through.
 *
 * A cancelled order or booking leaves the requirement cancelled rather than
 * back on the board: the bidders it rejected have moved on, and silently
 * re-listing stale demand at a stale price would waste their time.
 */
export async function markRequirementCancelled(
  link: { orderId?: string | null; bookingId?: string | null },
  description: string,
): Promise<void> {
  const where = link.orderId
    ? { orderId: link.orderId }
    : link.bookingId
      ? { bookingId: link.bookingId }
      : null;
  if (!where) return;

  const requirement = await prisma.requirement.findFirst({
    where,
    select: { id: true, status: true },
  });
  if (!requirement || requirement.status !== RequirementStatus.AWARDED) return;

  await prisma.requirement.update({
    where: { id: requirement.id },
    data: {
      status: RequirementStatus.CANCELLED,
      cancelledAt: new Date(),
      cancellationReason: description,
    },
  });
  await prisma.requirementEvent.create({
    data: {
      requirementId: requirement.id,
      type: 'CANCELLED',
      description,
      actorUserId: null,
    },
  });
}
