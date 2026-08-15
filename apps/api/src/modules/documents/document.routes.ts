import type { FastifyInstance } from 'fastify';
import {
  DOCUMENT_TYPES,
  DocumentOwnerType,
  Permission,
  documentListQuerySchema,
  idParamSchema,
  reviewDocumentSchema,
  updateDocumentSchema,
  uploadDocumentMetadataSchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import {
  created,
  noContent,
  ok,
  paginated,
  parseBody,
  parseInput,
  parseParams,
  parseQuery,
} from '../../lib/http';
import { requireAuth, requireOrganizationId, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as documentService from './document.service';

/**
 * Document routes.
 *
 * Uploads arrive as multipart: the file part is buffered (bounded by the
 * configured limit) and the metadata fields are validated with the same Zod
 * schema the client uses, so no untyped value reaches the service layer.
 */
export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // Catalogue of configurable document types, used to build upload forms.
  app.get('/types', async (request, reply) => {
    const ownerType = (request.query as { ownerType?: string }).ownerType;
    const types = ownerType
      ? DOCUMENT_TYPES.filter((definition) => definition.ownerType === ownerType)
      : DOCUMENT_TYPES;
    return ok(reply, types);
  });

  app.get(
    '/',
    { preHandler: requirePermission(Permission.DOCUMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(documentListQuerySchema, request.query);
      const result = await documentService.listDocuments(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/compliance',
    { preHandler: requirePermission(Permission.DOCUMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      return ok(reply, await documentService.complianceSummary(auth, organizationId));
    },
  );

  app.get(
    '/expiring',
    { preHandler: requirePermission(Permission.DOCUMENTS_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const within = Number((request.query as { withinDays?: string }).withinDays ?? 30);
      const withinDays = Number.isFinite(within) ? Math.min(365, Math.max(1, within)) : 30;
      return ok(reply, await documentService.expiringDocuments(organizationId, withinDays));
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.DOCUMENTS_UPLOAD) },
    async (request, reply) => {
      const auth = requireAuth(request);

      if (!request.isMultipart()) {
        throw errors.validation('Documents must be uploaded as multipart/form-data.');
      }

      const fields: Record<string, string> = {};
      let file: { buffer: Buffer; fileName: string; declaredMimeType: string } | null = null;

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          if (part.file.truncated) {
            throw errors.payloadTooLarge(
              `The file is larger than the ${Math.round(config.storage.maxFileSize / 1024 / 1024)} MB limit.`,
            );
          }
          file = {
            buffer,
            fileName: part.filename ?? 'document',
            declaredMimeType: part.mimetype ?? 'application/octet-stream',
          };
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value;
        }
      }

      if (!file) throw errors.validation('Attach the document file to upload.');

      const metadata = parseInput(uploadDocumentMetadataSchema, fields);
      const document = await documentService.uploadDocument(auth, metadata, file);

      await auditFromRequest(request, {
        action: AuditAction.DOCUMENT_UPLOADED,
        entityType: 'Document',
        entityId: document.id,
        organizationId: document.organizationId,
        after: {
          ownerType: document.ownerType,
          ownerId: document.ownerId,
          documentType: document.documentType,
          version: document.currentVersion,
        },
      });

      return created(reply, document);
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.DOCUMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await documentService.getDocument(auth, id));
    },
  );

  app.get(
    '/:id/versions',
    { preHandler: requirePermission(Permission.DOCUMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await documentService.documentVersions(auth, id));
    },
  );

  // Streams the file itself. `?disposition=inline` powers in-browser preview.
  app.get(
    '/:id/download',
    { preHandler: requirePermission(Permission.DOCUMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const inline = (request.query as { disposition?: string }).disposition === 'inline';

      const { stream, document } = await documentService.downloadDocument(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.DOCUMENT_DOWNLOADED,
        entityType: 'Document',
        entityId: id,
        organizationId: document.organizationId,
      });

      const safeName = document.fileName.replace(/"/g, '');
      return reply
        .header('content-type', document.mimeType)
        .header('content-length', document.fileSize)
        .header(
          'content-disposition',
          `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
        )
        // Documents are private: never cached by a shared proxy.
        .header('cache-control', 'private, no-store')
        .send(stream);
    },
  );

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.DOCUMENTS_UPLOAD) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateDocumentSchema, request.body);
      const document = await documentService.updateDocument(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.DOCUMENT_REPLACED,
        entityType: 'Document',
        entityId: id,
        after: input,
      });

      return ok(reply, document);
    },
  );

  app.post(
    '/:id/review',
    { preHandler: requirePermission(Permission.DOCUMENTS_VERIFY) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(reviewDocumentSchema, request.body);
      const document = await documentService.reviewDocument(auth, id, input);

      await auditFromRequest(request, {
        action:
          input.decision === 'VERIFIED'
            ? AuditAction.DOCUMENT_VERIFIED
            : input.decision === 'REJECTED'
              ? AuditAction.DOCUMENT_REJECTED
              : AuditAction.DOCUMENT_REPLACED,
        entityType: 'Document',
        entityId: id,
        organizationId: document.organizationId,
        after: { decision: input.decision, reason: input.rejectionReason ?? null },
      });

      return ok(reply, document);
    },
  );

  app.delete(
    '/:id',
    { preHandler: requirePermission(Permission.DOCUMENTS_DELETE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await documentService.deleteDocument(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.DOCUMENT_DELETED,
        entityType: 'Document',
        entityId: id,
      });

      return noContent(reply);
    },
  );

  // Convenience listing scoped to a single owner entity.
  app.get(
    '/owner/:ownerType/:ownerId',
    { preHandler: requirePermission(Permission.DOCUMENTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const params = request.params as { ownerType: string; ownerId: string };
      const ownerType = params.ownerType.toUpperCase() as DocumentOwnerType;
      if (!Object.values(DocumentOwnerType).includes(ownerType)) {
        throw errors.validation('Unsupported document owner type.');
      }
      const query = parseQuery(documentListQuerySchema, {
        ...(request.query as object),
        ownerType,
        ownerId: params.ownerId,
      });
      const result = await documentService.listDocuments(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );
}
