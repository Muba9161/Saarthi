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

  VEHICLE_RC_LOOKUP: 'vehicle.rc_lookup',
  DRIVER_LICENCE_LOOKUP: 'driver.licence_lookup',
  VEHICLE_RC_PDF_DOWNLOADED: 'vehicle.rc_pdf_downloaded',

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

  VEHICLE_CREATED: 'vehicle.created',
  VEHICLE_UPDATED: 'vehicle.updated',
  VEHICLE_ARCHIVED: 'vehicle.archived',

  ASSOCIATION_REGISTERED: 'association.registered',
  ASSOCIATION_UPDATED: 'association.updated',
  ASSOCIATION_VERIFIED: 'association.verified',
  ASSOCIATION_COVERAGE_UPDATED: 'association.coverage_updated',
  ASSOCIATION_ALERT_CREATED: 'association.alert_created',
  ASSOCIATION_ALERT_ACKNOWLEDGED: 'association.alert_acknowledged',
  ASSOCIATION_ALERT_RESPONDER_ASSIGNED: 'association.alert_responder_assigned',
  ASSOCIATION_ALERT_ESCALATED: 'association.alert_escalated',
  ASSOCIATION_ALERT_RESOLVED: 'association.alert_resolved',
  /// A named user viewed personal contact details on an alert.
  ASSOCIATION_SENSITIVE_ACCESS: 'association.sensitive_access',

  PROVIDER_PROFILE_UPDATED: 'provider.profile_updated',
  TRAVEL_PACKAGE_CREATED: 'travel.package_created',
  TRAVEL_PACKAGE_UPDATED: 'travel.package_updated',
  TRAVEL_PACKAGE_PUBLISHED: 'travel.package_published',
  TRAVEL_PACKAGE_ARCHIVED: 'travel.package_archived',
  BOOKING_CREATED: 'booking.created',
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_DECLINED: 'booking.declined',
  BOOKING_CANCELLED: 'booking.cancelled',
  BOOKING_COMPLETED: 'booking.completed',
  BOOKING_RATED: 'booking.rated',

  PAYMENT_INITIATED: 'payment.initiated',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',

  DEVICE_REGISTERED: 'device.registered',
  DEVICE_UPDATED: 'device.updated',
  DEVICE_ASSIGNED: 'device.assigned',
  DEVICE_UNASSIGNED: 'device.unassigned',
  DEVICE_SECRET_ROTATED: 'device.secret_rotated',
  DEVICE_SUSPENDED: 'device.suspended',
  DEVICE_RETIRED: 'device.retired',
  DEVICE_TELEMETRY_REJECTED: 'device.telemetry_rejected',
  MOCK_DEVICE_STARTED: 'device.mock_started',
  MOCK_DEVICE_STOPPED: 'device.mock_stopped',

  TELEMETRY_ALERT_UPDATED: 'telemetry.alert_updated',
  TELEMETRY_RULE_UPDATED: 'telemetry.rule_updated',
  GEOFENCE_UPDATED: 'telemetry.geofence_updated',

  MEDIA_UPLOADED: 'media.uploaded',
  MEDIA_UPDATED: 'media.updated',
  MEDIA_DELETED: 'media.deleted',
  MEDIA_MODERATED: 'media.moderated',

  STOCK_OPENED: 'stock.opened',
  STOCK_RECEIVED: 'stock.received',
  STOCK_ADJUSTED: 'stock.adjusted',
  STOCK_COUNTED: 'stock.counted',
  STOCK_DAMAGED: 'stock.damaged',
  STOCK_TRANSFERRED: 'stock.transferred',
  STOCK_RESERVED: 'stock.reserved',
  STOCK_RELEASED: 'stock.released',
  STOCK_CONSUMED: 'stock.consumed',
  INVENTORY_LOCATION_CREATED: 'inventory.location_created',
  INVENTORY_LOCATION_UPDATED: 'inventory.location_updated',

  LISTING_CREATED: 'resale.listing_created',
  LISTING_UPDATED: 'resale.listing_updated',
  LISTING_SUBMITTED: 'resale.listing_submitted',
  LISTING_PUBLISHED: 'resale.listing_published',
  LISTING_REVIEWED: 'resale.listing_reviewed',
  LISTING_WITHDRAWN: 'resale.listing_withdrawn',
  LISTING_OFFER_CREATED: 'resale.offer_created',
  LISTING_OFFER_ACCEPTED: 'resale.offer_accepted',
  LISTING_OFFER_REJECTED: 'resale.offer_rejected',
  LISTING_SOLD: 'resale.listing_sold',
  /// Moves an asset between tenants — one of the two most consequential
  /// actions on the platform, alongside a deliberate city-access override.
  VEHICLE_OWNERSHIP_TRANSFERRED: 'resale.ownership_transferred',
  VEHICLE_TRANSFER_ADVANCED: 'resale.transfer_advanced',

  PROFILE_SECTION_UPDATED: 'profile.section_updated',
  PROFILE_SLUG_SET: 'profile.slug_set',

  QR_CREATED: 'qr.created',
  QR_ROTATED: 'qr.rotated',
  QR_REVOKED: 'qr.revoked',
  QR_SCANNED: 'qr.scanned',
  QR_ACTION_PERFORMED: 'qr.action_performed',
  QR_PRIVACY_POLICY_UPDATED: 'qr.privacy_policy_updated',

  RETURN_LOAD_CREATED: 'returnload.created',
  RETURN_LOAD_UPDATED: 'returnload.updated',
  RETURN_LOAD_CANCELLED: 'returnload.cancelled',
  RETURN_LOAD_MATCHED: 'returnload.matched',
  RETURN_LOAD_QUOTED: 'returnload.quoted',

  CITY_RESTRICTION_CREATED: 'cityaccess.restriction_created',
  CITY_RESTRICTION_UPDATED: 'cityaccess.restriction_updated',
  /// A dispatcher knowingly sent a vehicle into a restricted zone.
  CITY_ACCESS_OVERRIDDEN: 'cityaccess.overridden',

  TRANSFER_HUB_CREATED: 'relay.hub_created',
  TRANSFER_HUB_UPDATED: 'relay.hub_updated',
  RELAY_CREATED: 'relay.created',
  RELAY_BROADCAST: 'relay.broadcast',
  RELAY_OFFER_CREATED: 'relay.offer_created',
  RELAY_OFFER_ACCEPTED: 'relay.offer_accepted',
  RELAY_TRANSITIONED: 'relay.transitioned',
  RELAY_HANDOVER_VERIFIED: 'relay.handover_verified',
  LAST_MILE_PARTNER_UPDATED: 'relay.partner_updated',

  HAZARD_CREATED: 'routeintel.hazard_created',
  HAZARD_UPDATED: 'routeintel.hazard_updated',
  HAZARD_REPORTED: 'routeintel.hazard_reported',
  HAZARD_VOTED: 'routeintel.hazard_voted',
  HAZARD_VERIFIED: 'routeintel.hazard_verified',
  HAZARD_REMOVED: 'routeintel.hazard_removed',

  CAMERA_REGISTERED: 'camera.registered',
  /// Every live camera view. A lens pointed at a driver needs an access log.
  CAMERA_VIEWED: 'camera.viewed',

  FASTAG_REGISTERED: 'fastag.registered',
  /// A tag Saarthi found on NETC rather than one somebody typed in.
  FASTAG_DISCOVERED: 'fastag.discovered',
  FASTAG_SYNCED: 'fastag.synced',
  FASTAG_RECHARGE_RECORDED: 'fastag.recharge_recorded',
  TOLL_RECORDED: 'toll.recorded',
  TOLL_IMPORTED: 'toll.imported',

  SERVICE_RECORDED: 'service.recorded',
  SERVICE_VERIFIED: 'service.verified',
  SERVICE_SYNCED: 'service.synced',

  SUBSCRIPTION_TOPUP_PURCHASED: 'subscription.topup_purchased',
  SUBSCRIPTION_TOPUP_CANCELLED: 'subscription.topup_cancelled',

  LOAN_CREATED: 'loan.created',
  LOAN_UPDATED: 'loan.updated',
  LOAN_CLOSED: 'loan.closed',
  LOAN_PAYMENT_RECORDED: 'loan.payment_recorded',
  LOAN_INSTALLMENT_WAIVED: 'loan.installment_waived',
  LOAN_PROVIDER_SYNCED: 'loan.provider_synced',
  LOAN_SCHEDULE_IMPORTED: 'loan.schedule_imported',

  AI_QUERY: 'ai.query',

  // Saarthi Terminal.
  //
  // The approval entry is the one that matters. It records who authorised a
  // named person to take a specific vehicle out, and it is the record somebody
  // will look for months later after an incident.
  TERMINAL_PAIRING_ISSUED: 'terminal.pairing_issued',
  TERMINAL_ASSIGNMENT_REQUESTED: 'terminal.assignment_requested',
  TERMINAL_ASSIGNMENT_APPROVED: 'terminal.assignment_approved',
  TERMINAL_ASSIGNMENT_REJECTED: 'terminal.assignment_rejected',
  TERMINAL_CHECKLIST_UPDATED: 'terminal.checklist_updated',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
