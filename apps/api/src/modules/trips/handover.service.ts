import crypto from 'node:crypto';
import {
  ErrorCode,
  HandoverPurpose,
  NotificationChannel,
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  type HandoverOverrideInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { AuthContext } from '../../auth/context';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notify, notifyOrganization } from '../notifications/notification.service';

/**
 * Handover codes — the customer's 4-digit code the driver types to finish a
 * delivery or start a ride, the way a ride app's OTP works.
 *
 *   goods set off → delivery code to the customer → driver enters it to complete
 *   ride confirmed → pickup code to the passenger → driver enters it to start
 *
 * The code is made by the server and checked by the server; the apps only
 * carry it. A customer who cannot give it is covered by the business owner's
 * override, which needs a written reason and is audited. There is no other
 * way past it. Trips that never had a code (older ones) are not held up.
 */

/** Wrong entries allowed before only an override can clear the handover. */
export const MAX_HANDOVER_ATTEMPTS = 5;
const MAX_ATTEMPTS = MAX_HANDOVER_ATTEMPTS;

/** The code goes everywhere the customer might look: the app, the phone's notification, and SMS. */
const CODE_CHANNELS = [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.SMS];

/**
 * Who may clear a handover without the code: whoever owns the operating
 * business, freight or travel. A taxi or tour owner holds MOBILITY_PROVIDER,
 * not FLEET_OWNER, so a list naming only the latter left them no way past a
 * passenger who could not give the code.
 */
const OVERRIDE_ROLES: ReadonlySet<string> = new Set(OPERATOR_OWNER_ROLES);

export type HandoverStatus = 'PENDING' | 'VERIFIED' | 'OVERRIDDEN';

/** A handover as the fleet sees it — never the code itself. */
export interface HandoverView {
  purpose: HandoverPurpose;
  status: HandoverStatus;
  attemptsLeft: number;
  verifiedAt: string | null;
  overriddenAt: string | null;
  overrideReason: string | null;
}

/** As the customer sees it: the code, while it is still needed. */
export interface CustomerHandoverView extends HandoverView {
  code: string | null;
}

type HandoverRow = NonNullable<Awaited<ReturnType<typeof prisma.handoverCode.findUnique>>>;

function newCode(): string {
  return crypto.randomInt(0, 10_000).toString().padStart(4, '0');
}

function statusOf(row: HandoverRow): HandoverStatus {
  if (row.verifiedAt) return 'VERIFIED';
  if (row.overriddenAt) return 'OVERRIDDEN';
  return 'PENDING';
}

function viewOf(row: HandoverRow): HandoverView {
  return {
    purpose: row.purpose as HandoverPurpose,
    status: statusOf(row),
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - row.attempts),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    overriddenAt: row.overriddenAt?.toISOString() ?? null,
    overrideReason: row.overrideReason,
  };
}

/** Make a code once; a second caller racing the first gets the same row. */
async function createOnce(data: {
  tripId: string;
  purpose: HandoverPurpose;
  orderId?: string | null;
  bookingId?: string | null;
  customerOrganizationId: string;
}): Promise<{ row: HandoverRow; fresh: boolean }> {
  const existing = await prisma.handoverCode.findUnique({
    where: { tripId_purpose: { tripId: data.tripId, purpose: data.purpose } },
  });
  if (existing) return { row: existing, fresh: false };
  try {
    const row = await prisma.handoverCode.create({ data: { ...data, code: newCode() } });
    return { row, fresh: true };
  } catch {
    const row = await prisma.handoverCode.findUniqueOrThrow({
      where: { tripId_purpose: { tripId: data.tripId, purpose: data.purpose } },
    });
    return { row, fresh: false };
  }
}

/**
 * The delivery code for an order's trip, made as the goods set off. Returns
 * the code when it was made just now (so the "on the way" message can carry
 * it), null when the trip is not an order or already had one.
 */
export async function issueDeliveryCode(tripId: string): Promise<string | null> {
  const order = await prisma.order.findFirst({
    where: { tripId },
    select: { id: true, customerOrganizationId: true },
  });
  if (!order) return null;
  const { row, fresh } = await createOnce({
    tripId,
    purpose: HandoverPurpose.DELIVERY,
    orderId: order.id,
    customerOrganizationId: order.customerOrganizationId,
  });
  return fresh ? row.code : null;
}

/**
 * The pickup code for a confirmed ride, sent to whoever booked it. Called
 * once the operator has confirmed and the ride has a trip.
 */
export async function issuePickupCode(bookingId: string): Promise<void> {
  const booking = await prisma.travelBooking.findUnique({
    where: { id: bookingId },
    select: { id: true, reference: true, tripId: true, customerOrganizationId: true, bookedByUserId: true },
  });
  if (!booking?.tripId) return;
  const { row, fresh } = await createOnce({
    tripId: booking.tripId,
    purpose: HandoverPurpose.PICKUP,
    bookingId: booking.id,
    customerOrganizationId: booking.customerOrganizationId,
  });
  if (!fresh) return;
  void notify({
    userId: booking.bookedByUserId,
    organizationId: booking.customerOrganizationId,
    type: NotificationType.BOOKING_CONFIRMED,
    title: `Your pickup code is ${row.code}`,
    body: `${booking.reference}: tell this code to the driver when they arrive. The ride starts only once they enter it.`,
    priority: NotificationPriority.HIGH,
    actionUrl: `/travel/bookings/${booking.id}`,
    channels: CODE_CHANNELS,
  });
}

/** The channels the "on the way" message uses when it carries a fresh code. */
export const deliveryCodeChannels = CODE_CHANNELS;

/**
 * Let the trip pass the handover only with the customer's code — or after the
 * owner's override. Nothing to do when the trip has no code of this kind, or
 * it is already cleared. A right code is recorded as verified and audited; a
 * wrong one counts against the tries.
 */
export async function clearHandover(
  tripId: string,
  purpose: HandoverPurpose,
  code: string | undefined,
  actorUserId: string,
): Promise<void> {
  const row = await prisma.handoverCode.findUnique({ where: { tripId_purpose: { tripId, purpose } } });
  if (!row || row.verifiedAt || row.overriddenAt) return;

  const detail = (extra: Record<string, unknown>) => ({ handover: { purpose, ...extra } });
  if (row.attempts >= MAX_ATTEMPTS) {
    throw errors.handover(
      ErrorCode.HANDOVER_CODE_LOCKED,
      'Too many wrong codes. The owner can clear it with a reason from the Saarthi app.',
      detail({ locked: true, attemptsLeft: 0 }),
    );
  }
  if (!code) {
    throw errors.handover(
      ErrorCode.HANDOVER_CODE_REQUIRED,
      purpose === HandoverPurpose.DELIVERY
        ? "Ask the customer for their 4-digit delivery code."
        : "Ask the passenger for their 4-digit pickup code.",
      detail({ required: true, attemptsLeft: MAX_ATTEMPTS - row.attempts }),
    );
  }

  const given = Buffer.from(code);
  const expected = Buffer.from(row.code);
  const matches = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!matches) {
    const updated = await prisma.handoverCode.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    const left = Math.max(0, MAX_ATTEMPTS - updated.attempts);
    throw errors.handover(
      left > 0 ? ErrorCode.HANDOVER_CODE_WRONG : ErrorCode.HANDOVER_CODE_LOCKED,
      left > 0
        ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
        : 'That code is not right, and no tries are left. The owner can clear it with a reason from the Saarthi app.',
      detail({ wrong: true, attemptsLeft: left }),
    );
  }

  await prisma.handoverCode.updateMany({
    where: { id: row.id, verifiedAt: null },
    data: { verifiedAt: new Date(), verifiedByUserId: actorUserId },
  });
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { organizationId: true } });
  await recordAudit({
    action: AuditAction.HANDOVER_CODE_VERIFIED,
    entityType: 'Trip',
    entityId: tripId,
    actorUserId,
    organizationId: trip?.organizationId ?? null,
    after: { purpose },
  });
}

/** The handovers on a trip, for the fleet that runs it. */
export async function handoversForTrip(auth: AuthContext, tripId: string): Promise<HandoverView[]> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { organizationId: true } });
  if (!trip || (!auth.isPlatformAdmin && trip.organizationId !== auth.organizationId)) {
    throw errors.notFound('Trip');
  }
  const rows = await prisma.handoverCode.findMany({ where: { tripId }, orderBy: { createdAt: 'asc' } });
  return rows.map(viewOf);
}

/** The customer's own code for an order or a booking — only theirs, and only while it is needed. */
export async function handoverForCustomer(
  auth: AuthContext,
  target: { orderId?: string; bookingId?: string },
): Promise<CustomerHandoverView | null> {
  const row = await prisma.handoverCode.findFirst({
    where: target.orderId
      ? { orderId: target.orderId, purpose: HandoverPurpose.DELIVERY }
      : { bookingId: target.bookingId, purpose: HandoverPurpose.PICKUP },
  });
  if (!row) return null;
  if (!auth.isPlatformAdmin && row.customerOrganizationId !== auth.organizationId) return null;
  return { ...viewOf(row), code: statusOf(row) === 'PENDING' ? row.code : null };
}

/**
 * The owner clearing a handover the customer could not give the code for.
 * The reason is kept on the code and in the audit log, and the customer is
 * told it happened and why.
 */
export async function overrideHandover(
  auth: AuthContext,
  tripId: string,
  input: HandoverOverrideInput,
): Promise<HandoverView> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { organizationId: true, reference: true } });
  if (!trip || (!auth.isPlatformAdmin && trip.organizationId !== auth.organizationId)) {
    throw errors.notFound('Trip');
  }
  if (!auth.isPlatformAdmin && !OVERRIDE_ROLES.has(auth.organization?.membershipRole ?? '')) {
    throw errors.forbidden('Only the owner of the business can clear a handover without the code.');
  }
  const row = await prisma.handoverCode.findUnique({
    where: { tripId_purpose: { tripId, purpose: input.purpose } },
  });
  if (!row) throw errors.notFound('Handover code');
  if (row.verifiedAt || row.overriddenAt) return viewOf(row);

  const updated = await prisma.handoverCode.update({
    where: { id: row.id },
    data: { overriddenAt: new Date(), overriddenByUserId: auth.user.id, overrideReason: input.reason },
  });
  await recordAudit({
    action: AuditAction.HANDOVER_CODE_OVERRIDDEN,
    entityType: 'Trip',
    entityId: tripId,
    actorUserId: auth.user.id,
    organizationId: trip.organizationId,
    after: { purpose: input.purpose, reason: input.reason },
  });

  const what = input.purpose === HandoverPurpose.DELIVERY ? 'delivery' : 'pickup';
  void notifyOrganization(row.customerOrganizationId, {
    type: input.purpose === HandoverPurpose.DELIVERY ? NotificationType.ORDER_DELIVERED : NotificationType.TRIP_STARTED,
    title: `Your ${what} was confirmed without your code`,
    body: `The operator gave this reason: ${input.reason}`,
    priority: NotificationPriority.HIGH,
    actionUrl: row.orderId ? `/orders/${row.orderId}` : row.bookingId ? `/travel/bookings/${row.bookingId}` : null,
  }).catch((error: unknown) => logger.warn({ err: error, tripId }, 'Could not tell the customer about a handover override'));
  return viewOf(updated);
}
