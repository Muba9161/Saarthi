import type { FastifyReply } from 'fastify';
import { type z, type ZodTypeAny } from 'zod';
import {
  buildPaginationMeta,
  type ApiSuccess,
  type Paginated,
  type PaginationMeta,
} from '@saarthi/shared';
import { errors } from './errors';

/**
 * Response and input helpers. Every route returns through `ok`/`created`/
 * `paginated`, which guarantees the `{ success, data }` envelope the client
 * expects, and parses input through `parse*`, which converts Zod failures into
 * a single, user-readable validation error.
 */

export function ok<T>(reply: FastifyReply, data: T, meta?: Record<string, unknown>): FastifyReply {
  const body: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
  return reply.code(200).send(body);
}

export function created<T>(reply: FastifyReply, data: T): FastifyReply {
  return reply.code(201).send({ success: true, data } satisfies ApiSuccess<T>);
}

export function noContent(reply: FastifyReply): FastifyReply {
  return reply.code(200).send({ success: true, data: null } satisfies ApiSuccess<null>);
}

export function paginated<T>(
  reply: FastifyReply,
  items: T[],
  pagination: PaginationMeta,
): FastifyReply {
  return reply
    .code(200)
    .send({ success: true, data: { items, pagination } } satisfies ApiSuccess<Paginated<T>>);
}

export function makePagination(page: number, pageSize: number, total: number): PaginationMeta {
  return buildPaginationMeta(page, pageSize, total);
}

export function skipTake(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function formatIssues(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    const bucket = fieldErrors[key] ?? [];
    bucket.push(issue.message);
    fieldErrors[key] = bucket;
  }
  return fieldErrors;
}

function firstMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'The submitted data is not valid.';
  const field = issue.path.join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}

/** Parse arbitrary input, throwing a 400 AppError with per-field details. */
export function parseInput<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw errors.validation(firstMessage(result.error), {
      fields: formatIssues(result.error),
    });
  }
  return result.data;
}

export const parseBody = parseInput;
export const parseQuery = parseInput;
export const parseParams = parseInput;

/** Strip `undefined` values so Prisma treats them as "leave unchanged". */
export function definedOnly<T extends Record<string, unknown>>(input: T): Partial<T> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value;
  }
  return output as Partial<T>;
}
