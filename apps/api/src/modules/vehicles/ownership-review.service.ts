import type { Readable } from 'node:stream';
import {
  NotificationPriority,
  NotificationType,
  OwnershipReviewStatus,
  Permission,
  VehicleOwnershipStatus,
  buildPaginationMeta,
  hasPermission,
  type OwnershipReviewDecisionInput,
  type OwnershipReviewDetail,
  type OwnershipReviewRequestInput,
  type OwnershipReviewSummary,
  type OwnershipReviewView,
  type Paginated,
} from '@saarthi/shared';
import type { AuthContext } from '../../auth/context';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { storageProvider } from '../../providers/storage';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { type UploadFileInput, validateFile } from '../documents/document.service';
import { notifyAsync } from '../notifications/notification.service';
import {
  evaluateOwnership,
  hasPendingOwnershipReview,
  storedRcOwnerName,
  verifiedNamesFor,
} from './vehicle-ownership.service';

/**
 * Ownership confirmed by a person, when it cannot be confirmed automatically.
 *
 * The automatic rule matches the RC owner's name to a government-verified name
 * on the account, and some owners can never pass it: a name romanised beyond
 * what the matcher allows, a married name, a vehicle registered to a relative,
 * no RC to hand. They ask here, with a message and, if they have one, the RC;
 * a reviewer with `VERIFICATION_REVIEW` decides.
 *
 * An approval is evidence, not a status flip: `evaluateOwnership` accepts it
 * as it accepts a name match, so the account's own vehicle is confirmed the
 * moment it is approved, and a plate another account holds unconfirmed moves
 * to the requester when they add it again — released from the holder, who is
 * told, exactly as after a name match.
 */

type ReviewRow = Prisma.VehicleOwnershipReviewGetPayload<Record<string, never>>;

function toView(row: ReviewRow): OwnershipReviewView {
  return {
    id: row.id,
    registrationNumber: row.registrationNumber,
    kind: row.truckId ? 'OWN_VEHICLE' : 'CLAIM',
    status: row.status as OwnershipReviewStatus,
    message: row.message,
    hasAttachment: Boolean(row.attachmentKey),
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// The owner's side
// ---------------------------------------------------------------------------

export async function requestOwnershipReview(
  auth: AuthContext,
  input: OwnershipReviewRequestInput,
  attachment: UploadFileInput | null,
): Promise<OwnershipReviewView> {
  const organizationId = auth.organizationId;
  if (!organizationId) {
    throw errors.organizationRequired('Your account is not linked to an organization.');
  }

  const subject = await reviewSubject(auth, organizationId, input);
  if (await hasPendingOwnershipReview(organizationId, subject.registrationNumber)) {
    throw errors.conflict(
      'A request for this vehicle is already with the Saarthi team. You will be notified when it is decided.',
    );
  }

  // Checked before anything is stored, so a bad file costs nothing.
  const stored = attachment ? await storeAttachment(organizationId, attachment) : null;

  const row = await prisma.vehicleOwnershipReview.create({
    data: {
      organizationId,
      requestedById: auth.user.id,
      registrationNumber: subject.registrationNumber,
      truckId: subject.truckId,
      message: input.message,
      attachmentKey: stored?.storageKey ?? null,
      attachmentName: stored ? attachment?.fileName ?? null : null,
      attachmentMimeType: stored?.mimeType ?? null,
      attachmentSize: stored?.size ?? null,
    },
  });

  await recordAudit({
    action: AuditAction.VEHICLE_OWNERSHIP_REVIEW_REQUESTED,
    entityType: 'VehicleOwnershipReview',
    entityId: row.id,
    actorUserId: auth.user.id,
    organizationId,
    after: {
      registrationNumber: row.registrationNumber,
      kind: row.truckId ? 'OWN_VEHICLE' : 'CLAIM',
      attachment: Boolean(stored),
    },
  });

  return toView(row);
}

/**
 * What the request is about, and whether it may be asked at all.
 *
 * The account's own vehicle while its ownership is unconfirmed, or a plate
 * another account holds unconfirmed. A plate nobody holds needs no review, and
 * one a holder has confirmed is not reviewed here: that is a dispute.
 */
async function reviewSubject(
  auth: AuthContext,
  organizationId: string,
  input: OwnershipReviewRequestInput,
): Promise<{ registrationNumber: string; truckId: string | null }> {
  const may = (permission: Permission) =>
    auth.isPlatformAdmin || hasPermission(auth.permissions, permission);

  if (input.vehicleId) {
    if (!may(Permission.VEHICLES_UPDATE)) throw errors.forbidden('Your role cannot manage vehicles.');
    const truck = await prisma.truck.findUnique({
      where: { id: input.vehicleId },
      select: { organizationId: true, registrationNumber: true, ownershipStatus: true, archivedAt: true },
    });
    if (!truck || truck.archivedAt || truck.organizationId !== organizationId) {
      throw errors.notFound('Vehicle');
    }
    if (truck.ownershipStatus !== VehicleOwnershipStatus.PENDING) {
      throw errors.businessRule('This vehicle’s ownership is already confirmed.');
    }
    return { registrationNumber: truck.registrationNumber, truckId: input.vehicleId };
  }

  if (!may(Permission.VEHICLES_CREATE)) throw errors.forbidden('Your role cannot add vehicles.');
  const registrationNumber = input.registrationNumber;
  if (!registrationNumber) throw errors.validation('Name the vehicle or its registration number.');

  const holder = await prisma.truck.findUnique({
    where: { registrationNumber },
    select: { organizationId: true, ownershipStatus: true },
  });
  if (!holder) {
    throw errors.businessRule(`${registrationNumber} is not on Saarthi yet, so there is nothing to review. Add it as usual.`);
  }
  if (holder.organizationId === organizationId) {
    throw errors.businessRule(`${registrationNumber} is already on your account. Ask for a review from its Ownership card.`);
  }
  if (holder.ownershipStatus === VehicleOwnershipStatus.VERIFIED) {
    throw errors.businessRule(
      `${registrationNumber} is held by an account that has confirmed it owns it. If it is yours, contact support.`,
    );
  }
  return { registrationNumber, truckId: null };
}

async function storeAttachment(organizationId: string, file: UploadFileInput) {
  const mimeType = validateFile(file);
  return storageProvider.upload({
    prefix: `ownership-reviews/${organizationId}`,
    fileName: file.fileName,
    mimeType,
    content: file.buffer,
  });
}

/** The account's latest request for a vehicle or plate, so the screen can say where it stands. */
export async function latestOwnershipReview(
  auth: AuthContext,
  query: { vehicleId?: string | undefined; registrationNumber?: string | undefined },
): Promise<OwnershipReviewView | null> {
  const organizationId = auth.organizationId;
  if (!organizationId) return null;

  let registrationNumber = query.registrationNumber;
  if (query.vehicleId) {
    const truck = await prisma.truck.findUnique({
      where: { id: query.vehicleId },
      select: { organizationId: true, registrationNumber: true },
    });
    if (!truck || truck.organizationId !== organizationId) throw errors.notFound('Vehicle');
    registrationNumber = truck.registrationNumber;
  }
  if (!registrationNumber) return null;

  const row = await prisma.vehicleOwnershipReview.findFirst({
    where: { organizationId, registrationNumber },
    orderBy: { createdAt: 'desc' },
  });
  return row ? toView(row) : null;
}

// ---------------------------------------------------------------------------
// The reviewer's side
// ---------------------------------------------------------------------------

async function summaries(rows: ReviewRow[]): Promise<OwnershipReviewSummary[]> {
  const [organizations, users] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.organizationId))] } },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.requestedById))] } },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  return rows.map((row) => {
    const user = users.find((entry) => entry.id === row.requestedById);
    return {
      ...toView(row),
      organizationName: organizations.find((entry) => entry.id === row.organizationId)?.name ?? null,
      requestedByName: user ? `${user.firstName} ${user.lastName}`.trim() : null,
    };
  });
}

export async function listOwnershipReviews(query: {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
  page: number;
  pageSize: number;
}): Promise<Paginated<OwnershipReviewSummary>> {
  const where = query.status === 'ALL' ? {} : { status: query.status };
  const [rows, total] = await Promise.all([
    prisma.vehicleOwnershipReview.findMany({
      where,
      // The longest wait first while working the queue; the latest first otherwise.
      orderBy: { createdAt: query.status === 'PENDING' ? 'asc' : 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.vehicleOwnershipReview.count({ where }),
  ]);
  return {
    items: await summaries(rows),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getOwnershipReview(id: string): Promise<OwnershipReviewDetail> {
  const row = await prisma.vehicleOwnershipReview.findUnique({ where: { id } });
  if (!row) throw errors.notFound('Ownership review');

  const [[summary], rcOwnerName, { names }, holder] = await Promise.all([
    summaries([row]),
    storedRcOwnerName(row.registrationNumber),
    verifiedNamesFor(row.organizationId),
    row.truckId ? null : claimHolder(row.registrationNumber),
  ]);

  return {
    ...(summary as OwnershipReviewSummary),
    vehicleId: row.truckId,
    rcOwnerName,
    verifiedNames: names,
    holder,
  };
}

/** For a claim, the account that holds the plate now. */
async function claimHolder(registrationNumber: string): Promise<OwnershipReviewDetail['holder']> {
  const truck = await prisma.truck.findUnique({
    where: { registrationNumber },
    select: { organizationId: true, ownershipStatus: true },
  });
  if (!truck) return null;
  const organization = await prisma.organization.findUnique({
    where: { id: truck.organizationId },
    select: { name: true },
  });
  return {
    organizationName: organization?.name ?? null,
    ownershipStatus: truck.ownershipStatus as VehicleOwnershipStatus,
  };
}

export async function ownershipReviewAttachment(
  id: string,
): Promise<{ stream: Readable; size: number; fileName: string; mimeType: string }> {
  const row = await prisma.vehicleOwnershipReview.findUnique({
    where: { id },
    select: { attachmentKey: true, attachmentName: true, attachmentMimeType: true },
  });
  if (!row?.attachmentKey) throw errors.notFound('Attachment');
  const file = await storageProvider.download(row.attachmentKey);
  return {
    stream: file.stream,
    size: file.size,
    fileName: row.attachmentName ?? 'attachment',
    mimeType: row.attachmentMimeType ?? 'application/octet-stream',
  };
}

export async function decideOwnershipReview(
  auth: AuthContext,
  id: string,
  input: OwnershipReviewDecisionInput,
): Promise<OwnershipReviewView> {
  // Conditional, so two reviewers deciding at once cannot both win.
  const decided = await prisma.vehicleOwnershipReview.updateMany({
    where: { id, status: OwnershipReviewStatus.PENDING },
    data: {
      status: input.decision,
      reviewedById: auth.user.id,
      reviewedAt: new Date(),
      decisionNote: input.note || null,
    },
  });
  const row = await prisma.vehicleOwnershipReview.findUnique({ where: { id } });
  if (!row) throw errors.notFound('Ownership review');
  if (decided.count === 0) throw errors.businessRule('This request has already been decided.');

  const approved = row.status === OwnershipReviewStatus.APPROVED;
  // The account's own vehicle is confirmed now; a claim, when it is added again.
  if (approved && row.truckId) {
    await evaluateOwnership(row.truckId).catch(() => undefined);
  }

  notifyAsync({
    userId: row.requestedById,
    organizationId: row.organizationId,
    type: NotificationType.VERIFICATION_RESULT,
    priority: NotificationPriority.HIGH,
    ...(approved
      ? row.truckId
        ? {
            title: 'Vehicle ownership confirmed',
            body: `The Saarthi team reviewed your request: ${row.registrationNumber} is confirmed as yours.`,
            actionUrl: `/fleet/vehicles/${row.truckId}`,
          }
        : {
            title: 'Ownership review approved',
            body: `The Saarthi team confirmed ${row.registrationNumber} is yours. Add it again and it moves to your account.`,
            actionUrl: '/fleet/vehicles',
          }
      : {
          title: 'Ownership review declined',
          body: `${row.registrationNumber}: ${row.decisionNote ?? 'The request was not approved.'}`,
          actionUrl: row.truckId ? `/fleet/vehicles/${row.truckId}` : '/fleet/vehicles',
        }),
  });

  await recordAudit({
    action: AuditAction.VEHICLE_OWNERSHIP_REVIEW_DECIDED,
    entityType: 'VehicleOwnershipReview',
    entityId: row.id,
    actorUserId: auth.user.id,
    organizationId: row.organizationId,
    after: {
      registrationNumber: row.registrationNumber,
      decision: row.status,
      kind: row.truckId ? 'OWN_VEHICLE' : 'CLAIM',
    },
  });

  return toView(row);
}
