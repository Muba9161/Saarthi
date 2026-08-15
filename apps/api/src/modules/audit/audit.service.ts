import type { FastifyRequest } from 'fastify';
import { prisma, type Db } from '../../database/prisma';
import { logger } from '../../lib/logger';

/**
 * Audit trail.
 *
 * Writes are best-effort by design: an audit failure must never roll back or
 * block the business operation that succeeded, but it is always logged loudly.
 * Sensitive fields are stripped before anything is persisted.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'token',
  'tokenhash',
  'accesstoken',
  'refreshtoken',
  'refreshtokenhash',
  'secret',
  'apikey',
  'authorization',
  'cookie',
]);

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactSensitive(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEYS.has(key.toLowerCase())
        ? '[redacted]'
        : redactSensitive(item, depth + 1);
    }
    return output;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  actorUserId?: string | null;
  organizationId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export async function recordAudit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        actorUserId: entry.actorUserId ?? null,
        organizationId: entry.organizationId ?? null,
        beforeData: entry.before === undefined ? undefined : (redactSensitive(entry.before) as never),
        afterData: entry.after === undefined ? undefined : (redactSensitive(entry.after) as never),
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        requestId: entry.requestId ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: entry.action, entityType: entry.entityType }, 'Audit write failed');
  }
}

/** Convenience wrapper that pulls actor/tenant/request metadata off the request. */
export async function auditFromRequest(
  request: FastifyRequest,
  entry: Omit<AuditEntry, 'actorUserId' | 'organizationId' | 'ipAddress' | 'userAgent' | 'requestId'> & {
    organizationId?: string | null;
  },
  db: Db = prisma,
): Promise<void> {
  await recordAudit(
    {
      ...entry,
      actorUserId: request.auth?.user.id ?? null,
      organizationId: entry.organizationId ?? request.auth?.organizationId ?? null,
      ipAddress: request.clientIp ?? null,
      userAgent: request.headers['user-agent'] ?? null,
      requestId: String(request.id),
    },
    db,
  );
}

export const AuditAction = {
  USER_REGISTERED: 'user.registered',
  USER_LOGGED_IN: 'user.logged_in',
  USER_LOGIN_FAILED: 'user.login_failed',
  USER_LOGGED_OUT: 'user.logged_out',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  USER_PASSWORD_RESET_REQUESTED: 'user.password_reset_requested',
  USER_PASSWORD_RESET_COMPLETED: 'user.password_reset_completed',
  USER_PROFILE_UPDATED: 'user.profile_updated',
  USER_STATUS_CHANGED: 'user.status_changed',
  SESSION_REVOKED: 'session.revoked',

  ORGANIZATION_CREATED: 'organization.created',
  ORGANIZATION_UPDATED: 'organization.updated',
  MEMBERSHIP_CREATED: 'membership.created',
  MEMBERSHIP_UPDATED: 'membership.updated',
  MEMBERSHIP_REMOVED: 'membership.removed',

  TRUCK_CREATED: 'truck.created',
  TRUCK_UPDATED: 'truck.updated',
  TRUCK_ARCHIVED: 'truck.archived',
  TRUCK_DRIVER_ASSIGNED: 'truck.driver_assigned',
  TRUCK_DRIVER_UNASSIGNED: 'truck.driver_unassigned',

  DRIVER_CREATED: 'driver.created',
  DRIVER_UPDATED: 'driver.updated',
  DRIVER_SCORE_ADJUSTED: 'driver.score_adjusted',

  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_REPLACED: 'document.replaced',
  DOCUMENT_DOWNLOADED: 'document.downloaded',
  DOCUMENT_VERIFIED: 'document.verified',
  DOCUMENT_REJECTED: 'document.rejected',
  DOCUMENT_DELETED: 'document.deleted',

  VERIFICATION_SUBMITTED: 'verification.submitted',
  VERIFICATION_APPROVED: 'verification.approved',
  VERIFICATION_REJECTED: 'verification.rejected',
  VERIFICATION_CORRECTION_REQUESTED: 'verification.correction_requested',

  MATERIAL_CREATED: 'material.created',
  MATERIAL_UPDATED: 'material.updated',
  MATERIAL_DELETED: 'material.deleted',

  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  ORDER_STATUS_CHANGED: 'order.status_changed',
  ORDER_QUOTE_CREATED: 'order.quote_created',
  ORDER_QUOTE_ACCEPTED: 'order.quote_accepted',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_RATED: 'order.rated',

  TRIP_CREATED: 'trip.created',
  TRIP_STATUS_CHANGED: 'trip.status_changed',
  TRIP_UPDATED: 'trip.updated',

  MAINTENANCE_CREATED: 'maintenance.created',
  MAINTENANCE_UPDATED: 'maintenance.updated',
  FUEL_RECORDED: 'fuel.recorded',

  SOS_TRIGGERED: 'sos.triggered',
  SOS_UPDATED: 'sos.updated',
  SOS_RESOLVED: 'sos.resolved',

  SUBSCRIPTION_CHANGED: 'subscription.changed',

  SIMULATION_STARTED: 'simulation.started',
  SIMULATION_CONTROLLED: 'simulation.controlled',

  AI_QUERY: 'ai.query',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
