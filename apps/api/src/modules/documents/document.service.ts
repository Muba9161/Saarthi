import { type Readable } from 'node:stream';
import {
  DocumentOwnerType,
  DocumentValidity,
  DocumentVerificationStatus,
  NotificationPriority,
  NotificationType,
  buildPaginationMeta,
  documentTypeDefinition,
  mandatoryDocumentTypes,
  resolveDocumentValidity,
  type DocumentListQuery,
  type Paginated,
  type ReviewDocumentInput,
  type UpdateDocumentInput,
  type UploadDocumentMetadata,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { config } from '../../config/env';
import { storageProvider } from '../../providers/storage';
import { detectMimeType, isAllowedMimeType } from '../../providers/storage/storage.provider';
import { notifyAsync } from '../notifications/notification.service';
import type { AuthContext } from '../../auth/context';

/**
 * Document management.
 *
 * Authorization is owner-driven: before a document is read or written, the
 * *owning entity* is resolved and checked against the caller's tenant. Files
 * are validated by magic bytes, not by the client's content-type header, and
 * every replacement is kept as a new version rather than overwriting bytes.
 */

export interface DocumentSummary {
  id: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  ownerLabel: string | null;
  organizationId: string | null;
  documentType: string;
  documentTypeLabel: string;
  documentNumber: string | null;
  title: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  validity: DocumentValidity;
  daysRemaining: number | null;
  verificationStatus: DocumentVerificationStatus;
  rejectionReason: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  currentVersion: number;
  uploadedById: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type DocumentRecord = Prisma.DocumentGetPayload<Record<string, never>>;

function toSummary(document: DocumentRecord, ownerLabel: string | null = null): DocumentSummary {
  const { validity, daysRemaining } = resolveDocumentValidity({
    expiryDate: document.expiryDate,
    verificationStatus: document.verificationStatus,
  });

  return {
    id: document.id,
    ownerType: document.ownerType,
    ownerId: document.ownerId,
    ownerLabel,
    organizationId: document.organizationId,
    documentType: document.documentType,
    documentTypeLabel: documentTypeDefinition(document.documentType)?.label ?? document.documentType,
    documentNumber: document.documentNumber,
    title: document.title,
    issueDate: document.issueDate?.toISOString() ?? null,
    expiryDate: document.expiryDate?.toISOString() ?? null,
    validity,
    daysRemaining,
    verificationStatus: document.verificationStatus,
    rejectionReason: document.rejectionReason,
    fileName: document.fileName,
    mimeType: document.mimeType,
    fileSize: document.fileSize,
    currentVersion: document.currentVersion,
    uploadedById: document.uploadedById,
    verifiedAt: document.verifiedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

/**
 * Resolve the tenant that owns a document target and verify the caller may
 * act on it. Returns the organization id to stamp on the document row.
 */
export async function resolveOwner(
  auth: AuthContext,
  ownerType: DocumentOwnerType,
  ownerId: string,
): Promise<{ organizationId: string | null; label: string }> {
  switch (ownerType) {
    case DocumentOwnerType.DRIVER: {
      const driver = await prisma.driver.findUnique({
        where: { id: ownerId },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      if (!driver) throw errors.notFound('Driver');
      // A driver may always manage their own documents.
      if (auth.driverId !== driver.id) {
        if (!auth.isPlatformAdmin && driver.organizationId !== auth.organizationId) {
          throw errors.notFound('Driver');
        }
      }
      return {
        organizationId: driver.organizationId,
        label: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
      };
    }

    case DocumentOwnerType.TRUCK: {
      const truck = await prisma.truck.findUnique({ where: { id: ownerId } });
      if (!truck) throw errors.notFound('Truck');
      if (!auth.isPlatformAdmin && truck.organizationId !== auth.organizationId) {
        // A driver assigned to the truck may still upload its documents.
        if (!auth.driverId || truck.currentDriverId !== auth.driverId) {
          throw errors.notFound('Truck');
        }
      }
      return { organizationId: truck.organizationId, label: truck.registrationNumber };
    }

    case DocumentOwnerType.ORGANIZATION: {
      const organization = await prisma.organization.findUnique({ where: { id: ownerId } });
      if (!organization) throw errors.notFound('Organization');
      if (!auth.isPlatformAdmin && organization.id !== auth.organizationId) {
        throw errors.notFound('Organization');
      }
      return { organizationId: organization.id, label: organization.name };
    }

    case DocumentOwnerType.USER: {
      if (!auth.isPlatformAdmin && ownerId !== auth.user.id) throw errors.notFound('User');
      const user = await prisma.user.findUnique({ where: { id: ownerId } });
      if (!user) throw errors.notFound('User');
      return {
        organizationId: auth.organizationId,
        label: `${user.firstName} ${user.lastName}`.trim(),
      };
    }

    case DocumentOwnerType.ORDER: {
      const order = await prisma.order.findUnique({ where: { id: ownerId } });
      if (!order) throw errors.notFound('Order');
      const permitted = [
        order.customerOrganizationId,
        order.supplierOrganizationId,
        order.fleetOrganizationId,
      ];
      if (!auth.isPlatformAdmin && !permitted.includes(auth.organizationId)) {
        throw errors.notFound('Order');
      }
      return { organizationId: auth.organizationId, label: order.reference };
    }

    case DocumentOwnerType.TRIP: {
      const trip = await prisma.trip.findUnique({
        where: { id: ownerId },
        include: { order: { select: { customerOrganizationId: true, supplierOrganizationId: true } } },
      });
      if (!trip) throw errors.notFound('Trip');
      const permitted = [
        trip.organizationId,
        trip.order?.customerOrganizationId ?? null,
        trip.order?.supplierOrganizationId ?? null,
      ];
      const isTripDriver = auth.driverId !== null && trip.driverId === auth.driverId;
      if (!auth.isPlatformAdmin && !isTripDriver && !permitted.includes(auth.organizationId)) {
        throw errors.notFound('Trip');
      }
      return { organizationId: trip.organizationId, label: trip.reference };
    }

    default:
      throw errors.validation('Unsupported document owner type.');
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadFileInput {
  buffer: Buffer;
  fileName: string;
  declaredMimeType: string;
}

function validateFile(file: UploadFileInput): string {
  if (file.buffer.byteLength === 0) {
    throw errors.validation('The uploaded file is empty.');
  }
  if (file.buffer.byteLength > config.storage.maxFileSize) {
    throw errors.payloadTooLarge(
      `The file is larger than the ${Math.round(config.storage.maxFileSize / 1024 / 1024)} MB limit.`,
    );
  }

  // The browser-supplied content-type is advisory only.
  const detected = detectMimeType(file.buffer);
  if (!detected) {
    throw errors.unsupportedMediaType(
      'Only PDF, JPEG, PNG, WebP and HEIC files can be uploaded as documents.',
    );
  }
  if (!isAllowedMimeType(detected)) {
    throw errors.unsupportedMediaType(`Files of type ${detected} are not accepted.`);
  }
  return detected;
}

export async function uploadDocument(
  auth: AuthContext,
  metadata: UploadDocumentMetadata,
  file: UploadFileInput,
): Promise<DocumentSummary> {
  const owner = await resolveOwner(auth, metadata.ownerType, metadata.ownerId);
  const mimeType = validateFile(file);

  const definition = documentTypeDefinition(metadata.documentType);
  if (definition && definition.ownerType !== metadata.ownerType) {
    throw errors.validation(
      `${definition.label} documents belong to a ${definition.ownerType.toLowerCase()}, not a ${metadata.ownerType.toLowerCase()}.`,
    );
  }
  if (definition?.requiresExpiry && !metadata.expiryDate) {
    throw errors.validation(`An expiry date is required for ${definition.label}.`, {
      fields: { expiryDate: ['An expiry date is required for this document type.'] },
    });
  }
  if (metadata.issueDate && metadata.expiryDate && metadata.issueDate > metadata.expiryDate) {
    throw errors.validation('The expiry date must be after the issue date.', {
      fields: { expiryDate: ['The expiry date must be after the issue date.'] },
    });
  }

  const stored = await storageProvider.upload({
    prefix: `documents/${metadata.ownerType.toLowerCase()}/${metadata.ownerId}`,
    fileName: file.fileName,
    mimeType,
    content: file.buffer,
  });

  // Re-uploading the same type for the same owner creates a new version.
  const existing = await prisma.document.findFirst({
    where: {
      ownerType: metadata.ownerType,
      ownerId: metadata.ownerId,
      documentType: metadata.documentType,
      deletedAt: null,
    },
  });

  if (existing) {
    const nextVersion = existing.currentVersion + 1;
    const document = await prisma.$transaction(async (tx) => {
      await tx.documentVersion.create({
        data: {
          documentId: existing.id,
          versionNumber: nextVersion,
          storageKey: stored.storageKey,
          fileName: file.fileName,
          mimeType,
          fileSize: stored.size,
          checksum: stored.checksum,
          uploadedById: auth.user.id,
          note: 'Replacement upload',
        },
      });

      return tx.document.update({
        where: { id: existing.id },
        data: {
          storageKey: stored.storageKey,
          fileName: file.fileName,
          mimeType,
          fileSize: stored.size,
          checksum: stored.checksum,
          currentVersion: nextVersion,
          documentNumber: metadata.documentNumber ?? existing.documentNumber,
          title: metadata.title ?? existing.title,
          issueDate: metadata.issueDate ?? existing.issueDate,
          expiryDate: metadata.expiryDate ?? existing.expiryDate,
          // A replacement always re-enters the review queue.
          verificationStatus: DocumentVerificationStatus.PENDING_VERIFICATION,
          rejectionReason: null,
          verifiedAt: null,
          verifiedById: null,
        },
      });
    });

    return toSummary(document, owner.label);
  }

  const document = await prisma.document.create({
    data: {
      ownerType: metadata.ownerType,
      ownerId: metadata.ownerId,
      organizationId: owner.organizationId,
      documentType: metadata.documentType,
      documentNumber: metadata.documentNumber ?? null,
      title: metadata.title ?? definition?.label ?? metadata.documentType,
      issueDate: metadata.issueDate ?? null,
      expiryDate: metadata.expiryDate ?? null,
      storageKey: stored.storageKey,
      fileName: file.fileName,
      mimeType,
      fileSize: stored.size,
      checksum: stored.checksum,
      verificationStatus: DocumentVerificationStatus.PENDING_VERIFICATION,
      uploadedById: auth.user.id,
      currentVersion: 1,
      versions: {
        create: {
          versionNumber: 1,
          storageKey: stored.storageKey,
          fileName: file.fileName,
          mimeType,
          fileSize: stored.size,
          checksum: stored.checksum,
          uploadedById: auth.user.id,
          note: 'Initial upload',
        },
      },
    },
  });

  return toSummary(document, owner.label);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

async function loadAuthorizedDocument(
  auth: AuthContext,
  documentId: string,
): Promise<{ document: DocumentRecord; ownerLabel: string }> {
  const document = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
  });
  if (!document) throw errors.notFound('Document');

  // Re-resolving the owner is what enforces tenant isolation here.
  const owner = await resolveOwner(auth, document.ownerType, document.ownerId);
  return { document, ownerLabel: owner.label };
}

export async function getDocument(auth: AuthContext, documentId: string): Promise<DocumentSummary> {
  const { document, ownerLabel } = await loadAuthorizedDocument(auth, documentId);
  return toSummary(document, ownerLabel);
}

export async function listDocuments(
  auth: AuthContext,
  query: DocumentListQuery,
): Promise<Paginated<DocumentSummary>> {
  // When a specific owner is requested, authorise it up front.
  if (query.ownerType && query.ownerId) {
    await resolveOwner(auth, query.ownerType, query.ownerId);
  }

  const where: Prisma.DocumentWhereInput = {
    deletedAt: null,
    ...(auth.isPlatformAdmin && !auth.organizationId
      ? {}
      : { organizationId: auth.organizationId ?? '__none__' }),
    ...(query.ownerType ? { ownerType: query.ownerType } : {}),
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.documentType ? { documentType: query.documentType.toUpperCase() } : {}),
    ...(query.verificationStatus
      ? { verificationStatus: { in: query.verificationStatus as DocumentVerificationStatus[] } }
      : {}),
    ...(query.expiringWithinDays
      ? {
          expiryDate: {
            gte: new Date(),
            lte: new Date(Date.now() + query.expiringWithinDays * 86_400_000),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { documentNumber: { contains: query.search, mode: 'insensitive' } },
            { fileName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.DocumentOrderByWithRelationInput =
    query.sortBy === 'expiryDate'
      ? { expiryDate: query.sortOrder }
      : query.sortBy === 'documentType'
        ? { documentType: query.sortOrder }
        : { createdAt: query.sortOrder };

  // Validity is derived, so filter on it after loading the page's rows.
  const wantsValidityFilter = Boolean(query.validity && query.validity.length > 0);

  if (!wantsValidityFilter) {
    const [total, documents] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({ where, orderBy, ...skipTake(query.page, query.pageSize) }),
    ]);
    return {
      items: documents.map((document) => toSummary(document)),
      pagination: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  const all = await prisma.document.findMany({ where, orderBy });
  const filtered = all.filter((document) => {
    const { validity } = resolveDocumentValidity({
      expiryDate: document.expiryDate,
      verificationStatus: document.verificationStatus,
    });
    return (query.validity as string[]).includes(validity);
  });

  const start = (query.page - 1) * query.pageSize;
  return {
    items: filtered.slice(start, start + query.pageSize).map((document) => toSummary(document)),
    pagination: buildPaginationMeta(query.page, query.pageSize, filtered.length),
  };
}

export async function downloadDocument(
  auth: AuthContext,
  documentId: string,
): Promise<{ stream: Readable; document: DocumentRecord }> {
  const { document } = await loadAuthorizedDocument(auth, documentId);
  const result = await storageProvider.download(document.storageKey);
  return { stream: result.stream, document };
}

export async function documentVersions(auth: AuthContext, documentId: string) {
  await loadAuthorizedDocument(auth, documentId);
  const versions = await prisma.documentVersion.findMany({
    where: { documentId },
    orderBy: { versionNumber: 'desc' },
  });
  return versions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber,
    fileName: version.fileName,
    mimeType: version.mimeType,
    fileSize: version.fileSize,
    uploadedById: version.uploadedById,
    note: version.note,
    createdAt: version.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function updateDocument(
  auth: AuthContext,
  documentId: string,
  input: UpdateDocumentInput,
): Promise<DocumentSummary> {
  const { document, ownerLabel } = await loadAuthorizedDocument(auth, documentId);

  const updated = await prisma.document.update({
    where: { id: document.id },
    data: {
      ...(input.documentNumber !== undefined ? { documentNumber: input.documentNumber } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.issueDate !== undefined ? { issueDate: input.issueDate } : {}),
      ...(input.expiryDate !== undefined ? { expiryDate: input.expiryDate } : {}),
    },
  });

  return toSummary(updated, ownerLabel);
}

export async function reviewDocument(
  auth: AuthContext,
  documentId: string,
  input: ReviewDocumentInput,
): Promise<DocumentSummary> {
  const document = await prisma.document.findFirst({ where: { id: documentId, deletedAt: null } });
  if (!document) throw errors.notFound('Document');

  // Reviewers act platform-wide, so tenant scoping is not applied here; the
  // route requires the DOCUMENTS_VERIFY permission which only staff hold.
  const status =
    input.decision === 'VERIFIED'
      ? DocumentVerificationStatus.VERIFIED
      : input.decision === 'REJECTED'
        ? DocumentVerificationStatus.REJECTED
        : DocumentVerificationStatus.UNDER_REVIEW;

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: {
      verificationStatus: status,
      rejectionReason: input.decision === 'REJECTED' ? (input.rejectionReason ?? null) : null,
      verifiedById: input.decision === 'VERIFIED' ? auth.user.id : null,
      verifiedAt: input.decision === 'VERIFIED' ? new Date() : null,
    },
  });

  notifyAsync({
    userId: document.uploadedById,
    organizationId: document.organizationId,
    type:
      input.decision === 'VERIFIED'
        ? NotificationType.DOCUMENT_VERIFIED
        : input.decision === 'REJECTED'
          ? NotificationType.DOCUMENT_REJECTED
          : NotificationType.VERIFICATION_RESULT,
    title:
      input.decision === 'VERIFIED'
        ? 'Document verified'
        : input.decision === 'REJECTED'
          ? 'Document rejected'
          : 'Document under review',
    body:
      input.decision === 'REJECTED'
        ? `${updated.title ?? updated.documentType} was rejected: ${input.rejectionReason}`
        : `${updated.title ?? updated.documentType} is now ${status.toLowerCase().replace(/_/g, ' ')}.`,
    priority:
      input.decision === 'REJECTED' ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
    actionUrl: `/documents/${documentId}`,
  });

  return toSummary(updated);
}

export async function deleteDocument(auth: AuthContext, documentId: string): Promise<void> {
  const { document } = await loadAuthorizedDocument(auth, documentId);
  // Soft delete: document history must remain auditable.
  await prisma.document.update({ where: { id: document.id }, data: { deletedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Compliance roll-ups
// ---------------------------------------------------------------------------

export interface ComplianceSummary {
  total: number;
  valid: number;
  expiringSoon: number;
  expired: number;
  pendingVerification: number;
  rejected: number;
  missingMandatory: { ownerType: DocumentOwnerType; ownerId: string; ownerLabel: string; documentType: string; label: string }[];
}

export async function complianceSummary(
  auth: AuthContext,
  organizationId: string,
): Promise<ComplianceSummary> {
  const documents = await prisma.document.findMany({
    where: { organizationId, deletedAt: null },
    select: {
      ownerType: true,
      ownerId: true,
      documentType: true,
      expiryDate: true,
      verificationStatus: true,
    },
  });

  const summary: ComplianceSummary = {
    total: documents.length,
    valid: 0,
    expiringSoon: 0,
    expired: 0,
    pendingVerification: 0,
    rejected: 0,
    missingMandatory: [],
  };

  for (const document of documents) {
    const { validity } = resolveDocumentValidity({
      expiryDate: document.expiryDate,
      verificationStatus: document.verificationStatus,
    });
    if (validity === DocumentValidity.EXPIRED) summary.expired += 1;
    else if (validity === DocumentValidity.EXPIRING_SOON) summary.expiringSoon += 1;
    else if (validity === DocumentValidity.PENDING_VERIFICATION) summary.pendingVerification += 1;
    else if (validity === DocumentValidity.REJECTED) summary.rejected += 1;
    else summary.valid += 1;
  }

  // Which mandatory documents have never been uploaded?
  const [trucks, drivers] = await Promise.all([
    prisma.truck.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, registrationNumber: true },
    }),
    prisma.driver.findMany({
      where: { organizationId, archivedAt: null },
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  const held = new Set(documents.map((document) => `${document.ownerId}:${document.documentType}`));

  for (const truck of trucks) {
    for (const definition of mandatoryDocumentTypes(DocumentOwnerType.TRUCK)) {
      if (!held.has(`${truck.id}:${definition.code}`)) {
        summary.missingMandatory.push({
          ownerType: DocumentOwnerType.TRUCK,
          ownerId: truck.id,
          ownerLabel: truck.registrationNumber,
          documentType: definition.code,
          label: definition.label,
        });
      }
    }
  }

  for (const driver of drivers) {
    for (const definition of mandatoryDocumentTypes(DocumentOwnerType.DRIVER)) {
      if (!held.has(`${driver.id}:${definition.code}`)) {
        summary.missingMandatory.push({
          ownerType: DocumentOwnerType.DRIVER,
          ownerId: driver.id,
          ownerLabel: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
          documentType: definition.code,
          label: definition.label,
        });
      }
    }
  }

  return summary;
}

/** Documents that need attention, ordered by urgency. Used by dashboards. */
export async function expiringDocuments(
  organizationId: string,
  withinDays = 30,
  limit = 25,
): Promise<DocumentSummary[]> {
  const documents = await prisma.document.findMany({
    where: {
      organizationId,
      deletedAt: null,
      expiryDate: { not: null, lte: new Date(Date.now() + withinDays * 86_400_000) },
    },
    orderBy: { expiryDate: 'asc' },
    take: limit,
  });

  return documents.map((document) => toSummary(document));
}
