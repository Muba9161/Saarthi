import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errors } from '../../lib/errors';
import { deviceRateLimitKey } from '../devices/device-auth';

/**
 * HTTP helpers shared by the terminal route plugins.
 *
 * Every plugin mounted under `/device-gateway/terminal` rate-limits on the
 * device and reads uploads the same way; keeping one copy is what stops two
 * plugins drifting into two different limits for the same tablet.
 */

/**
 * A path id, validated before it reaches a query.
 *
 * A uuid check here is what keeps a malformed path out of the database layer
 * entirely.
 */
export const idParamSchema = z.object({ id: z.string().uuid() });

/** Rate-limit configuration for a terminal route, keyed on the device. */
export function terminalLimit(max: number, timeWindow = '1 minute') {
  return {
    rateLimit: {
      max,
      timeWindow,
      keyGenerator: (request: FastifyRequest) => deviceRateLimitKey(request),
    },
  };
}

export interface TerminalUploadFile {
  buffer: Buffer;
  fileName: string;
  declaredMimeType: string;
}

/**
 * One file and some fields, from a terminal.
 *
 * A reader of its own rather than the fleet routes' selfie reader: that one
 * accepts a second file for a caller-supplied thumbnail, and nothing a terminal
 * uploads needs one. Accepting exactly one file is the protection, not a
 * limitation.
 */
export async function readTerminalUpload(request: FastifyRequest): Promise<{
  fields: Record<string, string>;
  file: TerminalUploadFile | null;
}> {
  const fields: Record<string, string> = {};
  let file: TerminalUploadFile | null = null;

  for await (const part of request.parts({ limits: { files: 1 } })) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (part.file.truncated) {
        throw errors.payloadTooLarge(
          'That photograph is too large. Take it again at a lower resolution.',
        );
      }
      file = {
        buffer,
        fileName: part.filename ?? 'photo.jpg',
        declaredMimeType: part.mimetype ?? 'application/octet-stream',
      };
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }

  return { fields, file };
}
