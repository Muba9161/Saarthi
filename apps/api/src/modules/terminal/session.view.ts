import {
  TERMINAL_APPROVAL_SLA,
  type TerminalChecklistOutcome,
  TerminalSessionStatus,
  type TerminalState,
  terminalStateForSession,
  type TerminalSessionPayload,
  type TerminalSessionView,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { terminalDriver } from './driver.view';

/**
 * One projection of a terminal session, used by everything that returns one.
 *
 * Kept in its own module because three different callers need it — the
 * terminal's own state endpoint, the fleet's approval queue and the realtime
 * broadcast — and a projection that exists in three places is a projection
 * where the selfie eventually leaks into the one that should not have it.
 *
 * The selfie is the reason `includeSelfie` is an explicit argument rather than
 * a default. A photograph of a person is disclosed to the driver who took it
 * and to the people deciding on it, and to nobody else; making that a decision
 * the caller has to state means it cannot be granted by forgetting.
 */

export const sessionInclude = {
  driver: {
    select: {
      id: true,
      user: { select: { firstName: true, lastName: true } },
    },
  },
  vehicle: { select: { id: true, registrationNumber: true } },
  checklists: {
    orderBy: { submittedAt: 'desc' },
    take: 1,
    select: { outcome: true, submittedAt: true },
  },
} satisfies Prisma.TerminalSessionInclude;

export type SessionRecord = Prisma.TerminalSessionGetPayload<{
  include: typeof sessionInclude;
}>;

/**
 * Seconds until the approval SLA escalates.
 *
 * Null unless the request is actually waiting on somebody: a decided, cancelled
 * or expired session has no countdown, and showing one would be a clock ticking
 * toward nothing.
 */
export function secondsUntilEscalation(session: {
  status: string;
  submittedAt: Date | null;
  escalatedAt: Date | null;
}): number | null {
  if (session.status !== TerminalSessionStatus.PENDING_APPROVAL) return null;
  if (!session.submittedAt) return null;
  const deadline =
    session.submittedAt.getTime() + TERMINAL_APPROVAL_SLA.escalateAfterMinutes * 60_000;
  return Math.round((deadline - Date.now()) / 1000);
}

/** The decider's name, when there is one. Loaded separately to keep the include small. */
async function deciderName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  return user ? `${user.firstName} ${user.lastName}`.trim() : null;
}

export async function toSessionView(
  session: SessionRecord,
  options: { includeSelfie: boolean },
): Promise<TerminalSessionView> {
  const [driver, decidedByName] = await Promise.all([
    // A driver row that has since been archived must not take down the whole
    // approval queue. The session still happened, and it is still evidence.
    terminalDriver(session.driverId).catch(() => null),
    deciderName(session.decidedById),
  ]);

  const latestChecklist = session.checklists[0];

  return {
    id: session.id,
    status: session.status as TerminalSessionStatus,
    state: terminalStateForSession(session.status as TerminalSessionStatus, {
      checklistComplete: session.checklistCompletedAt !== null,
    }),
    driver,
    vehicleId: session.vehicleId,
    registrationNumber: session.vehicle.registrationNumber,
    terminalDeviceId: session.terminalDeviceId,
    requestedAt: session.requestedAt.toISOString(),
    submittedAt: session.submittedAt?.toISOString() ?? null,
    decidedAt: session.decidedAt?.toISOString() ?? null,
    decidedByName,
    decisionNote: session.decisionNote,
    rejectionReason: session.rejectionReason,
    // A media reference, not the bytes. The caller fetches it through the media
    // endpoint, which applies the asset's own visibility rules on top.
    selfieUrl:
      options.includeSelfie && session.selfieMediaId
        ? `/api/v1/media/${session.selfieMediaId}/file`
        : null,
    selfieCapturedAt: session.selfieCapturedAt?.toISOString() ?? null,
    expiresAt: session.expiresAt?.toISOString() ?? null,
    remindedAt: session.remindedAt?.toISOString() ?? null,
    escalatedAt: session.escalatedAt?.toISOString() ?? null,
    secondsUntilEscalation: secondsUntilEscalation(session),
    checklistCompletedAt: session.checklistCompletedAt?.toISOString() ?? null,
    checklistOutcome: (latestChecklist?.outcome as TerminalChecklistOutcome) ?? null,
    tripStartedAt: session.tripStartedAt?.toISOString() ?? null,
    tripCompletedAt: session.tripCompletedAt?.toISOString() ?? null,
  };
}

/**
 * The realtime payload for a session.
 *
 * Deliberately smaller than the view: no selfie, no licence detail, no score.
 * This goes out on a fleet-wide channel, and everything on it is visible to
 * every socket that fleet has open.
 */
export function toSessionPayload(session: SessionRecord): TerminalSessionPayload {
  const state: TerminalState = terminalStateForSession(
    session.status as TerminalSessionStatus,
    { checklistComplete: session.checklistCompletedAt !== null },
  );

  return {
    sessionId: session.id,
    organizationId: session.organizationId,
    terminalDeviceId: session.terminalDeviceId,
    vehicleId: session.vehicleId,
    registrationNumber: session.vehicle.registrationNumber,
    driverId: session.driverId,
    driverName:
      `${session.driver.user.firstName} ${session.driver.user.lastName}`.trim(),
    status: session.status as TerminalSessionStatus,
    state,
    requestedAt: session.requestedAt.toISOString(),
    decidedAt: session.decidedAt?.toISOString() ?? null,
    decidedByName: null,
    rejectionReason: session.rejectionReason,
    secondsUntilEscalation: secondsUntilEscalation(session),
    updatedAt: session.updatedAt.toISOString(),
  };
}
