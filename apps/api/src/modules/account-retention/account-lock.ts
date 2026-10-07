import type { FastifyRequest } from 'fastify';
import { config } from '../../config/env';
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

interface ArchiveState {
  billingArchivedAt: Date | null;
  dataPurgeAt: Date | null;
}

/**
 * The archive as this deployment applies it.
 *
 * With `SUBSCRIPTION_ENFORCEMENT` off (development only; production refuses
 * to start that way) nothing is held for non-payment, so an account archived
 * before the flag was turned off reads as open. The columns are left as they
 * are: turn enforcement back on and the lock is exactly where it was.
 */
export function effectiveArchive(organization: ArchiveState): ArchiveState {
  if (!config.subscription.enforced) return { billingArchivedAt: null, dataPurgeAt: null };
  return { billingArchivedAt: organization.billingArchivedAt, dataPurgeAt: organization.dataPurgeAt };
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
