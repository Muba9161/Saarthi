import type { FastifyInstance } from 'fastify';
import {
  Permission,
  idParamSchema,
  ownershipReviewDecisionSchema,
  ownershipReviewLatestQuerySchema,
  ownershipReviewListQuerySchema,
  ownershipReviewRequestSchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requirePermission } from '../../server/guards';
import type { UploadFileInput } from '../documents/document.service';
import * as reviews from './ownership-review.service';

/**
 * Asking the Saarthi team to confirm a vehicle is the account's.
 *
 * Multipart, so the RC can come along; it is optional, and a request with only
 * a message is sent as plain fields. Who may ask depends on what is asked
 * about, so the service checks it: the account's own vehicle takes
 * `VEHICLES_UPDATE`, a plate another account holds `VEHICLES_CREATE`.
 */
export async function ownershipReviewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.post(
    '/',
    // A request is a person's time; nobody needs to send many.
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const fields: Record<string, string> = {};
      let attachment: UploadFileInput | null = null;

      if (request.isMultipart()) {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            const buffer = await part.toBuffer();
            if (part.file.truncated) {
              throw errors.payloadTooLarge(
                `The file is larger than the ${Math.round(config.storage.maxFileSize / 1024 / 1024)} MB limit.`,
              );
            }
            // An empty file input still arrives as a part; it is no attachment.
            if (buffer.byteLength > 0) {
              attachment = { buffer, fileName: part.filename, declaredMimeType: part.mimetype };
            }
          } else if (typeof part.value === 'string') {
            fields[part.fieldname] = part.value;
          }
        }
      } else {
        Object.assign(fields, request.body as Record<string, string> | null);
      }

      const input = parseBody(ownershipReviewRequestSchema, {
        ...(fields.vehicleId ? { vehicleId: fields.vehicleId } : {}),
        ...(fields.registrationNumber ? { registrationNumber: fields.registrationNumber } : {}),
        message: fields.message ?? '',
      });
      return created(reply, await reviews.requestOwnershipReview(auth, input, attachment));
    },
  );

  /** Where the account's latest request for a vehicle or plate stands. */
  app.get('/latest', async (request, reply) => {
    const auth = requireAuth(request);
    const query = parseQuery(ownershipReviewLatestQuerySchema, request.query);
    return ok(reply, await reviews.latestOwnershipReview(auth, query));
  });
}

/** The reviewer's side: platform staff holding `VERIFICATION_REVIEW`. */
export async function ownershipReviewAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const reviewer = { preHandler: requirePermission(Permission.VERIFICATION_REVIEW) };

  app.get('/', reviewer, async (request, reply) => {
    const query = parseQuery(ownershipReviewListQuerySchema, request.query);
    const result = await reviews.listOwnershipReviews(query);
    return paginated(reply, result.items, result.pagination);
  });

  app.get('/:id', reviewer, async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await reviews.getOwnershipReview(id));
  });

  /** The RC or document the owner attached, shown inline to the reviewer. */
  app.get('/:id/attachment', reviewer, async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const file = await reviews.ownershipReviewAttachment(id);
    return reply
      .header('content-type', file.mimeType)
      .header('content-length', file.size)
      .header('content-disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(file.stream);
  });

  app.post('/:id/decision', reviewer, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(ownershipReviewDecisionSchema, request.body);
    return ok(reply, await reviews.decideOwnershipReview(auth, id, input));
  });
}
