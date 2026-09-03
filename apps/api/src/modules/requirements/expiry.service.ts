import {
  LIVE_BID_STATUSES,
  NotificationPriority,
  NotificationType,
  RequirementBidStatus,
  RequirementStatus,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { notifyOrganization } from '../notifications/notification.service';

const sweepLogger = logger.child({ module: 'requirements' });

/**
 * Close requirements whose bidding window has passed.
 *
 * Without this a requirement nobody answered sits OPEN for ever: the customer
 * keeps waiting for offers that will not come, and every provider's board
 * slowly fills with dead demand for dates that have gone by. Both of those
 * make the board less trusted the longer it runs.
 *
 * Requirements that were awarded are left alone — a closed bidding window says
 * nothing about work already agreed.
 */
export async function runRequirementExpirySweep(): Promise<{
  expired: number;
  bidsExpired: number;
}> {
  const now = new Date();

  const due = await prisma.requirement.findMany({
    where: {
      bidsCloseAt: { lt: now },
      status: { in: [RequirementStatus.OPEN, RequirementStatus.BIDDING] as never },
    },
    select: {
      id: true,
      reference: true,
      title: true,
      customerOrganizationId: true,
      bidCount: true,
    },
    take: 500,
  });

  if (due.length === 0) return { expired: 0, bidsExpired: 0 };

  const ids = due.map((requirement) => requirement.id);

  // Which bidders to tell, gathered before the update rewrites their status.
  const liveBids = await prisma.requirementBid.findMany({
    where: { requirementId: { in: ids }, status: { in: LIVE_BID_STATUSES as never } },
    select: { id: true, requirementId: true, bidderOrganizationId: true },
  });

  const [, bidResult] = await prisma.$transaction([
    prisma.requirement.updateMany({
      where: { id: { in: ids } },
      data: { status: RequirementStatus.EXPIRED },
    }),
    prisma.requirementBid.updateMany({
      where: { requirementId: { in: ids }, status: { in: LIVE_BID_STATUSES as never } },
      data: { status: RequirementBidStatus.EXPIRED },
    }),
  ]);

  await prisma.requirementEvent.createMany({
    data: due.map((requirement) => ({
      requirementId: requirement.id,
      type: 'EXPIRED' as const,
      description:
        requirement.bidCount > 0
          ? `Bidding closed with ${requirement.bidCount} offer(s) unawarded.`
          : 'Bidding closed with no offers.',
      actorUserId: null,
    })),
  });

  for (const requirement of due) {
    void notifyOrganization(requirement.customerOrganizationId, {
      type: NotificationType.REQUIREMENT_CANCELLED,
      title: 'Bidding closed',
      body:
        requirement.bidCount > 0
          ? `${requirement.reference} closed with ${requirement.bidCount} offer(s) you did not award. Repost it to try again.`
          : `${requirement.reference} closed without any offers. Try reposting with a wider window.`,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/requirements/${requirement.id}`,
    });
  }

  for (const organizationId of new Set(liveBids.map((bid) => bid.bidderOrganizationId))) {
    void notifyOrganization(organizationId, {
      type: NotificationType.REQUIREMENT_CANCELLED,
      title: 'Bidding closed',
      body: 'A requirement you bid on closed without being awarded.',
      priority: NotificationPriority.LOW,
      actionUrl: '/requirements/board',
    });
  }

  const result = { expired: due.length, bidsExpired: bidResult.count };
  sweepLogger.info(result, 'Requirement expiry sweep complete');
  return result;
}
