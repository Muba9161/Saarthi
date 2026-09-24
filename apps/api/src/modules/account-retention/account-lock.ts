import type { FastifyRequest } from 'fastify';
import { errors } from '../../lib/errors';
import type { AuthContext } from '../../auth/context';

/**
 * What an archived account can still reach.
 *
 * Archived means locked: the owner can sign in, see what is owed and renew,
 * and nothing else. Two exceptions are about people rather than billing —
 * signing out, and SOS, which is never blocked by a plan or a payment.
 */
const OPEN_WHILE_ARCHIVED: readonly (string | RegExp)[] = [
  /^\/api\/v1\/auth\//,
  '/api/v1/subscriptions/plan',
  /^\/api\/v1\/subscriptions\/billing(\/|$)/,
  /^\/api\/v1\/payments\//,
  /^\/api\/v1\/notifications(\/|$)/,
  /^\/api\/v1\/sos(\/|$)/,
];

function isOpen(path: string): boolean {
  return OPEN_WHILE_ARCHIVED.some((rule) => (typeof rule === 'string' ? rule === path : rule.test(path)));
}

/** Refuse the request if the caller's organization is archived for non-payment. */
export function assertAccountNotArchived(auth: AuthContext, request: FastifyRequest): void {
  const organization = auth.organization;
  if (!organization?.billingArchivedAt || auth.isPlatformAdmin) return;

  const path = request.url.split('?')[0] ?? request.url;
  if (isOpen(path)) return;

  throw errors.accountArchived({
    archivedAt: organization.billingArchivedAt.toISOString(),
    dataPurgeAt: organization.dataPurgeAt?.toISOString() ?? null,
  });
}
