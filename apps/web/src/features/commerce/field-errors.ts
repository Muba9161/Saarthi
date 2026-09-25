import type { ApiError } from '@/lib/api-client';

/**
 * Server validation messages keyed the way the commerce forms key their
 * fields: `attributes.grade` becomes `grade`, so a detail the server refused
 * is marked on the input the user typed it into.
 */
export function fieldErrorsFrom(error: ApiError): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [path, messages] of Object.entries(
    error.fieldErrors as Record<string, string | string[]>,
  )) {
    const message = Array.isArray(messages) ? messages[0] : messages;
    if (!message) continue;
    mapped[path.startsWith('attributes.') ? path.slice('attributes.'.length) : path] = message;
  }
  return mapped;
}
