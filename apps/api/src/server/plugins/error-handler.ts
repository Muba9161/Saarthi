import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ErrorCode, type ApiFailure } from '@saarthi/shared';
import { AppError, isAppError } from '../../lib/errors';
import { config } from '../../config/env';

/**
 * Centralised error translation.
 *
 * Anything thrown inside a route lands here and is turned into the standard
 * failure envelope. Unexpected errors are logged with their stack but the
 * client only ever receives a stable code and a safe message.
 */
function toFailure(error: unknown): { statusCode: number; body: ApiFailure } {
  if (isAppError(error)) {
    return {
      statusCode: error.statusCode,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
    };
  }

  if (error instanceof ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] = [...(fields[key] ?? []), issue.message];
    }
    return {
      statusCode: 400,
      body: {
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'The submitted data is not valid.',
          details: { fields },
        },
      },
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? (error.meta.target as string[]) : [];
      const field = target[0];
      return {
        statusCode: 409,
        body: {
          success: false,
          error: {
            code: ErrorCode.DUPLICATE_RESOURCE,
            message: field
              ? `Another record already uses this ${field}.`
              : 'Another record with these details already exists.',
            details: { fields: target },
          },
        },
      };
    }
    if (error.code === 'P2025') {
      return {
        statusCode: 404,
        body: {
          success: false,
          error: { code: ErrorCode.NOT_FOUND, message: 'The requested record could not be found.' },
        },
      };
    }
    if (error.code === 'P2003') {
      return {
        statusCode: 409,
        body: {
          success: false,
          error: {
            code: ErrorCode.CONFLICT,
            message: 'This record is still referenced by other data and cannot be changed.',
          },
        },
      };
    }
  }

  // Fastify-native errors (body parse failures, 404s, rate limits, multipart).
  const fastifyError = error as { statusCode?: number; code?: string; message?: string };
  if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
    const codeMap: Record<string, string> = {
      FST_ERR_VALIDATION: ErrorCode.VALIDATION_ERROR,
      FST_ERR_CTP_EMPTY_JSON_BODY: ErrorCode.VALIDATION_ERROR,
      FST_ERR_CTP_INVALID_MEDIA_TYPE: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
      FST_ERR_CTP_BODY_TOO_LARGE: ErrorCode.PAYLOAD_TOO_LARGE,
      FST_ERR_NOT_FOUND: ErrorCode.NOT_FOUND,
      FST_REQ_FILE_TOO_LARGE: ErrorCode.PAYLOAD_TOO_LARGE,
      FST_FILES_LIMIT: ErrorCode.VALIDATION_ERROR,
      FST_PARTS_LIMIT: ErrorCode.VALIDATION_ERROR,
      FST_FIELDS_LIMIT: ErrorCode.VALIDATION_ERROR,
    };

    /*
     * Busboy's own wording for these is "reach files limit" — no subject, no
     * number, nothing to do about it. Someone uploading a photo reads that as
     * a storage quota they have hit, which it is not.
     */
    const multipartMessage: Record<string, string> = {
      FST_FILES_LIMIT: 'Too many files were attached to this upload.',
      FST_PARTS_LIMIT: 'This upload had too many parts.',
      FST_FIELDS_LIMIT: 'This upload had too many fields.',
    };
    return {
      statusCode: fastifyError.statusCode,
      body: {
        success: false,
        error: {
          code: codeMap[fastifyError.code ?? ''] ?? ErrorCode.VALIDATION_ERROR,
          message:
            multipartMessage[fastifyError.code ?? ''] ??
            fastifyError.message ??
            'The request could not be processed.',
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      success: false,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Something went wrong while processing your request.',
        ...(config.isProduction
          ? {}
          : { details: { hint: (error as Error)?.message ?? String(error) } }),
      },
    },
  };
}

export const errorHandlerPlugin = fp(async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const { statusCode, body } = toFailure(error);

    const context = {
      requestId: request.id,
      method: request.method,
      url: request.url,
      userId: request.auth?.user.id,
      organizationId: request.auth?.organizationId,
      errorCode: body.error.code,
    };

    if (statusCode >= 500) {
      request.log.error({ ...context, err: error }, 'Unhandled error');
    } else if (statusCode === 401 || statusCode === 403) {
      request.log.warn(context, body.error.message);
    } else {
      request.log.info(context, body.error.message);
    }

    void reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      success: false,
      error: {
        code: ErrorCode.NOT_FOUND,
        message: `Route ${request.method} ${request.url} does not exist.`,
      },
    } satisfies ApiFailure);
  });
});

export { AppError };
