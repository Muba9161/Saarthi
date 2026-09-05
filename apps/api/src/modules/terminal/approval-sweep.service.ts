import {
  NotificationPriority,
  NotificationType,
  OPERATOR_MANAGEMENT_ROLES,
  OPERATOR_OWNER_ROLES,
  TERMINAL_APPROVAL_SLA,
  TERMINAL_SESSION_IDLE_HOURS,
  TerminalSessionEventType,
  TerminalSessionStatus,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { notify, notifyOrganization } from '../notifications/notification.service';
import { broadcastTerminalSession } from '../../realtime/realtime.service';
import { invalidateTerminalState } from './terminal.service';
import { sessionInclude, toSessionPayload } from './session.view';

/**
 * The fifteen-minute approval SLA (specification section 15).
 *
 * Read this once and then read the next paragraph twice.
 *
 * **This sweep never approves anybody.** It reminds, it escalates, and it
 * eventually closes a request nobody answered. That is the whole design. A
 * timer that granted authorisation would let an unlicensed, suspended or simply
 * unexpected person take a forty-tonne vehicle out because the office was
 * empty — and it would do it silently, at four in the morning, which is exactly
 * when nobody is at the office. Section 15 says so in as many words: fifteen
 * minutes is an escalation mechanism, not automatic approval. Expiry fails
 * closed.
 *
 * Three ladders, in order:
 *
 *   t+5   remind whoever can decide
 *   t+15  escalate to owner-level roles, louder
 *   t+120 close the request; the driver is told to ask again
 *
 * Each rung is written to the session row before the notification goes out, so
 * a sweep that crashes half-way through cannot send the same reminder twice.
 */

const sweepLogger = logger.child({ module: 'terminal-approval-sweep' });

/** Bounded so one very busy fleet cannot starve the others in a single pass. */
const BATCH = 200;

export interface ApprovalSweepResult {
  reminded: number;
  escalated: number;
  expired: number;
  idleClosed: number;
}

async function announce(sessionId: string): Promise<void> {
  const session = await prisma.terminalSession.findUnique({
    where: { id: sessionId },
    include: sessionInclude,
  });
  if (!session) return;
  await invalidateTerminalState(session.terminalDeviceId);
  await broadcastTerminalSession(toSessionPayload(session)).catch((error: unknown) => {
    sweepLogger.warn({ err: error, sessionId }, 'Could not broadcast SLA change');
  });
}

export async function runTerminalApprovalSweep(): Promise<ApprovalSweepResult> {
  const now = Date.now();
  const result: ApprovalSweepResult = { reminded: 0, escalated: 0, expired: 0, idleClosed: 0 };

  // --- Reminders ----------------------------------------------------------
  const remindBefore = new Date(now - TERMINAL_APPROVAL_SLA.remindAfterMinutes * 60_000);
  const toRemind = await prisma.terminalSession.findMany({
    where: {
      status: TerminalSessionStatus.PENDING_APPROVAL,
      remindedAt: null,
      submittedAt: { not: null, lte: remindBefore },
    },
    take: BATCH,
    include: sessionInclude,
  });

  for (const session of toRemind) {
    // Written first. A reminder that goes out twice because the sweep died
    // between the notification and the update is a fleet that learns to ignore
    // this notification.
    await prisma.terminalSession.update({
      where: { id: session.id },
      data: { remindedAt: new Date() },
    });

    const driverName =
      `${session.driver.user.firstName} ${session.driver.user.lastName}`.trim();

    await notifyOrganization(session.organizationId, {
      type: NotificationType.TERMINAL_DRIVER_REQUEST_REMINDER,
      title: `${driverName} is still waiting at ${session.vehicle.registrationNumber}`,
      body: `Submitted ${TERMINAL_APPROVAL_SLA.remindAfterMinutes} minutes ago. Approve or reject the assignment.`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/fleet/terminal-approvals?session=${session.id}`,
      roles: OPERATOR_MANAGEMENT_ROLES,
    });

    await prisma.terminalSessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: TerminalSessionEventType.REMINDER_SENT,
        description: 'Reminder sent to the fleet.',
      },
    });

    result.reminded += 1;
  }

  // --- Escalation ---------------------------------------------------------
  const escalateBefore = new Date(now - TERMINAL_APPROVAL_SLA.escalateAfterMinutes * 60_000);
  const toEscalate = await prisma.terminalSession.findMany({
    where: {
      status: TerminalSessionStatus.PENDING_APPROVAL,
      escalatedAt: null,
      submittedAt: { not: null, lte: escalateBefore },
    },
    take: BATCH,
    include: sessionInclude,
  });

  for (const session of toEscalate) {
    await prisma.terminalSession.update({
      where: { id: session.id },
      data: { escalatedAt: new Date() },
    });

    const driverName =
      `${session.driver.user.firstName} ${session.driver.user.lastName}`.trim();

    /*
     * Owner-level only, and CRITICAL.
     *
     * The narrower audience is the point of an escalation: the managers were
     * already told twice and did not answer, so telling them a third time is
     * not escalating anything. CRITICAL routes through the urgent channels,
     * which is the only way this reaches somebody who is not looking at a
     * screen.
     */
    await notifyOrganization(session.organizationId, {
      type: NotificationType.TERMINAL_DRIVER_REQUEST_ESCALATED,
      title: `Unanswered for ${TERMINAL_APPROVAL_SLA.escalateAfterMinutes} minutes: ${session.vehicle.registrationNumber}`,
      body: `${driverName} is waiting at the vehicle and cannot start work until somebody approves or rejects the request.`,
      priority: NotificationPriority.CRITICAL,
      actionUrl: `/fleet/terminal-approvals?session=${session.id}`,
      roles: OPERATOR_OWNER_ROLES,
    });

    await prisma.terminalSessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: TerminalSessionEventType.ESCALATED,
        description: `Escalated to fleet owners after ${TERMINAL_APPROVAL_SLA.escalateAfterMinutes} minutes without a decision.`,
      },
    });

    await announce(session.id);
    result.escalated += 1;
  }

  // --- Expiry -------------------------------------------------------------
  //
  // Fails closed. The driver is told the request lapsed and to ask again; they
  // are never let through.
  const toExpire = await prisma.terminalSession.findMany({
    where: {
      status: {
        in: [
          TerminalSessionStatus.DRIVER_IDENTIFIED,
          TerminalSessionStatus.SELFIE_SUBMITTED,
          TerminalSessionStatus.PENDING_APPROVAL,
        ],
      },
      expiresAt: { not: null, lte: new Date(now) },
    },
    take: BATCH,
    include: sessionInclude,
  });

  for (const session of toExpire) {
    await prisma.terminalSession.update({
      where: { id: session.id },
      data: {
        status: TerminalSessionStatus.EXPIRED,
        endedAt: new Date(),
        endReason: `No decision within ${TERMINAL_APPROVAL_SLA.expireAfterMinutes} minutes.`,
      },
    });

    await prisma.terminalSessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: TerminalSessionEventType.EXPIRED,
        description: 'Request closed without a decision. The driver was not authorised.',
      },
    });

    await notify({
      userId: session.driverUserId,
      type: NotificationType.TERMINAL_DRIVER_REQUEST_EXPIRED,
      title: `Your request for ${session.vehicle.registrationNumber} expired`,
      body: 'Nobody answered in time, so the request was closed. Scan the vehicle QR again to ask once more.',
      priority: NotificationPriority.HIGH,
      actionUrl: '/driver',
    });

    await announce(session.id);
    result.expired += 1;
  }

  // --- Idle sessions ------------------------------------------------------
  //
  // A terminal left showing an approved driver who went home two shifts ago is
  // the failure section 47 names: an app restart must not resurrect stale
  // authorisation, and neither must an app that never restarted.
  const idleBefore = new Date(now - TERMINAL_SESSION_IDLE_HOURS * 3_600_000);
  const idle = await prisma.terminalSession.findMany({
    where: {
      status: { in: [TerminalSessionStatus.APPROVED, TerminalSessionStatus.READY] },
      updatedAt: { lte: idleBefore },
    },
    take: BATCH,
    include: sessionInclude,
  });

  for (const session of idle) {
    await prisma.$transaction(async (tx) => {
      if (session.truckAssignmentId) {
        await tx.truckAssignment.updateMany({
          where: { id: session.truckAssignmentId, status: 'ACTIVE' },
          data: { status: 'ENDED', unassignedAt: new Date() },
        });
        await tx.truck.updateMany({
          where: { id: session.vehicleId, currentDriverId: session.driverId },
          data: { currentDriverId: null },
        });
        await tx.driver.updateMany({
          where: { id: session.driverId, currentTruckId: session.vehicleId },
          data: { currentTruckId: null },
        });
      }
      await tx.terminalSession.update({
        where: { id: session.id },
        data: {
          status: TerminalSessionStatus.COMPLETED,
          endedAt: new Date(),
          endReason: `Closed automatically after ${TERMINAL_SESSION_IDLE_HOURS} hours without activity.`,
        },
      });
      await tx.terminalSessionEvent.create({
        data: {
          sessionId: session.id,
          eventType: TerminalSessionEventType.EXPIRED,
          description: 'Session closed after a long period without activity.',
        },
      });
    });

    await announce(session.id);
    result.idleClosed += 1;
  }

  if (
    result.reminded > 0 ||
    result.escalated > 0 ||
    result.expired > 0 ||
    result.idleClosed > 0
  ) {
    sweepLogger.info(result, 'Terminal approval sweep complete');
  }

  return result;
}
