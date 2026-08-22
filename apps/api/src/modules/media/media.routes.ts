import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  Feature,
  MediaOwnerType,
  MediaPurpose,
  MediaVariant,
  Permission,
  mediaCacheControl,
  mediaListQuerySchema,
  mediaPurposesForOwner,
  moderateMediaSchema,
  reorderMediaSchema,
  updateMediaSchema,
  uploadMediaMetadataSchema,
  type MediaVisibility,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { storageProvider } from '../../providers/storage';
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
import { idParamSchema } from '@saarthi/shared';
import {
  requireAuth,
  requireFeature,
  requirePermission,
  requirePlatformAdmin,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as mediaService from './media.service';

/**
 * Media routes.
 *
 * The file endpoint is the odd one out: it is registered without the shared
 * `authenticate` preHandler so a PUBLIC asset can be served to a browser with
 * no session. Everything else requires one.
 */

/** Multipart parts the uploader sends: one image, one optional thumbnail. */
async function readMultipart(request: FastifyRequest): Promise<{
  fields: Record<string, string>;
  file: mediaService.UploadFilePart | null;
  thumbnail: mediaService.UploadFilePart | null;
}> {
  const fields: Record<string, string> = {};
  let file: mediaService.UploadFilePart | null = null;
  let thumbnail: mediaService.UploadFilePart | null = null;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (part.file.truncated) {
        throw errors.payloadTooLarge(
          `The image is larger than the ${Math.round(config.media.maxFileSize / 1024 / 1024)} MB limit.`,
        );
      }
      const rendition: mediaService.UploadFilePart = {
        buffer,
        fileName: part.filename ?? 'image',
        declaredMimeType: part.mimetype ?? 'application/octet-stream',
      };
      if (part.fieldname === 'thumbnail') thumbnail = rendition;
      else file = rendition;
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }

  return { fields, file, thumbnail };
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------
  // File delivery. Outside the authenticated scope below, but with optional
  // auth attached: a PUBLIC asset must serve with no session at all, while an
  // ORGANIZATION asset still has to recognise its own tenant's session.
  // ---------------------------------------------------------------------
  app.get('/:id/file', { preHandler: app.optionalAuth }, async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const variantRaw = (request.query as { variant?: string }).variant;
    const variant: MediaVariant =
      variantRaw === MediaVariant.THUMB ? MediaVariant.THUMB : MediaVariant.ORIGINAL;

    // `authenticate` has not run on this route, so an anonymous caller simply
    // has no auth context — which `resolveForDownload` treats as "public only".
    const auth = request.auth ?? null;
    const { asset, storageKey, mimeType } = await mediaService.resolveForDownload(
      auth,
      id,
      variant,
    );

    // Content-addressed: the checksum changes only when the bytes do, so a
    // conditional request can be answered without touching storage.
    const etag = asset.checksum ? `"${asset.checksum}-${variant}"` : undefined;
    if (etag && request.headers['if-none-match'] === etag) {
      return reply.code(304).header('etag', etag).send();
    }

    const download = await storageProvider.download(storageKey);

    reply
      .header('content-type', mimeType)
      .header('content-length', download.size)
      .header('content-disposition', 'inline')
      .header('cache-control', mediaCacheControl(asset.visibility as MediaVisibility))
      .header('x-content-type-options', 'nosniff');

    if (etag) reply.header('etag', etag);

    return reply.send(download.stream);
  });

  // ---------------------------------------------------------------------
  // Everything below requires a session.
  // ---------------------------------------------------------------------
  app.register(async (scoped) => {
    scoped.addHook('preHandler', scoped.authenticate);

    /** Which photo kinds a given record accepts — used to build upload forms. */
    scoped.get('/purposes', async (request, reply) => {
      const ownerType = (request.query as { ownerType?: string }).ownerType?.toUpperCase();
      if (!ownerType || !(Object.values(MediaOwnerType) as string[]).includes(ownerType)) {
        throw errors.validation('Name the kind of record you are attaching an image to.');
      }
      return ok(reply, mediaPurposesForOwner(ownerType as MediaOwnerType));
    });

    scoped.post(
      '/',
      {
        preHandler: [
          requirePermission(Permission.MEDIA_UPLOAD),
          requireFeature(Feature.MEDIA_LIBRARY),
        ],
      },
      async (request, reply) => {
        const auth = requireAuth(request);

        if (!request.isMultipart()) {
          throw errors.validation('Images must be uploaded as multipart/form-data.');
        }

        const { fields, file, thumbnail } = await readMultipart(request);
        if (!file) throw errors.validation('Attach the image file to upload.');

        const metadata = parseInput(uploadMediaMetadataSchema, fields);
        const asset = await mediaService.uploadMedia(auth, metadata, {
          file,
          ...(thumbnail ? { thumbnail } : {}),
        });

        await auditFromRequest(request, {
          action: AuditAction.MEDIA_UPLOADED,
          entityType: 'MediaAsset',
          entityId: asset.id,
          organizationId: asset.organizationId,
          after: {
            ownerType: asset.ownerType,
            ownerId: asset.ownerId,
            purpose: asset.purpose,
            fileSize: asset.fileSize,
          },
        });

        return created(reply, asset);
      },
    );

    scoped.get(
      '/',
      { preHandler: requirePermission(Permission.MEDIA_READ) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const query = parseQuery(mediaListQuerySchema, request.query);
        const result = await mediaService.listMedia(auth, query);
        return paginated(reply, result.items, result.pagination);
      },
    );

    scoped.get(
      '/owner/:ownerType/:ownerId',
      { preHandler: requirePermission(Permission.MEDIA_READ) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const params = request.params as { ownerType: string; ownerId: string };
        const ownerType = params.ownerType.toUpperCase() as MediaOwnerType;
        if (!(Object.values(MediaOwnerType) as string[]).includes(ownerType)) {
          throw errors.validation('That is not a kind of record images attach to.');
        }

        const purposeRaw = (request.query as { purpose?: string }).purpose;
        const purposes = purposeRaw
          ? purposeRaw
              .split(',')
              .map((value) => value.trim().toUpperCase())
              .filter((value): value is MediaPurpose =>
                (Object.values(MediaPurpose) as string[]).includes(value),
              )
          : undefined;

        return ok(
          reply,
          await mediaService.listForOwner(auth, ownerType, params.ownerId, purposes),
        );
      },
    );

    scoped.get(
      '/:id',
      { preHandler: requirePermission(Permission.MEDIA_READ) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        return ok(reply, await mediaService.getMedia(auth, id));
      },
    );

    scoped.patch(
      '/:id',
      { preHandler: requirePermission(Permission.MEDIA_UPLOAD) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const input = parseBody(updateMediaSchema, request.body);
        const asset = await mediaService.updateMedia(auth, id, input);

        await auditFromRequest(request, {
          action: AuditAction.MEDIA_UPDATED,
          entityType: 'MediaAsset',
          entityId: id,
          organizationId: asset.organizationId,
          after: input,
        });

        return ok(reply, asset);
      },
    );

    scoped.post(
      '/:id/primary',
      { preHandler: requirePermission(Permission.MEDIA_UPLOAD) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const asset = await mediaService.setPrimary(auth, id);

        await auditFromRequest(request, {
          action: AuditAction.MEDIA_UPDATED,
          entityType: 'MediaAsset',
          entityId: id,
          organizationId: asset.organizationId,
          after: { isPrimary: true },
        });

        return ok(reply, asset);
      },
    );

    scoped.post(
      '/reorder',
      { preHandler: requirePermission(Permission.MEDIA_UPLOAD) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const input = parseBody(reorderMediaSchema, request.body);
        return ok(reply, await mediaService.reorderMedia(auth, input));
      },
    );

    scoped.delete(
      '/:id',
      { preHandler: requirePermission(Permission.MEDIA_DELETE) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        await mediaService.deleteMedia(auth, id);

        await auditFromRequest(request, {
          action: AuditAction.MEDIA_DELETED,
          entityType: 'MediaAsset',
          entityId: id,
        });

        return noContent(reply);
      },
    );

    scoped.post(
      '/:id/moderate',
      { preHandler: [requirePermission(Permission.MEDIA_MODERATE), requirePlatformAdmin()] },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const input = parseBody(moderateMediaSchema, request.body);
        const asset = await mediaService.moderateMedia(auth, id, input);

        await auditFromRequest(request, {
          action: AuditAction.MEDIA_MODERATED,
          entityType: 'MediaAsset',
          entityId: id,
          organizationId: asset.organizationId,
          after: { decision: input.decision, note: input.note ?? null },
        });

        return ok(reply, asset);
      },
    );
  });
}
