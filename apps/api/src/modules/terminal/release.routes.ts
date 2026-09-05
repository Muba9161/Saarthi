import type { FastifyInstance } from 'fastify';
import { Permission, createTerminalReleaseSchema, idParamSchema } from '@saarthi/shared';
import { errors } from '../../lib/errors';
import { created, ok, parseParams } from '../../lib/http';
import { requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import {
  MAX_RELEASE_BYTES,
  archiveRelease,
  createRelease,
  listReleases,
  publishRelease,
} from './release.service';

/**
 * Shipping a new Saarthi Terminal build to the fleet.
 *
 * Platform administration, not fleet administration: there is one Terminal app,
 * and a fleet running a private build of it is a support case nobody could
 * reason about. Every route here requires `ADMIN_PLATFORM`.
 *
 * The device's half of this pipeline — the update check and the download — is
 * in `terminal-client.routes.ts`, behind device credentials.
 */
export async function terminalReleaseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /** Every release, newest first, with how much of the fleet is on each. */
  app.get(
    '/',
    { preHandler: requirePermission(Permission.ADMIN_PLATFORM) },
    async (_request, reply) => ok(reply, await listReleases()),
  );

  /**
   * Upload an APK.
   *
   * It arrives as a draft. Nothing here offers it to a vehicle.
   */
  app.post(
    '/',
    { preHandler: requirePermission(Permission.ADMIN_PLATFORM) },
    async (request, reply) => {
      if (!request.isMultipart()) {
        throw errors.validation('The APK must be uploaded as multipart/form-data.');
      }

      const fields: Record<string, string> = {};
      let apk: { buffer: Buffer; fileName: string } | null = null;

      /*
       * A raised size limit, for this route only.
       *
       * The application-wide multipart ceiling is the document limit — a few
       * megabytes, which is right for a photograph of an RC book and an order
       * of magnitude below any APK. Left alone, busboy truncates the upload and
       * reports a limit nobody set, on a file the uploader can plainly see is
       * fine. Raised only here; every other route keeps rejecting a large file,
       * which is the actual protection.
       */
      for await (const part of request.parts({ limits: { fileSize: MAX_RELEASE_BYTES, files: 1 } })) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          if (part.file.truncated) {
            throw errors.payloadTooLarge(
              `A release may be at most ${Math.round(MAX_RELEASE_BYTES / 1024 / 1024)} MB.`,
            );
          }
          apk = { buffer, fileName: part.filename ?? 'saarthi-terminal.apk' };
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value;
        }
      }

      if (!apk) throw errors.validation('No APK was attached.');

      const input = createTerminalReleaseSchema.parse({
        notes: fields.notes,
        // A checkbox arrives as the string "true"; anything else is false.
        mandatory: fields.mandatory === 'true',
      });

      const userId = request.auth?.user.id;
      if (!userId) throw errors.unauthenticated();

      const release = await createRelease({
        bytes: apk.buffer,
        fileName: apk.fileName,
        notes: input.notes ?? null,
        mandatory: input.mandatory,
        uploadedById: userId,
      });

      await auditFromRequest(request, {
        action: AuditAction.TERMINAL_RELEASE_UPLOADED,
        entityType: 'TerminalRelease',
        entityId: release.id,
        after: {
          versionCode: release.info.versionCode,
          versionName: release.info.versionName,
          sha256: release.info.sha256,
        },
      });

      return created(reply, { id: release.id, ...release.info });
    },
  );

  /**
   * Offer it to the fleet.
   *
   * The moment after this returns, terminals begin seeing an update button.
   * Audited with the version, because "who shipped this and when" is the first
   * question asked when a build misbehaves in the field.
   */
  app.post(
    '/:id/publish',
    { preHandler: requirePermission(Permission.ADMIN_PLATFORM) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      const userId = request.auth?.user.id;
      if (!userId) throw errors.unauthenticated();

      await publishRelease(id, userId);
      await auditFromRequest(request, {
        action: AuditAction.TERMINAL_RELEASE_PUBLISHED,
        entityType: 'TerminalRelease',
        entityId: id,
        after: { status: 'PUBLISHED' },
      });

      return ok(reply, { published: true });
    },
  );

  /**
   * Withdraw it.
   *
   * Terminals stop being offered it. Those that already installed it keep
   * running it — an install cannot be recalled, and the way to undo a bad
   * release is to publish a fixed one with a higher version code.
   */
  app.post(
    '/:id/archive',
    { preHandler: requirePermission(Permission.ADMIN_PLATFORM) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);

      await archiveRelease(id);
      await auditFromRequest(request, {
        action: AuditAction.TERMINAL_RELEASE_ARCHIVED,
        entityType: 'TerminalRelease',
        entityId: id,
        after: { status: 'ARCHIVED' },
      });

      return ok(reply, { archived: true });
    },
  );
}
