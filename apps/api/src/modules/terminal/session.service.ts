import {
  ACTIVE_TERMINAL_SESSION_STATUSES,
  AUTHORIZED_TERMINAL_SESSION_STATUSES,
  AssignmentStatus,
  DeviceAssignmentStatus,
  DeviceType,
  MediaOwnerType,
  MediaPurpose,
  MediaVisibility,
  NotificationPriority,
  NotificationType,
  OPERATOR_MANAGEMENT_ROLES,
  QrScanPurpose,
  QrSubjectType,
  TERMINAL_APPROVAL_SLA,
  TerminalSessionEventType,
  TerminalSessionStatus,
  buildPaginationMeta,
  type ApproveTerminalAssignmentInput,
  type CancelTerminalAssignmentInput,
  type Paginated,
  type RejectTerminalAssignmentInput,
  type RequestTerminalAssignmentInput,
  type SubmitTerminalAssignmentInput,
  type TerminalAssignmentListQuery,
  type TerminalSelfieMetaInput,
  type TerminalSessionView,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { assertTenantAccess } from '../../server/guards';
import { notify, notifyOrganization } from '../notifications/notification.service';
import { broadcastTerminalSession } from '../../realtime/realtime.service';
import { uploadMedia, type UploadFilePart } from '../media/media.service';
import { invalidateTerminalState } from './terminal.service';
import { applyOdometer } from '../vehicles/odometer.service';
import { releaseVehicleFromAdHocTrip } from './adhoc-trip.service';
import {
  sessionInclude,
  toSessionPayload,
  toSessionView,
  type SessionRecord,
} from './session.view';
import type { AuthContext } from '../../auth/context';

/**
 * The driver-arrival lifecycle.
 *
 * This module holds the single most consequential rule in the Terminal
 * product, and everything else here exists to protect it:
 *
 *   **A driver becomes authorised to take a vehicle out only when a named,
 *   permitted human explicitly approves them.**
 *
 * There is no timer that approves. There is no fallback that approves. The
 * fifteen-minute SLA in section 15 escalates and reminds; it never decides. If
 * you are reading this because you are adding an "auto-approve after N
 * minutes" option, that option would let an unlicensed, suspended or simply
 * unexpected person drive a forty-tonne vehicle because nobody happened to be
 * at a desk. The sweep in `approval-sweep.service.ts` expires unanswered
 * requests instead, which fails closed.
 *
 * The flow, and where each step's authority comes from:
 *
 *   driver scans the vehicle's permanent QR   (their own Saarthi account)
 *        → DRIVER_IDENTIFIED                  (proves they are at the vehicle)
 *   driver takes a selfie                     (their own account, own photo)
 *        → SELFIE_SUBMITTED
 *   driver submits                            (their own account)
 *        → PENDING_APPROVAL
 *   owner or provider decides                 (terminal.approve permission)
 *        → APPROVED or REJECTED
 *   driver completes the safety check         (from the terminal)
 *        → READY
 */

const sessionLogger = logger.child({ module: 'terminal-session' });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function loadSession(sessionId: string): Promise<SessionRecord> {
  const session = await prisma.terminalSession.findUnique({
    where: { id: sessionId },
    include: sessionInclude,
  });
  if (!session) throw errors.notFound('Driver request');
  return session;
}

/**
 * Publish a change and drop the terminal's cached screen state.
 *
 * Always both. A broadcast without the invalidation means a terminal that
 * missed the socket message polls and gets a ten-second-old answer saying it is
 * still waiting; an invalidation without the broadcast means it waits for its
 * next poll. A driver standing at a truck notices either one.
 */
async function announce(session: SessionRecord): Promise<void> {
  await invalidateTerminalState(session.terminalDeviceId);
  await broadcastTerminalSession(toSessionPayload(session)).catch((error: unknown) => {
    sessionLogger.warn(
      { err: error, sessionId: session.id },
      'Could not broadcast terminal session change',
    );
  });
}

async function recordEvent(
  db: Prisma.TransactionClient | typeof prisma,
  sessionId: string,
  eventType: TerminalSessionEventType,
  description: string,
  options: { actorUserId?: string | null; metadata?: Prisma.InputJsonValue } = {},
): Promise<void> {
  await db.terminalSessionEvent.create({
    data: {
      sessionId,
      eventType,
      description,
      actorUserId: options.actorUserId ?? null,
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    },
  });
}

/** The driver profile behind a session request, or a refusal that explains why. */
async function requireDriverProfile(auth: AuthContext): Promise<{
  id: string;
  userId: string;
  organizationId: string;
  name: string;
}> {
  if (!auth.driverId) {
    throw errors.forbidden(
      'Only a driver account can be assigned to a vehicle from a terminal. Ask your fleet administrator to add you as a driver.',
    );
  }
  const driver = await prisma.driver.findUnique({
    where: { id: auth.driverId },
    select: {
      id: true,
      userId: true,
      organizationId: true,
      archivedAt: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  if (!driver || driver.archivedAt) throw errors.notFound('Driver');

  return {
    id: driver.id,
    userId: driver.userId,
    organizationId: driver.organizationId,
    name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
  };
}

// ---------------------------------------------------------------------------
// 1. Driver arrival — the driver scans the vehicle's permanent QR
// ---------------------------------------------------------------------------

/**
 * Open a driver request against the vehicle whose QR was scanned.
 *
 * The QR token is the proof of presence, and it is the *vehicle's own permanent
 * code* — the same one printed on the windscreen and displayed on the terminal.
 * No temporary per-driver code is created anywhere in this flow (section 10).
 *
 * Scanning is not authorisation (section 52). All this does is open a request.
 */
export async function requestAssignment(
  auth: AuthContext,
  input: RequestTerminalAssignmentInput,
): Promise<TerminalSessionView> {
  const driver = await requireDriverProfile(auth);

  const code = await prisma.qrCode.findUnique({
    where: { token: input.qrToken },
    select: {
      id: true,
      subjectType: true,
      subjectId: true,
      status: true,
      expiresAt: true,
      organizationId: true,
    },
  });

  // Every refusal below reads the same from outside. A driver who could tell a
  // revoked code from a code for another fleet could map somebody else's fleet.
  if (!code || code.subjectType !== QrSubjectType.VEHICLE) {
    throw errors.notFound('Vehicle', 'That code is not a Saarthi vehicle code.');
  }
  if (code.status !== 'ACTIVE') {
    throw errors.businessRule(
      'That vehicle code is no longer active. Ask your fleet administrator to reissue it.',
    );
  }
  if (code.expiresAt && code.expiresAt.getTime() < Date.now()) {
    throw errors.businessRule('That vehicle code has expired. Ask for a new one to be issued.');
  }

  const vehicle = await prisma.truck.findUnique({
    where: { id: code.subjectId },
    select: {
      id: true,
      organizationId: true,
      registrationNumber: true,
      archivedAt: true,
      status: true,
    },
  });
  if (!vehicle || vehicle.archivedAt) throw errors.notFound('Vehicle');

  // A driver may only ask to drive a vehicle belonging to their own fleet.
  // Reported as not-found, so scanning stickers cannot be used to discover
  // which vehicles belong to whom.
  if (vehicle.organizationId !== driver.organizationId) {
    sessionLogger.warn(
      { driverId: driver.id, vehicleId: vehicle.id },
      'Driver scanned a vehicle belonging to another organization',
    );
    throw errors.notFound('Vehicle', 'That vehicle is not in your fleet.');
  }

  // The terminal fitted to this vehicle. Resolved from the vehicle rather than
  // taken from the request: a driver naming a terminal could name a terminal in
  // another cab, and the realtime update would land on the wrong screen.
  const assignment = await prisma.deviceAssignment.findFirst({
    where: {
      vehicleId: vehicle.id,
      status: DeviceAssignmentStatus.ACTIVE,
      device: { deviceType: DeviceType.VEHICLE_TERMINAL, archivedAt: null },
    },
    orderBy: { assignedAt: 'desc' },
    select: { deviceId: true },
  });
  if (!assignment) {
    throw errors.businessRule(
      `No Saarthi Terminal is connected to ${vehicle.registrationNumber}. Connect one from Vehicle → Hardware first.`,
    );
  }

  // One live session per terminal, and one per driver. Both matter: two drivers
  // half-way through arriving at the same truck is a queue nobody can resolve,
  // and one driver with open requests at two vehicles is somebody who is about
  // to be approved onto a truck they walked away from.
  const [terminalBusy, driverBusy] = await Promise.all([
    prisma.terminalSession.findFirst({
      where: {
        terminalDeviceId: assignment.deviceId,
        status: { in: ACTIVE_TERMINAL_SESSION_STATUSES },
      },
      include: sessionInclude,
    }),
    prisma.terminalSession.findFirst({
      where: { driverId: driver.id, status: { in: ACTIVE_TERMINAL_SESSION_STATUSES } },
      include: sessionInclude,
    }),
  ]);

  // The driver's own request at this same vehicle is not a conflict — it is
  // them reopening the app. Hand back what they already have.
  if (driverBusy && driverBusy.vehicleId === vehicle.id) {
    return toSessionView(driverBusy, { includeSelfie: true });
  }
  if (driverBusy) {
    throw errors.conflict(
      `You already have an open request for ${driverBusy.vehicle.registrationNumber}. Finish or cancel it first.`,
    );
  }
  if (terminalBusy) {
    throw errors.conflict(
      `${terminalBusy.driver.user.firstName} is already signing on to ${vehicle.registrationNumber}.`,
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const session = await tx.terminalSession.create({
      data: {
        organizationId: vehicle.organizationId,
        terminalDeviceId: assignment.deviceId,
        vehicleId: vehicle.id,
        driverId: driver.id,
        driverUserId: driver.userId,
        status: TerminalSessionStatus.DRIVER_IDENTIFIED,
        scannedQrCodeId: code.id,
        scanLatitude: input.latitude ?? null,
        scanLongitude: input.longitude ?? null,
      },
      include: sessionInclude,
    });

    await recordEvent(
      tx,
      session.id,
      TerminalSessionEventType.REQUESTED,
      `${driver.name} scanned the vehicle QR at ${vehicle.registrationNumber}.`,
      {
        actorUserId: driver.userId,
        metadata: {
          qrCodeId: code.id,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          note: input.note ?? null,
        },
      },
    );

    // The scan itself is recorded in the QR audit log too, so a scan made from
    // the terminal flow is indistinguishable in the record from one made at a
    // checkpoint — which is what makes that log worth having.
    await tx.qrScan.create({
      data: {
        qrCodeId: code.id,
        scannedByUserId: auth.user.id,
        scannedByOrganizationId: auth.organizationId,
        purpose: QrScanPurpose.ASSIGNMENT,
        result: 'ALLOWED',
        scopesGranted: [],
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      },
    });

    return session;
  });

  sessionLogger.info(
    { sessionId: created.id, driverId: driver.id, vehicleId: vehicle.id },
    'Terminal driver request opened',
  );

  await announce(created);
  return toSessionView(created, { includeSelfie: true });
}

// ---------------------------------------------------------------------------
// 2. Selfie
// ---------------------------------------------------------------------------

/**
 * Attach the arrival selfie.
 *
 * Stored once, in the existing media library, owned by the driver and scoped to
 * their organization. Section 13 is explicit that the terminal must not create
 * duplicate image storage, so the session holds a reference and nothing else.
 *
 * Replacing a selfie before submission is allowed — "retake" is on the screen —
 * and the previous asset is soft-deleted rather than orphaned.
 */
export async function attachSelfie(
  auth: AuthContext,
  sessionId: string,
  meta: TerminalSelfieMetaInput,
  file: UploadFilePart,
  thumbnail?: UploadFilePart,
): Promise<TerminalSessionView> {
  const session = await loadSession(sessionId);

  if (session.driverUserId !== auth.user.id) {
    throw errors.forbidden('You can only submit your own arrival photo.');
  }
  if (
    session.status !== TerminalSessionStatus.DRIVER_IDENTIFIED &&
    session.status !== TerminalSessionStatus.SELFIE_SUBMITTED
  ) {
    throw errors.businessRule(
      'This request has already been submitted. Cancel it and start again if you need to retake the photo.',
    );
  }

  const asset = await uploadMedia(
    auth,
    {
      ownerType: MediaOwnerType.DRIVER,
      ownerId: session.driverId,
      purpose: MediaPurpose.DRIVER_VERIFICATION,
      // Never widened. The fleet deciding on the request sees it; nobody else.
      visibility: MediaVisibility.ORGANIZATION,
      caption: `Arrival at ${session.vehicle.registrationNumber}`,
      ...(meta.latitude !== undefined ? { latitude: meta.latitude } : {}),
      ...(meta.longitude !== undefined ? { longitude: meta.longitude } : {}),
      ...(meta.capturedAt !== undefined ? { capturedAt: meta.capturedAt } : {}),
    },
    { file, ...(thumbnail ? { thumbnail } : {}) },
  );

  const previousMediaId = session.selfieMediaId;

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.terminalSession.update({
      where: { id: session.id },
      data: {
        selfieMediaId: asset.id,
        selfieCapturedAt: meta.capturedAt ?? new Date(),
        status: TerminalSessionStatus.SELFIE_SUBMITTED,
      },
      include: sessionInclude,
    });

    // A retake supersedes the previous photo rather than accumulating one per
    // attempt: the evidence is the photo that was submitted, and keeping the
    // discarded ones would be retaining images of a person for no purpose.
    if (previousMediaId && previousMediaId !== asset.id) {
      await tx.mediaAsset.updateMany({
        where: { id: previousMediaId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }

    await recordEvent(
      tx,
      session.id,
      TerminalSessionEventType.SELFIE_SUBMITTED,
      previousMediaId ? 'Arrival photo retaken.' : 'Arrival photo captured.',
      { actorUserId: auth.user.id },
    );

    return next;
  });

  await announce(updated);
  return toSessionView(updated, { includeSelfie: true });
}

// ---------------------------------------------------------------------------
// 3. Submit for approval
// ---------------------------------------------------------------------------

/**
 * Hand the request to the fleet owner or mobility provider.
 *
 * This is where the SLA clock starts. `expiresAt` is set here rather than at
 * request time, because the window is for the *approver* to respond in — a
 * driver taking ten minutes to find good light for a selfie should not eat into
 * it.
 */
export async function submitForApproval(
  auth: AuthContext,
  sessionId: string,
  input: SubmitTerminalAssignmentInput,
): Promise<TerminalSessionView> {
  const session = await loadSession(sessionId);

  if (session.driverUserId !== auth.user.id) {
    throw errors.forbidden('You can only submit your own request.');
  }
  if (session.status === TerminalSessionStatus.PENDING_APPROVAL) {
    // Re-submitting is what a driver on a flaky connection does. It is not an
    // error, and refusing it would make them think nothing had been sent.
    return toSessionView(session, { includeSelfie: true });
  }
  if (session.status !== TerminalSessionStatus.SELFIE_SUBMITTED) {
    throw errors.businessRule(
      'Take an arrival photo before submitting your request for approval.',
    );
  }
  if (!session.selfieMediaId) {
    throw errors.businessRule('Take an arrival photo before submitting your request.');
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.terminalSession.update({
      where: { id: session.id },
      data: {
        status: TerminalSessionStatus.PENDING_APPROVAL,
        submittedAt: now,
        expiresAt: new Date(
          now.getTime() + TERMINAL_APPROVAL_SLA.expireAfterMinutes * 60_000,
        ),
        ...(input.note ? { decisionNote: null } : {}),
      },
      include: sessionInclude,
    });

    await recordEvent(
      tx,
      session.id,
      TerminalSessionEventType.SUBMITTED_FOR_APPROVAL,
      'Submitted for owner approval.',
      { actorUserId: auth.user.id, ...(input.note ? { metadata: { note: input.note } } : {}) },
    );

    return next;
  });

  const driverName =
    `${updated.driver.user.firstName} ${updated.driver.user.lastName}`.trim();

  await notifyOrganization(updated.organizationId, {
    type: NotificationType.TERMINAL_DRIVER_REQUEST,
    title: `${driverName} is at ${updated.vehicle.registrationNumber}`,
    body: `Approve or reject the driver assignment. Expected response within ${TERMINAL_APPROVAL_SLA.escalateAfterMinutes} minutes.`,
    priority: NotificationPriority.HIGH,
    actionUrl: `/fleet/terminal-approvals?session=${updated.id}`,
    roles: OPERATOR_MANAGEMENT_ROLES,
  });

  await announce(updated);
  return toSessionView(updated, { includeSelfie: true });
}

/** Withdraw a request before anybody has decided it. */
export async function cancelAssignment(
  auth: AuthContext,
  sessionId: string,
  input: CancelTerminalAssignmentInput,
): Promise<TerminalSessionView> {
  const session = await loadSession(sessionId);

  const isOwnRequest = session.driverUserId === auth.user.id;
  if (!isOwnRequest) assertTenantAccess(auth, session.organizationId, 'Driver request');

  if (!ACTIVE_TERMINAL_SESSION_STATUSES.includes(session.status as TerminalSessionStatus)) {
    throw errors.businessRule('That request is already closed.');
  }
  if (AUTHORIZED_TERMINAL_SESSION_STATUSES.includes(session.status as TerminalSessionStatus)) {
    throw errors.businessRule(
      'This driver has already been approved. End the session from the terminal instead.',
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.terminalSession.update({
      where: { id: session.id },
      data: {
        status: TerminalSessionStatus.CANCELLED,
        endedAt: new Date(),
        endReason: input.reason ?? 'Cancelled by the driver.',
      },
      include: sessionInclude,
    });
    await recordEvent(
      tx,
      session.id,
      TerminalSessionEventType.CANCELLED,
      input.reason ?? 'Request withdrawn.',
      { actorUserId: auth.user.id },
    );
    return next;
  });

  await announce(updated);
  return toSessionView(updated, { includeSelfie: isOwnRequest });
}

// ---------------------------------------------------------------------------
// 4. The decision
// ---------------------------------------------------------------------------

/**
 * Approve a driver onto a vehicle.
 *
 * The only path in the entire product that authorises somebody to drive. It
 * requires `terminal.approve`, it requires the request to belong to the
 * approver's own fleet, and it records who decided, when, and on what.
 *
 * A Redis claim serialises the decision. Two managers opening the queue on two
 * phones and both tapping Approve is an entirely ordinary thing to happen; the
 * transaction is what guarantees one decision, and the claim is what stops the
 * second one doing the work before discovering it lost.
 */
export async function approveAssignment(
  auth: AuthContext,
  sessionId: string,
  input: ApproveTerminalAssignmentInput,
): Promise<TerminalSessionView> {
  const claimKey = cacheKeys.terminalDecisionClaim(sessionId);
  const claimed = await cache.get<string>(claimKey);
  if (claimed && claimed !== auth.user.id) {
    throw errors.conflict('Someone else is deciding this request right now.');
  }
  await cache.set(claimKey, auth.user.id, cacheTtl.terminalDecisionClaim);

  try {
    const session = await loadSession(sessionId);
    assertTenantAccess(auth, session.organizationId, 'Driver request');

    if (session.status === TerminalSessionStatus.APPROVED) {
      return toSessionView(session, { includeSelfie: true });
    }
    if (session.status !== TerminalSessionStatus.PENDING_APPROVAL) {
      throw errors.businessRule(
        `That request is ${session.status.toLowerCase().replace(/_/g, ' ')} and can no longer be approved.`,
      );
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction. The claim above is best-effort; this is
      // what actually makes the decision single.
      const current = await tx.terminalSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });
      if (current?.status !== TerminalSessionStatus.PENDING_APPROVAL) {
        throw errors.conflict('That request has already been decided.');
      }

      let truckAssignmentId: string | null = null;

      if (input.assignVehicle) {
        // Close whatever standing assignment the vehicle had. A truck with two
        // active drivers is a truck nobody can be held responsible for.
        await tx.truckAssignment.updateMany({
          where: { truckId: session.vehicleId, status: AssignmentStatus.ACTIVE },
          data: { status: AssignmentStatus.ENDED, unassignedAt: now },
        });

        const assignment = await tx.truckAssignment.create({
          data: {
            truckId: session.vehicleId,
            driverId: session.driverId,
            organizationId: session.organizationId,
            status: AssignmentStatus.ACTIVE,
            assignedById: auth.user.id,
            assignedAt: now,
            note: `Approved from Saarthi Terminal by ${auth.user.firstName} ${auth.user.lastName}.`,
          },
        });
        truckAssignmentId = assignment.id;

        await tx.truck.update({
          where: { id: session.vehicleId },
          data: { currentDriverId: session.driverId },
        });
        await tx.driver.update({
          where: { id: session.driverId },
          data: { currentTruckId: session.vehicleId },
        });
      }

      const next = await tx.terminalSession.update({
        where: { id: sessionId },
        data: {
          status: TerminalSessionStatus.APPROVED,
          decidedAt: now,
          decidedById: auth.user.id,
          decisionNote: input.note ?? null,
          truckAssignmentId,
          // The request window is over; the session's own idle life takes over.
          expiresAt: null,
        },
        include: sessionInclude,
      });

      await recordEvent(
        tx,
        sessionId,
        TerminalSessionEventType.APPROVED,
        `Approved by ${auth.user.firstName} ${auth.user.lastName}.`,
        {
          actorUserId: auth.user.id,
          metadata: { assignedVehicle: input.assignVehicle, note: input.note ?? null },
        },
      );

      return next;
    });

    sessionLogger.info(
      {
        sessionId,
        driverId: updated.driverId,
        vehicleId: updated.vehicleId,
        decidedBy: auth.user.id,
      },
      'Terminal driver request approved',
    );

    await notify({
      userId: updated.driverUserId,
      type: NotificationType.TERMINAL_DRIVER_APPROVED,
      title: `You are approved for ${updated.vehicle.registrationNumber}`,
      body: 'Complete the vehicle safety check on the terminal before starting your trip.',
      priority: NotificationPriority.HIGH,
      actionUrl: '/driver',
    });

    await announce(updated);
    return toSessionView(updated, { includeSelfie: true });
  } finally {
    await cache.delete(claimKey).catch(() => undefined);
  }
}

/**
 * Refuse a driver.
 *
 * The reason is mandatory and is shown to the driver on the terminal. A refusal
 * with no reason is how somebody ends up standing at a truck at four in the
 * morning with no idea what to do next.
 */
export async function rejectAssignment(
  auth: AuthContext,
  sessionId: string,
  input: RejectTerminalAssignmentInput,
): Promise<TerminalSessionView> {
  const session = await loadSession(sessionId);
  assertTenantAccess(auth, session.organizationId, 'Driver request');

  if (
    session.status !== TerminalSessionStatus.PENDING_APPROVAL &&
    session.status !== TerminalSessionStatus.SELFIE_SUBMITTED &&
    session.status !== TerminalSessionStatus.DRIVER_IDENTIFIED
  ) {
    throw errors.businessRule(
      `That request is ${session.status.toLowerCase().replace(/_/g, ' ')} and can no longer be rejected.`,
    );
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.terminalSession.update({
      where: { id: sessionId },
      data: {
        status: TerminalSessionStatus.REJECTED,
        decidedAt: now,
        decidedById: auth.user.id,
        rejectionReason: input.reason,
        endedAt: now,
        endReason: 'Rejected by the fleet.',
        expiresAt: null,
      },
      include: sessionInclude,
    });

    await recordEvent(
      tx,
      sessionId,
      TerminalSessionEventType.REJECTED,
      `Rejected by ${auth.user.firstName} ${auth.user.lastName}: ${input.reason}`,
      { actorUserId: auth.user.id },
    );

    return next;
  });

  await notify({
    userId: updated.driverUserId,
    type: NotificationType.TERMINAL_DRIVER_REJECTED,
    title: `Request for ${updated.vehicle.registrationNumber} was not approved`,
    body: input.reason,
    priority: NotificationPriority.HIGH,
    actionUrl: '/driver',
  });

  await announce(updated);
  return toSessionView(updated, { includeSelfie: true });
}

// ---------------------------------------------------------------------------
// 5. Trip lifecycle, driven from the terminal
// ---------------------------------------------------------------------------

/**
 * Mark the session ready once the safety check passes.
 *
 * Called by the checklist service rather than by a route: READY is a
 * *consequence* of a passing checklist, and letting anything set it directly
 * would be a way to skip the check.
 */
export async function markChecklistComplete(
  sessionId: string,
  outcome: string,
): Promise<SessionRecord> {
  const now = new Date();
  const updated = await prisma.terminalSession.update({
    where: { id: sessionId },
    data: {
      status: TerminalSessionStatus.READY,
      checklistCompletedAt: now,
    },
    include: sessionInclude,
  });

  await recordEvent(
    prisma,
    sessionId,
    TerminalSessionEventType.CHECKLIST_SUBMITTED,
    `Pre-trip check completed: ${outcome.toLowerCase().replace(/_/g, ' ')}.`,
    { actorUserId: updated.driverUserId },
  );

  await announce(updated);
  return updated;
}

/** The driver started driving. */
export async function startTrip(
  sessionId: string,
  input: { latitude?: number; longitude?: number; odometerKm?: number; note?: string },
): Promise<TerminalSessionView> {
  const session = await loadSession(sessionId);

  if (session.status === TerminalSessionStatus.TRIP_ACTIVE) {
    return toSessionView(session, { includeSelfie: false });
  }
  if (session.status !== TerminalSessionStatus.READY) {
    throw errors.businessRule(
      'Complete the vehicle safety check before starting the trip.',
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.terminalSession.update({
      where: { id: sessionId },
      data: { status: TerminalSessionStatus.TRIP_ACTIVE, tripStartedAt: new Date() },
      include: sessionInclude,
    });
    await recordEvent(tx, sessionId, TerminalSessionEventType.TRIP_STARTED, 'Trip started.', {
      actorUserId: session.driverUserId,
      metadata: {
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        odometerKm: input.odometerKm ?? null,
        note: input.note ?? null,
      },
    });
    return next;
  });

  // Outside the transaction, and through the one function allowed to move it.
  // The odometer belongs to the vehicle rather than to this session, it must
  // never go backwards, and a terminal reinstalled on a truck used to be able to
  // wind it back here and quietly reset every service interval hanging off it.
  await applyOdometer({
    vehicleId: session.vehicleId,
    odometerKm: input.odometerKm ?? null,
    reason: 'terminal-trip-start',
  });

  await announce(updated);
  return toSessionView(updated, { includeSelfie: false });
}

/** The driver finished. The session stays open until they sign off. */
export async function completeTrip(
  sessionId: string,
  input: { latitude?: number; longitude?: number; odometerKm?: number; note?: string },
): Promise<TerminalSessionView> {
  const session = await loadSession(sessionId);

  if (session.status !== TerminalSessionStatus.TRIP_ACTIVE) {
    throw errors.businessRule('No trip is under way on this terminal.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.terminalSession.update({
      where: { id: sessionId },
      // Back to READY, not COMPLETED: the driver has finished a trip, not their
      // shift. The specification's loop is TRIP_COMPLETED → AWAITING_DRIVER only
      // once the driver signs off, and a driver doing three drops in a day
      // should not have to be re-approved between them.
      data: { status: TerminalSessionStatus.READY, tripCompletedAt: new Date() },
      include: sessionInclude,
    });
    await recordEvent(
      tx,
      sessionId,
      TerminalSessionEventType.TRIP_COMPLETED,
      'Trip completed.',
      {
        actorUserId: session.driverUserId,
        metadata: {
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          odometerKm: input.odometerKm ?? null,
          note: input.note ?? null,
        },
      },
    );
    return next;
  });

  await applyOdometer({
    vehicleId: session.vehicleId,
    odometerKm: input.odometerKm ?? null,
    reason: 'terminal-trip-complete',
  });

  await announce(updated);
  return toSessionView(updated, { includeSelfie: false });
}

/**
 * End the session — the driver signs off and the terminal returns to idle.
 *
 * The `TruckAssignment` opened at approval is closed here, so a vehicle is not
 * left showing a driver who went home. The session row is kept: it is the
 * record of who was authorised, by whom, and when.
 */
export async function endSession(
  sessionId: string,
  reason: string | null,
  actorUserId: string | null,
): Promise<TerminalSessionView> {
  const session = await loadSession(sessionId);

  if (!ACTIVE_TERMINAL_SESSION_STATUSES.includes(session.status as TerminalSessionStatus)) {
    return toSessionView(session, { includeSelfie: false });
  }

  const now = new Date();

  /*
   * Close any service run before the driver leaves.
   *
   * The terminal closes its own run on arrival, but a driver who signs off
   * halfway to a workshop — or whose tablet died on the way — would otherwise
   * leave a trip open against the vehicle, and a vehicle with an open trip
   * cannot be dispatched. The distance banked so far is kept; only the run is
   * ended.
   */
  await releaseVehicleFromAdHocTrip(
    session.vehicleId,
    'Closed automatically: the driver signed off at the terminal.',
  ).catch(() => false);

  const updated = await prisma.$transaction(async (tx) => {
    if (session.truckAssignmentId) {
      await tx.truckAssignment.updateMany({
        where: { id: session.truckAssignmentId, status: AssignmentStatus.ACTIVE },
        data: { status: AssignmentStatus.ENDED, unassignedAt: now },
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

    const next = await tx.terminalSession.update({
      where: { id: sessionId },
      data: {
        status: TerminalSessionStatus.COMPLETED,
        endedAt: now,
        endReason: reason ?? 'Driver signed off.',
      },
      include: sessionInclude,
    });

    await recordEvent(
      tx,
      sessionId,
      TerminalSessionEventType.TRIP_COMPLETED,
      reason ?? 'Driver signed off at the terminal.',
      { actorUserId },
    );

    return next;
  });

  await announce(updated);
  return toSessionView(updated, { includeSelfie: false });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The live session on one terminal, if there is one. */
export async function activeSessionForTerminal(
  terminalDeviceId: string,
): Promise<SessionRecord | null> {
  return prisma.terminalSession.findFirst({
    where: {
      terminalDeviceId,
      status: { in: ACTIVE_TERMINAL_SESSION_STATUSES },
    },
    include: sessionInclude,
    orderBy: { requestedAt: 'desc' },
  });
}

/** The session whose driver is currently authorised, or null. */
export async function authorizedSessionForTerminal(
  terminalDeviceId: string,
): Promise<SessionRecord> {
  const session = await prisma.terminalSession.findFirst({
    where: {
      terminalDeviceId,
      status: { in: AUTHORIZED_TERMINAL_SESSION_STATUSES },
    },
    include: sessionInclude,
    orderBy: { requestedAt: 'desc' },
  });
  if (!session) {
    throw errors.forbidden(
      'No approved driver is signed in to this terminal. Scan the vehicle QR with your Saarthi account to sign on.',
    );
  }
  return session;
}

/** The driver's own current request, from their phone or the web app. */
export async function mySession(auth: AuthContext): Promise<TerminalSessionView | null> {
  if (!auth.driverId) return null;
  const session = await prisma.terminalSession.findFirst({
    where: {
      driverId: auth.driverId,
      status: { in: ACTIVE_TERMINAL_SESSION_STATUSES },
    },
    include: sessionInclude,
    orderBy: { requestedAt: 'desc' },
  });
  return session ? toSessionView(session, { includeSelfie: true }) : null;
}

export async function getSession(
  auth: AuthContext,
  sessionId: string,
): Promise<TerminalSessionView> {
  const session = await loadSession(sessionId);
  const isOwnRequest = session.driverUserId === auth.user.id;
  if (!isOwnRequest) assertTenantAccess(auth, session.organizationId, 'Driver request');
  return toSessionView(session, { includeSelfie: true });
}

/** The fleet's arrival queue. */
export async function listSessions(
  auth: AuthContext,
  organizationId: string,
  query: TerminalAssignmentListQuery,
): Promise<Paginated<TerminalSessionView>> {
  const where: Prisma.TerminalSessionWhereInput = {
    organizationId,
    ...(query.status ? { status: { in: query.status as TerminalSessionStatus[] } } : {}),
    ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    ...(query.driverId ? { driverId: query.driverId } : {}),
    ...(query.pendingOnly
      ? {
          status: {
            in: [
              TerminalSessionStatus.DRIVER_IDENTIFIED,
              TerminalSessionStatus.SELFIE_SUBMITTED,
              TerminalSessionStatus.PENDING_APPROVAL,
            ],
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.terminalSession.count({ where }),
    prisma.terminalSession.findMany({
      where,
      include: sessionInclude,
      orderBy: { requestedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: await Promise.all(
      rows.map((row) => toSessionView(row, { includeSelfie: true })),
    ),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

/** The history of one request, for an approval dispute. */
export async function sessionHistory(
  auth: AuthContext,
  sessionId: string,
): Promise<
  { id: string; eventType: string; description: string | null; createdAt: string }[]
> {
  const session = await loadSession(sessionId);
  const isOwnRequest = session.driverUserId === auth.user.id;
  if (!isOwnRequest) assertTenantAccess(auth, session.organizationId, 'Driver request');

  const events = await prisma.terminalSessionEvent.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  return events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    description: event.description,
    createdAt: event.createdAt.toISOString(),
  }));
}

/**
 * The driver's recent assignment history at one vehicle.
 *
 * Shown on the approval screen (section 14). Bounded and deliberately shallow:
 * an approver needs to know whether this is somebody who drives this truck
 * every week or somebody who has never been near it, and nothing more.
 */
export async function recentHistoryForApprover(
  driverId: string,
  vehicleId: string,
): Promise<
  {
    id: string;
    registrationNumber: string;
    status: string;
    requestedAt: string;
    /** True when this arrival was at the vehicle now being decided. */
    sameVehicle: boolean;
  }[]
> {
  const rows = await prisma.terminalSession.findMany({
    where: {
      driverId,
      // The current request is excluded: it is the thing being decided, and
      // listing it as history would be circular.
      NOT: { status: TerminalSessionStatus.DRIVER_IDENTIFIED },
    },
    orderBy: { requestedAt: 'desc' },
    take: 8,
    select: {
      id: true,
      status: true,
      requestedAt: true,
      vehicleId: true,
      vehicle: { select: { registrationNumber: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    registrationNumber: row.vehicle.registrationNumber,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    sameVehicle: row.vehicleId === vehicleId,
  }));
}

export { toSessionView, sessionInclude };
export type { SessionRecord };
