import {
  DocumentOwnerType,
  NotificationPriority,
  NotificationType,
  VerificationStatus,
  VerificationSubjectType,
  buildPaginationMeta,
  driverVerificationChecklist,
  mandatoryDocumentTypes,
  resolveDocumentValidity,
  type DriverVerificationChecklist,
  type Paginated,
  type ReviewVerificationInput,
  type SubmitVerificationInput,
  type VerificationListQuery,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { notifyAsync } from '../notifications/notification.service';
import type { AuthContext } from '../../auth/context';

/**
 * Verification workflow.
 *
 * Verification is a case with a history, not a boolean flag. Submitting builds
 * a case from the subject's current documents; a reviewer then approves,
 * rejects or asks for a correction, and the subject's own verification status
 * is kept in step.
 */

export interface VerificationCaseSummary {
  id: string;
  subjectType: VerificationSubjectType;
  subjectId: string;
  subjectLabel: string;
  organizationId: string | null;
  organizationName: string | null;
  status: VerificationStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewerNotes: string | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

interface SubjectContext {
  organizationId: string | null;
  label: string;
  ownerType: DocumentOwnerType;
}

async function resolveSubject(
  auth: AuthContext,
  subjectType: VerificationSubjectType,
  subjectId: string,
  { forReview = false }: { forReview?: boolean } = {},
): Promise<SubjectContext> {
  const enforceTenant = (organizationId: string | null, resource: string): void => {
    if (forReview || auth.isPlatformAdmin) return;
    if (organizationId !== auth.organizationId) throw errors.notFound(resource);
  };

  switch (subjectType) {
    case VerificationSubjectType.DRIVER: {
      const driver = await prisma.driver.findUnique({
        where: { id: subjectId },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      if (!driver) throw errors.notFound('Driver');
      if (!forReview && auth.driverId !== driver.id) enforceTenant(driver.organizationId, 'Driver');
      return {
        organizationId: driver.organizationId,
        label: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
        ownerType: DocumentOwnerType.DRIVER,
      };
    }
    case VerificationSubjectType.TRUCK: {
      const truck = await prisma.truck.findUnique({ where: { id: subjectId } });
      if (!truck) throw errors.notFound('Vehicle');
      enforceTenant(truck.organizationId, 'Truck');
      return {
        organizationId: truck.organizationId,
        label: truck.registrationNumber,
        ownerType: DocumentOwnerType.TRUCK,
      };
    }
    case VerificationSubjectType.ORGANIZATION: {
      const organization = await prisma.organization.findUnique({ where: { id: subjectId } });
      if (!organization) throw errors.notFound('Organization');
      enforceTenant(organization.id, 'Organization');
      return {
        organizationId: organization.id,
        label: organization.name,
        ownerType: DocumentOwnerType.ORGANIZATION,
      };
    }
    case VerificationSubjectType.USER: {
      const user = await prisma.user.findUnique({ where: { id: subjectId } });
      if (!user) throw errors.notFound('User');
      if (!forReview && !auth.isPlatformAdmin && user.id !== auth.user.id) {
        throw errors.notFound('User');
      }
      return {
        organizationId: auth.organizationId,
        label: `${user.firstName} ${user.lastName}`.trim(),
        ownerType: DocumentOwnerType.USER,
      };
    }
    default:
      throw errors.validation('Unsupported verification subject type.');
  }
}

/**
 * Where a driver stands against the four checks that decide their status.
 *
 * Read straight off the driver row: each check writes its own timestamp when
 * its authority confirms it, so this is a read of recorded facts rather than a
 * derived guess.
 */
export async function getDriverChecklist(
  driverId: string,
): Promise<DriverVerificationChecklist | null> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      licenceVerifiedAt: true,
      aadhaarVerifiedAt: true,
      panVerifiedAt: true,
      voterIdVerifiedAt: true,
    },
  });
  return driver ? driverVerificationChecklist(driver) : null;
}

/**
 * The status a driver may actually hold.
 *
 * A driver is verified only once the licensing authority has confirmed their
 * licence *and* their Aadhaar, PAN and Voter ID have each been confirmed by
 * their own source. Anything asking for VERIFIED while a check is outstanding
 * gets PENDING instead — including a human reviewer, deliberately: a reviewer
 * can confirm that a scan looks right, which is not the same fact as an
 * authority confirming the number, and the platform must not present the one
 * as the other.
 *
 * Only VERIFIED is gated. A rejection needs no checklist to be true.
 */
async function driverStatusFor(
  driverId: string,
  requested: VerificationStatus,
): Promise<VerificationStatus> {
  if (requested !== VerificationStatus.VERIFIED) return requested;
  // With enforcement off there is no authority to consult on a development
  // machine, so a reviewer's decision is the only signal there is — take it.
  if (!config.verification.driverChecksEnforced) return VerificationStatus.VERIFIED;
  const checklist = await getDriverChecklist(driverId);
  if (!checklist || checklist.complete) return VerificationStatus.VERIFIED;
  return VerificationStatus.PENDING;
}

/**
 * The status a decision can actually take effect as, for any subject.
 *
 * Applied to the *case* as well as the subject, and that is the point: a case
 * reading VERIFIED beside a driver reading PENDING would have the verification
 * queue and the driver's own page contradicting each other, and whichever one
 * somebody happened to look at would be the wrong answer.
 *
 * Returns the checklist too when one applies, so the caller can say on the
 * case why a VERIFIED decision did not land as VERIFIED.
 */
async function effectiveStatusFor(
  subjectType: VerificationSubjectType,
  subjectId: string,
  requested: VerificationStatus,
): Promise<{ status: VerificationStatus; checklist: DriverVerificationChecklist | null }> {
  if (subjectType !== VerificationSubjectType.DRIVER) {
    return { status: requested, checklist: null };
  }
  const checklist = await getDriverChecklist(subjectId);
  const status = await driverStatusFor(subjectId, requested);
  return { status, checklist };
}

/** Propagate the case outcome onto the subject record itself. */
async function applyStatusToSubject(
  subjectType: VerificationSubjectType,
  subjectId: string,
  status: VerificationStatus,
): Promise<void> {
  switch (subjectType) {
    case VerificationSubjectType.DRIVER:
      await prisma.driver.update({
        where: { id: subjectId },
        data: { verificationStatus: await driverStatusFor(subjectId, status) },
      });
      break;
    case VerificationSubjectType.TRUCK:
      await prisma.truck.update({ where: { id: subjectId }, data: { verificationStatus: status } });
      break;
    case VerificationSubjectType.ORGANIZATION:
      await prisma.organization.update({
        where: { id: subjectId },
        data: { verificationStatus: status },
      });
      break;
    default:
      break;
  }
}

async function subjectLabel(
  subjectType: VerificationSubjectType,
  subjectId: string,
): Promise<string> {
  try {
    switch (subjectType) {
      case VerificationSubjectType.DRIVER: {
        const driver = await prisma.driver.findUnique({
          where: { id: subjectId },
          include: { user: { select: { firstName: true, lastName: true } } },
        });
        return driver ? `${driver.user.firstName} ${driver.user.lastName}`.trim() : 'Driver';
      }
      case VerificationSubjectType.TRUCK: {
        const truck = await prisma.truck.findUnique({ where: { id: subjectId } });
        return truck?.registrationNumber ?? 'Truck';
      }
      case VerificationSubjectType.ORGANIZATION: {
        const organization = await prisma.organization.findUnique({ where: { id: subjectId } });
        return organization?.name ?? 'Organization';
      }
      default: {
        const user = await prisma.user.findUnique({ where: { id: subjectId } });
        return user ? `${user.firstName} ${user.lastName}`.trim() : 'User';
      }
    }
  } catch {
    return 'Unknown';
  }
}

type CaseRecord = Prisma.VerificationCaseGetPayload<{ include: { documents: true } }>;

async function toSummary(record: CaseRecord): Promise<VerificationCaseSummary> {
  const organization = record.organizationId
    ? await prisma.organization.findUnique({
        where: { id: record.organizationId },
        select: { name: true },
      })
    : null;

  return {
    id: record.id,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    subjectLabel: await subjectLabel(record.subjectType, record.subjectId),
    organizationId: record.organizationId,
    organizationName: organization?.name ?? null,
    status: record.status,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    rejectionReason: record.rejectionReason,
    reviewerNotes: record.reviewerNotes,
    documentCount: record.documents.length,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export interface VerificationReadiness {
  ready: boolean;
  missing: { documentType: string; label: string }[];
  invalid: { documentType: string; label: string; reason: string }[];
}

/** Are all mandatory documents present and usable for this subject? */
export async function checkReadiness(
  subjectType: VerificationSubjectType,
  subjectId: string,
): Promise<VerificationReadiness> {
  const ownerType =
    subjectType === VerificationSubjectType.DRIVER
      ? DocumentOwnerType.DRIVER
      : subjectType === VerificationSubjectType.TRUCK
        ? DocumentOwnerType.TRUCK
        : subjectType === VerificationSubjectType.ORGANIZATION
          ? DocumentOwnerType.ORGANIZATION
          : DocumentOwnerType.USER;

  const required = mandatoryDocumentTypes(ownerType);
  const documents = await prisma.document.findMany({
    where: { ownerType, ownerId: subjectId, deletedAt: null },
  });

  const missing: VerificationReadiness['missing'] = [];
  const invalid: VerificationReadiness['invalid'] = [];

  for (const definition of required) {
    const document = documents.find((entry) => entry.documentType === definition.code);
    if (!document) {
      missing.push({ documentType: definition.code, label: definition.label });
      continue;
    }
    const { validity } = resolveDocumentValidity({
      expiryDate: document.expiryDate,
      verificationStatus: document.verificationStatus,
    });
    if (validity === 'EXPIRED') {
      invalid.push({
        documentType: definition.code,
        label: definition.label,
        reason: 'This document has expired. Upload a current copy.',
      });
    } else if (validity === 'REJECTED') {
      invalid.push({
        documentType: definition.code,
        label: definition.label,
        reason: document.rejectionReason ?? 'This document was rejected. Upload a corrected copy.',
      });
    }
  }

  return { ready: missing.length === 0 && invalid.length === 0, missing, invalid };
}

export async function submitVerification(
  auth: AuthContext,
  input: SubmitVerificationInput,
): Promise<VerificationCaseSummary> {
  const subject = await resolveSubject(auth, input.subjectType, input.subjectId);

  const readiness = await checkReadiness(input.subjectType, input.subjectId);
  if (!readiness.ready) {
    const missing = readiness.missing.map((entry) => entry.label);
    const invalid = readiness.invalid.map((entry) => `${entry.label} (${entry.reason})`);
    throw errors.businessRule(
      `Verification cannot be submitted yet. ${
        missing.length > 0 ? `Missing: ${missing.join(', ')}. ` : ''
      }${invalid.length > 0 ? `Needs attention: ${invalid.join('; ')}.` : ''}`.trim(),
      { missing: readiness.missing, invalid: readiness.invalid },
    );
  }

  const ownerType = subject.ownerType;
  const documents = await prisma.document.findMany({
    where: { ownerType, ownerId: input.subjectId, deletedAt: null },
    select: { id: true },
  });

  const existing = await prisma.verificationCase.findUnique({
    where: {
      subjectType_subjectId: { subjectType: input.subjectType, subjectId: input.subjectId },
    },
  });

  if (existing?.status === VerificationStatus.VERIFIED) {
    throw errors.conflict('This record is already verified.');
  }
  if (existing?.status === VerificationStatus.UNDER_REVIEW) {
    throw errors.conflict('This submission is already under review.');
  }

  const record = await prisma.$transaction(async (tx) => {
    const verificationCase = existing
      ? await tx.verificationCase.update({
          where: { id: existing.id },
          data: {
            status: VerificationStatus.SUBMITTED,
            submittedById: auth.user.id,
            submittedAt: new Date(),
            rejectionReason: null,
            organizationId: subject.organizationId,
          },
          include: { documents: true },
        })
      : await tx.verificationCase.create({
          data: {
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            organizationId: subject.organizationId,
            status: VerificationStatus.SUBMITTED,
            submittedById: auth.user.id,
            submittedAt: new Date(),
          },
          include: { documents: true },
        });

    // Snapshot the documents backing this submission.
    await tx.verificationDocument.deleteMany({ where: { verificationCaseId: verificationCase.id } });
    if (documents.length > 0) {
      await tx.verificationDocument.createMany({
        data: documents.map((document) => ({
          verificationCaseId: verificationCase.id,
          documentId: document.id,
        })),
        skipDuplicates: true,
      });
    }

    await tx.verificationEvent.create({
      data: {
        verificationCaseId: verificationCase.id,
        status: VerificationStatus.SUBMITTED,
        actorUserId: auth.user.id,
        note: input.note ?? 'Submitted for review.',
      },
    });

    return verificationCase;
  });

  await applyStatusToSubject(input.subjectType, input.subjectId, VerificationStatus.SUBMITTED);

  const fresh = await prisma.verificationCase.findUniqueOrThrow({
    where: { id: record.id },
    include: { documents: true },
  });
  return toSummary(fresh);
}

export async function reviewVerification(
  auth: AuthContext,
  caseId: string,
  input: ReviewVerificationInput,
): Promise<VerificationCaseSummary> {
  const record = await prisma.verificationCase.findUnique({
    where: { id: caseId },
    include: { documents: true },
  });
  if (!record) throw errors.notFound('Verification case');

  const requested: VerificationStatus =
    input.decision === 'VERIFIED'
      ? VerificationStatus.VERIFIED
      : input.decision === 'REJECTED'
        ? VerificationStatus.REJECTED
        : input.decision === 'CORRECTION_REQUESTED'
          ? VerificationStatus.PENDING
          : VerificationStatus.UNDER_REVIEW;

  if (record.status === VerificationStatus.VERIFIED && input.decision === 'VERIFIED') {
    throw errors.conflict('This record is already verified.');
  }

  /**
   * A reviewer's approval is held to the same four checks.
   *
   * Deliberately: a reviewer can confirm that a scan looks genuine, which is a
   * different fact from an authority confirming the number on it. Letting the
   * first stand in for the second is exactly the substitution this rule
   * exists to prevent — so the decision is recorded, and the status it lands
   * as is the one the evidence supports.
   */
  const { status, checklist } = await effectiveStatusFor(
    record.subjectType,
    record.subjectId,
    requested,
  );
  const heldBack = status !== requested;

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.verificationCase.update({
      where: { id: caseId },
      data: {
        status,
        reviewedById: auth.user.id,
        reviewedAt: new Date(),
        reviewerNotes: heldBack && checklist
          ? `${input.reviewerNotes ?? 'Approved on review.'} ${checklist.summary}`
          : (input.reviewerNotes ?? null),
        rejectionReason: heldBack && checklist
          ? checklist.summary
          : input.decision === 'REJECTED' || input.decision === 'CORRECTION_REQUESTED'
            ? (input.rejectionReason ?? null)
            : null,
      },
      include: { documents: true },
    });

    await tx.verificationEvent.create({
      data: {
        verificationCaseId: caseId,
        status,
        actorUserId: auth.user.id,
        note: heldBack && checklist
          ? `Approved on review, but not yet verified. ${checklist.summary}`
          : input.decision === 'CORRECTION_REQUESTED'
            ? `Correction requested: ${input.rejectionReason}`
            : (input.reviewerNotes ?? input.rejectionReason ?? null),
      },
    });

    return next;
  });

  await applyStatusToSubject(record.subjectType, record.subjectId, status);

  if (record.submittedById) {
    notifyAsync({
      userId: record.submittedById,
      organizationId: record.organizationId,
      type: NotificationType.VERIFICATION_RESULT,
      title:
        input.decision === 'VERIFIED'
          ? 'Verification approved'
          : input.decision === 'REJECTED'
            ? 'Verification rejected'
            : input.decision === 'CORRECTION_REQUESTED'
              ? 'Correction requested'
              : 'Verification under review',
      body:
        input.decision === 'VERIFIED'
          ? `${await subjectLabel(record.subjectType, record.subjectId)} has been verified.`
          : (input.rejectionReason ??
            input.reviewerNotes ??
            'Your verification submission has been updated.'),
      priority:
        input.decision === 'VERIFIED' ? NotificationPriority.NORMAL : NotificationPriority.HIGH,
      actionUrl: '/verification',
    });
  }

  return toSummary(updated);
}

/**
 * Demo-only self-approval.
 *
 * On a fresh local install nobody holds `verification.review`, so a self-served
 * organization would sit forever behind a queue nobody can drain — and an
 * unverified driver cannot be assigned to a trip. In DEMO_MODE the org that
 * submitted a case may approve its own submission so the product is walkable
 * end to end. The route that reaches this is behind `requireDemoMode()`, and
 * the environment refuses to boot with DEMO_MODE=true in production, so this
 * cannot leak into a real deployment.
 */
export async function selfApproveVerification(
  auth: AuthContext,
  caseId: string,
): Promise<VerificationCaseSummary> {
  const record = await prisma.verificationCase.findUnique({ where: { id: caseId } });
  // 404 rather than 403 — a case from another tenant must not be distinguishable
  // from one that does not exist.
  if (!record || record.organizationId !== auth.organizationId) {
    throw errors.notFound('Verification case');
  }

  return reviewVerification(auth, caseId, {
    decision: 'VERIFIED',
    reviewerNotes: 'Self-approved in demo mode.',
  });
}

/**
 * Demo-only direct verification of a driver, truck or organization.
 *
 * `submitVerification` rightly refuses until every mandatory document is on
 * file — but a freshly registered fleet would then have to upload eight files
 * before it could dispatch a single trip, and trip assignment refuses an
 * unverified driver or truck. In demo mode this marks the subject verified and
 * records a case so the history is still truthful about what happened. Behind
 * `requireDemoMode()`, which production cannot enable.
 */
export async function demoVerifySubject(
  auth: AuthContext,
  subjectType: VerificationSubjectType,
  subjectId: string,
): Promise<VerificationCaseSummary> {
  const subject = await resolveSubject(auth, subjectType, subjectId);
  if (subject.organizationId !== auth.organizationId && !auth.isPlatformAdmin) {
    throw errors.notFound('Record');
  }

  const now = new Date();
  const record = await prisma.$transaction(async (tx) => {
    const verificationCase = await tx.verificationCase.upsert({
      where: { subjectType_subjectId: { subjectType, subjectId } },
      create: {
        subjectType,
        subjectId,
        organizationId: subject.organizationId,
        status: VerificationStatus.VERIFIED,
        submittedById: auth.user.id,
        submittedAt: now,
        reviewedById: auth.user.id,
        reviewedAt: now,
        reviewerNotes: 'Verified directly in demo mode.',
      },
      update: {
        status: VerificationStatus.VERIFIED,
        reviewedById: auth.user.id,
        reviewedAt: now,
        reviewerNotes: 'Verified directly in demo mode.',
        rejectionReason: null,
      },
      include: { documents: true },
    });

    await tx.verificationEvent.create({
      data: {
        verificationCaseId: verificationCase.id,
        status: VerificationStatus.VERIFIED,
        actorUserId: auth.user.id,
        note: 'Verified directly in demo mode — no document review took place.',
      },
    });

    return verificationCase;
  });

  /**
   * Demo mode confirms all four checks, not just the status.
   *
   * The rule that a driver needs licence, Aadhaar, PAN and Voter ID is enforced
   * wherever a status is set — including here — so setting VERIFIED alone would
   * be silently downgraded and the demo shortcut would stop working. Filling
   * the four timestamps keeps one rule in the codebase rather than an exception
   * to it, and the event above already records that nothing was really checked.
   */
  if (subjectType === VerificationSubjectType.DRIVER) {
    await prisma.driver.update({
      where: { id: subjectId },
      data: {
        licenceVerifiedAt: now,
        aadhaarVerifiedAt: now,
        panVerifiedAt: now,
        voterIdVerifiedAt: now,
      },
    });
  }

  await applyStatusToSubject(subjectType, subjectId, VerificationStatus.VERIFIED);

  return toSummary(record);
}

/**
 * Bring a driver's status back in line with their four checks.
 *
 * Called after any one of them changes, because the fourth confirmation is
 * what completes the set — a driver whose last outstanding check just passed
 * must become verified there and then, without somebody having to go and press
 * a separate button they have no reason to know about.
 *
 * It moves the status in both directions, and the downward one is the point:
 * if a driver is carrying VERIFIED while a check is outstanding, then the
 * badge is claiming something no authority has confirmed. That can happen
 * legitimately — a driver verified by a reviewer before this rule existed —
 * and the first check run on them is the moment to put it right. The case
 * event says exactly which checks are missing, so the change is never a
 * mystery to whoever sees it.
 *
 * Returns the checklist, so a caller that has just run a check can report what
 * is still outstanding without reading the row again.
 */
export async function syncDriverVerificationStatus(
  driverId: string,
  actorUserId: string,
): Promise<DriverVerificationChecklist | null> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      id: true,
      organizationId: true,
      verificationStatus: true,
      licenceVerifiedAt: true,
      aadhaarVerifiedAt: true,
      panVerifiedAt: true,
      voterIdVerifiedAt: true,
    },
  });
  if (!driver) return null;

  const checklist = driverVerificationChecklist(driver);

  /*
   * Completing the set always promotes, enforcement or not — four confirmed
   * checks are four confirmed checks.
   *
   * The *downgrade* is what enforcement controls. In production it is the
   * whole point of this function: a driver carrying VERIFIED with a check
   * outstanding is a badge claiming something no authority confirmed. On a
   * development machine it is what makes the app unusable — with no real
   * licence to confirm, the first check run on any driver pulls them back to
   * PENDING and out of every truck, trip and marketplace screen. So that arm,
   * and only that arm, is what switches off.
   */
  const desired = checklist.complete
    ? VerificationStatus.VERIFIED
    : config.verification.driverChecksEnforced &&
        driver.verificationStatus === VerificationStatus.VERIFIED
      ? VerificationStatus.PENDING
      : driver.verificationStatus;

  if (desired === driver.verificationStatus) return checklist;

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.driver.update({ where: { id: driverId }, data: { verificationStatus: desired } });

    const verificationCase = await tx.verificationCase.upsert({
      where: {
        subjectType_subjectId: {
          subjectType: VerificationSubjectType.DRIVER,
          subjectId: driverId,
        },
      },
      create: {
        subjectType: VerificationSubjectType.DRIVER,
        subjectId: driverId,
        organizationId: driver.organizationId,
        status: desired,
        submittedById: actorUserId,
        submittedAt: now,
        reviewedById: actorUserId,
        reviewedAt: now,
        reviewerNotes: checklist.summary,
        rejectionReason: checklist.complete ? null : checklist.summary,
      },
      update: {
        status: desired,
        reviewedById: actorUserId,
        reviewedAt: now,
        reviewerNotes: checklist.summary,
        rejectionReason: checklist.complete ? null : checklist.summary,
      },
    });

    await tx.verificationEvent.create({
      data: {
        verificationCaseId: verificationCase.id,
        status: desired,
        actorUserId,
        note: checklist.complete
          ? 'All four checks confirmed by their issuing authorities — licence, Aadhaar, PAN and Voter ID.'
          : checklist.summary,
      },
    });
  });

  return checklist;
}

/**
 * Record the outcome of a registry check as a verification case.
 *
 * The registry path reaches a decision without a reviewer, but it must not
 * therefore be invisible: the module's whole design is that "verification is a
 * case with a history, not a boolean flag", and an automatic decision has more
 * need of that history than a manual one, not less. So the same case, the same
 * event log and the same subject status are written — the reviewer is simply
 * the registry, named in the note.
 *
 * Both outcomes are recorded. A refusal carries its reason on the case, which
 * is what puts the problem in front of the operator on the verification queue
 * and the subject's own page rather than only in the reply to one click.
 */
export async function recordRegistryDecision(
  auth: AuthContext,
  subjectType: VerificationSubjectType,
  subjectId: string,
  organizationId: string | null,
  decision: {
    /** `VERIFIED` or `REJECTED` — a registry answer is never a maybe. */
    status: VerificationStatus;
    /** The one-line verdict, kept on the case and on the event. */
    note: string;
    /** Set for a refusal, so the subject's page can explain itself. */
    rejectionReason: string | null;
  },
): Promise<VerificationCaseSummary> {
  const now = new Date();

  /**
   * A confirmed licence is one of four, so a driver whose other checks are
   * outstanding does not reach VERIFIED on this decision alone. The note then
   * carries the checklist, which is what turns "still pending" from a puzzle
   * into a list of what to do next.
   */
  const { status, checklist } = await effectiveStatusFor(subjectType, subjectId, decision.status);
  const downgraded = status !== decision.status;
  const note = downgraded && checklist ? `${decision.note} ${checklist.summary}` : decision.note;
  const rejectionReason = downgraded && checklist ? checklist.summary : decision.rejectionReason;

  const record = await prisma.$transaction(async (tx) => {
    const verificationCase = await tx.verificationCase.upsert({
      where: { subjectType_subjectId: { subjectType, subjectId } },
      create: {
        subjectType,
        subjectId,
        organizationId,
        status,
        submittedById: auth.user.id,
        submittedAt: now,
        reviewedById: auth.user.id,
        reviewedAt: now,
        reviewerNotes: note,
        rejectionReason,
      },
      update: {
        organizationId,
        status,
        reviewedById: auth.user.id,
        reviewedAt: now,
        reviewerNotes: note,
        rejectionReason,
      },
      include: { documents: true },
    });

    await tx.verificationEvent.create({
      data: {
        verificationCaseId: verificationCase.id,
        status,
        actorUserId: auth.user.id,
        note,
      },
    });

    return verificationCase;
  });

  await applyStatusToSubject(subjectType, subjectId, status);

  return toSummary(record);
}

export async function listVerificationCases(
  auth: AuthContext,
  query: VerificationListQuery,
): Promise<Paginated<VerificationCaseSummary>> {
  const where: Prisma.VerificationCaseWhereInput = {
    // Reviewers (platform staff) see every tenant's queue; everyone else is
    // limited to their own organization's submissions.
    ...(auth.isPlatformAdmin || auth.permissions.includes('verification.review')
      ? {}
      : { organizationId: auth.organizationId ?? '__none__' }),
    ...(query.status ? { status: { in: query.status as VerificationStatus[] } } : {}),
    ...(query.subjectType
      ? { subjectType: { in: query.subjectType as VerificationSubjectType[] } }
      : {}),
  };

  const [total, records] = await Promise.all([
    prisma.verificationCase.count({ where }),
    prisma.verificationCase.findMany({
      where,
      include: { documents: true },
      orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const items = await Promise.all(records.map((record) => toSummary(record)));

  return {
    items: query.search
      ? items.filter((item) =>
          item.subjectLabel.toLowerCase().includes(query.search!.toLowerCase()),
        )
      : items,
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getVerificationCase(auth: AuthContext, caseId: string) {
  const record = await prisma.verificationCase.findUnique({
    where: { id: caseId },
    include: { documents: true, events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!record) throw errors.notFound('Verification case');

  const canReview = auth.isPlatformAdmin || auth.permissions.includes('verification.review');
  if (!canReview && record.organizationId !== auth.organizationId) {
    throw errors.notFound('Verification case');
  }

  const documents = await prisma.document.findMany({
    where: { id: { in: record.documents.map((entry) => entry.documentId) } },
  });

  return {
    ...(await toSummary(record)),
    readiness: await checkReadiness(record.subjectType, record.subjectId),
    documents: documents.map((document) => ({
      id: document.id,
      documentType: document.documentType,
      title: document.title,
      fileName: document.fileName,
      mimeType: document.mimeType,
      expiryDate: document.expiryDate?.toISOString() ?? null,
      verificationStatus: document.verificationStatus,
    })),
    events: record.events.map((event) => ({
      id: event.id,
      status: event.status,
      note: event.note,
      actorUserId: event.actorUserId,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/** Case for a subject, if one exists — used by the driver/truck detail pages. */
export async function getCaseForSubject(
  auth: AuthContext,
  subjectType: VerificationSubjectType,
  subjectId: string,
) {
  await resolveSubject(auth, subjectType, subjectId);
  const record = await prisma.verificationCase.findUnique({
    where: { subjectType_subjectId: { subjectType, subjectId } },
    include: { documents: true },
  });

  const readiness = await checkReadiness(subjectType, subjectId);
  /**
   * The four checks, for a driver.
   *
   * Sent alongside readiness rather than folded into it because they answer
   * different questions: readiness is "are the mandatory documents on file",
   * this is "has each number been confirmed by its authority". A driver can
   * satisfy the first and still not be verified, and the screen has to be able
   * to say which of the two is holding them up.
   */
  const driverChecklist =
    subjectType === VerificationSubjectType.DRIVER ? await getDriverChecklist(subjectId) : null;

  if (!record) return { case: null, readiness, driverChecklist };
  return { case: await toSummary(record), readiness, driverChecklist };
}
