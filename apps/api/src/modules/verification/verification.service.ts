import {
  DocumentOwnerType,
  NotificationPriority,
  NotificationType,
  VerificationStatus,
  VerificationSubjectType,
  buildPaginationMeta,
  mandatoryDocumentTypes,
  resolveDocumentValidity,
  type Paginated,
  type ReviewVerificationInput,
  type SubmitVerificationInput,
  type VerificationListQuery,
} from '@saarthi/shared';
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
      if (!truck) throw errors.notFound('Truck');
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

/** Propagate the case outcome onto the subject record itself. */
async function applyStatusToSubject(
  subjectType: VerificationSubjectType,
  subjectId: string,
  status: VerificationStatus,
): Promise<void> {
  switch (subjectType) {
    case VerificationSubjectType.DRIVER:
      await prisma.driver.update({ where: { id: subjectId }, data: { verificationStatus: status } });
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

  const status: VerificationStatus =
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

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.verificationCase.update({
      where: { id: caseId },
      data: {
        status,
        reviewedById: auth.user.id,
        reviewedAt: new Date(),
        reviewerNotes: input.reviewerNotes ?? null,
        rejectionReason:
          input.decision === 'REJECTED' || input.decision === 'CORRECTION_REQUESTED'
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
        note:
          input.decision === 'CORRECTION_REQUESTED'
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

  await applyStatusToSubject(subjectType, subjectId, VerificationStatus.VERIFIED);

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
  if (!record) return { case: null, readiness };
  return { case: await toSummary(record), readiness };
}
