import {
  NotificationPriority,
  NotificationType,
  SalesLeadEventType,
  TrackerHandoverStatus,
  canTransitionHandover,
  type AssignTrackerToSalesmanInput,
  type HandOverTrackerInput,
  type HandoverListQuery,
  type HandoverStatusInput,
} from '@saarthi/shared';
import { isUniqueViolation, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyAsync } from '../notifications/notification.service';
import { syncFromCustomerState } from './lead.service';
import type { SalesmanView } from './salesman.service';
import type { AuthContext } from '../../auth/context';

/**
 * Tracker custody between Saarthi and a vehicle.
 *
 * **This is not a device registry, and it must never become one.** Saarthi has
 * exactly two tables for a tracker and both already existed: `vehicle_trackers`
 * is the entitlement the customer's payment created, and `hardware_devices` is
 * the physical unit the device module owns. `tracker_handovers` records only
 * who is carrying it and when it changed hands — the one question neither of
 * those can answer.
 *
 * Consequences worth stating, because they are what keeps the promise:
 *
 *   * every row points at an existing `VehicleTracker`; there is no endpoint
 *     here that creates hardware or an entitlement;
 *   * a serial number recorded at handover is written *onto that tracker row*,
 *     so it appears on the customer's own subscription screen rather than only
 *     in a sales table;
 *   * `INSTALLED` is never typed in. It is derived from the same device
 *     assignment and telemetry the onboarding checklist reads, so the person
 *     whose pipeline benefits cannot assert it.
 *
 * There is no tracker QR code anywhere in this file. Saarthi trackers do not
 * carry one; the *vehicle* does, and scanning it is the existing Driver App
 * flow, untouched.
 */

const handoverLogger = logger.child({ module: 'sales:handover' });

export interface HandoverView {
  id: string;
  trackerId: string;
  salesmanId: string;
  salesmanName: string | null;
  leadId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  status: TrackerHandoverStatus;
  serialNumber: string | null;
  assignedAt: string;
  handedOverAt: string | null;
  acknowledgedBy: string | null;
  installedAt: string | null;
  vehicleId: string | null;
  vehicleRegistration: string | null;
  returnedAt: string | null;
  closeReason: string | null;
  note: string | null;
}

type HandoverRow = {
  id: string;
  trackerId: string;
  salesmanId: string;
  leadId: string | null;
  organizationId: string | null;
  status: string;
  serialNumber: string | null;
  assignedAt: Date;
  handedOverAt: Date | null;
  acknowledgedBy: string | null;
  installedAt: Date | null;
  vehicleId: string | null;
  returnedAt: Date | null;
  closeReason: string | null;
  note: string | null;
  salesman?: { name: string | null } | null;
  organization?: { name: string } | null;
};

function toView(row: HandoverRow, vehicleRegistration: string | null = null): HandoverView {
  return {
    id: row.id,
    trackerId: row.trackerId,
    salesmanId: row.salesmanId,
    salesmanName: row.salesman?.name ?? null,
    leadId: row.leadId,
    organizationId: row.organizationId,
    organizationName: row.organization?.name ?? null,
    status: row.status as TrackerHandoverStatus,
    serialNumber: row.serialNumber,
    assignedAt: row.assignedAt.toISOString(),
    handedOverAt: row.handedOverAt?.toISOString() ?? null,
    acknowledgedBy: row.acknowledgedBy,
    installedAt: row.installedAt?.toISOString() ?? null,
    vehicleId: row.vehicleId,
    vehicleRegistration,
    returnedAt: row.returnedAt?.toISOString() ?? null,
    closeReason: row.closeReason,
    note: row.note,
  };
}

const withRelations = {
  salesman: { select: { name: true } },
  organization: { select: { name: true } },
} as const;

/** Registration numbers for the vehicles a page of handovers points at. */
async function registrationsFor(vehicleIds: string[]): Promise<Map<string, string>> {
  const ids = vehicleIds.filter(Boolean);
  if (ids.length === 0) return new Map();
  const vehicles = await prisma.truck.findMany({
    where: { id: { in: ids } },
    select: { id: true, registrationNumber: true },
  });
  return new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.registrationNumber]));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listHandovers(
  query: HandoverListQuery,
  salesmanId: string | null,
): Promise<{ items: HandoverView[]; total: number }> {
  const where = {
    ...(salesmanId ? { salesmanId } : query.salesmanId ? { salesmanId: query.salesmanId } : {}),
    ...(query.status ? { status: { in: query.status as never } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.trackerHandover.findMany({
      where,
      include: withRelations,
      orderBy: { assignedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.trackerHandover.count({ where }),
  ]);

  const registrations = await registrationsFor(
    rows.map((row) => row.vehicleId).filter((id): id is string => id !== null),
  );

  return {
    items: rows.map((row) =>
      toView(row, row.vehicleId ? registrations.get(row.vehicleId) ?? null : null),
    ),
    total,
  };
}

export interface HandoverSummary {
  available: number;
  handedOver: number;
  installed: number;
  returned: number;
  lost: number;
}

/** The counts on the salesperson's "My trackers" card. All real rows. */
export async function handoverSummary(salesmanId: string): Promise<HandoverSummary> {
  const grouped = await prisma.trackerHandover.groupBy({
    by: ['status'],
    where: { salesmanId },
    _count: { _all: true },
  });

  const countFor = (status: TrackerHandoverStatus): number =>
    grouped.find((group) => group.status === status)?._count._all ?? 0;

  return {
    available: countFor(TrackerHandoverStatus.ASSIGNED_TO_SALESMAN),
    handedOver: countFor(TrackerHandoverStatus.HANDED_TO_CUSTOMER),
    installed: countFor(TrackerHandoverStatus.INSTALLED),
    returned: countFor(TrackerHandoverStatus.RETURNED),
    lost: countFor(TrackerHandoverStatus.LOST),
  };
}

export async function getHandover(
  id: string,
  salesmanId: string | null,
): Promise<HandoverView> {
  const row = await prisma.trackerHandover.findUnique({ where: { id }, include: withRelations });
  if (!row) throw errors.notFound('Tracker handover');
  if (salesmanId && row.salesmanId !== salesmanId) throw errors.notFound('Tracker handover');

  const registration = row.vehicleId
    ? (await registrationsFor([row.vehicleId])).get(row.vehicleId) ?? null
    : null;

  return toView(row, registration);
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

/**
 * Allocate a paid-for tracker to a salesperson to carry.
 *
 * Platform operations, not field sales — a salesperson taking stock out of the
 * warehouse on their own authority is how inventory goes missing, so this needs
 * `tracker_inventory.manage`, which the SALESMAN role does not hold.
 *
 * The tracker must exist and be `ACTIVE`, meaning somebody paid for it. That
 * refusal is worth being strict about: allocating a `PAYMENT_FAILED` tracker
 * would put a salesperson on a customer's doorstep with hardware the customer
 * has not bought.
 */
export async function assignToSalesman(
  auth: AuthContext,
  input: AssignTrackerToSalesmanInput,
): Promise<HandoverView> {
  const [tracker, salesman] = await Promise.all([
    prisma.vehicleTracker.findUnique({
      where: { id: input.trackerId },
      select: {
        id: true,
        status: true,
        organizationId: true,
        truckId: true,
        serialNumber: true,
      },
    }),
    prisma.salesmanProfile.findUnique({
      where: { id: input.salesmanId },
      select: { id: true, status: true, userId: true, name: true },
    }),
  ]);

  if (!tracker) throw errors.notFound('Tracker');
  if (!salesman) throw errors.notFound('Salesman profile');

  if (tracker.status !== 'ACTIVE') {
    throw errors.businessRule(
      `This tracker is ${tracker.status.toLowerCase()}, so it cannot be given to a salesperson to ` +
        'deliver. Only a tracker that has been paid for can be handed over.',
    );
  }

  if (tracker.truckId) {
    throw errors.businessRule(
      'This tracker is already fitted to a vehicle, so there is nothing to hand over.',
    );
  }

  if (salesman.status !== 'ACTIVE') {
    throw errors.businessRule(
      'This salesman profile is not active, so stock cannot be allocated to it.',
    );
  }

  let row;
  try {
    row = await prisma.trackerHandover.create({
      data: {
        trackerId: tracker.id,
        salesmanId: salesman.id,
        organizationId: tracker.organizationId,
        status: TrackerHandoverStatus.ASSIGNED_TO_SALESMAN,
        serialNumber: input.serialNumber ?? tracker.serialNumber,
        assignedByUserId: auth.user.id,
        note: input.note ?? null,
      },
      include: withRelations,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.conflict(
        'This tracker already has a handover record. Open it rather than creating a second one.',
      );
    }
    throw error;
  }

  // Write the serial back onto the tracker itself, so the customer sees it on
  // their own subscription screen rather than it living only in a sales table.
  if (input.serialNumber && input.serialNumber !== tracker.serialNumber) {
    await prisma.vehicleTracker.update({
      where: { id: tracker.id },
      data: { serialNumber: input.serialNumber },
    });
  }

  await recordAudit({
    action: AuditAction.TRACKER_ASSIGNED_TO_SALESMAN,
    entityType: 'TrackerHandover',
    entityId: row.id,
    actorUserId: auth.user.id,
    organizationId: tracker.organizationId,
    after: {
      trackerId: tracker.id,
      salesmanId: salesman.id,
      serialNumber: row.serialNumber,
    },
  });

  if (salesman.userId) {
    notifyAsync({
      userId: salesman.userId,
      type: NotificationType.SALES_TRACKER_ASSIGNED,
      title: 'A tracker was allocated to you',
      body: row.serialNumber
        ? `Tracker ${row.serialNumber} is allocated to you for delivery.`
        : 'A Saarthi tracker is allocated to you for delivery.',
      priority: NotificationPriority.NORMAL,
      actionUrl: '/sales/trackers',
    });
  }

  return toView(row);
}

// ---------------------------------------------------------------------------
// Handover
// ---------------------------------------------------------------------------

/**
 * Record a tracker physically changing hands.
 *
 * The one write in this module a salesperson performs on their own authority,
 * and it is deliberately a *statement about the past* rather than a state
 * change with consequences: it grants nothing, activates nothing, and starts
 * no billing. What it does is put a name — `acknowledgedBy` — against the
 * moment the unit left the salesperson's bag, which is the fact that gets
 * disputed three months later when a tracker cannot be found.
 *
 * It does not fit the tracker to a vehicle either, even when the customer has
 * already said which one. Fitting is the customer's own action on their own
 * subscription screen, and `vehicleId` here is a note of intent that the
 * onboarding check later confirms or contradicts.
 */
export async function handToCustomer(
  auth: AuthContext,
  id: string,
  salesman: SalesmanView,
  input: HandOverTrackerInput,
): Promise<HandoverView> {
  const existing = await prisma.trackerHandover.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('Tracker handover');
  if (existing.salesmanId !== salesman.id) throw errors.notFound('Tracker handover');

  const from = existing.status as TrackerHandoverStatus;
  if (!canTransitionHandover(from, TrackerHandoverStatus.HANDED_TO_CUSTOMER)) {
    throw errors.invalidTransition(
      from === TrackerHandoverStatus.HANDED_TO_CUSTOMER
        ? 'This tracker has already been handed over.'
        : `A tracker that is ${from.toLowerCase().replace(/_/g, ' ')} cannot be handed over.`,
      { from, to: TrackerHandoverStatus.HANDED_TO_CUSTOMER },
    );
  }

  if (input.vehicleId) {
    const vehicle = await prisma.truck.findUnique({
      where: { id: input.vehicleId },
      select: { id: true, organizationId: true },
    });
    if (!vehicle) throw errors.notFound('Vehicle');
    if (existing.organizationId && vehicle.organizationId !== existing.organizationId) {
      throw errors.businessRule('That vehicle belongs to a different customer.');
    }
  }

  const now = new Date();
  const row = await prisma.trackerHandover.update({
    where: { id },
    data: {
      status: TrackerHandoverStatus.HANDED_TO_CUSTOMER,
      handedOverAt: now,
      acknowledgedBy: input.acknowledgedBy,
      ...(input.serialNumber ? { serialNumber: input.serialNumber } : {}),
      ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
      ...(input.note ? { note: input.note } : {}),
    },
    include: withRelations,
  });

  if (input.serialNumber) {
    await prisma.vehicleTracker.update({
      where: { id: existing.trackerId },
      data: { serialNumber: input.serialNumber },
    });
  }

  if (existing.leadId) {
    await prisma.salesLeadEvent.create({
      data: {
        leadId: existing.leadId,
        type: SalesLeadEventType.TRACKER_HANDED_OVER,
        note: `Tracker handed to ${input.acknowledgedBy}.`,
        actorUserId: auth.user.id,
      },
    });
    await syncFromCustomerState(existing.leadId);
  }

  await recordAudit({
    action: AuditAction.TRACKER_HANDED_TO_CUSTOMER,
    entityType: 'TrackerHandover',
    entityId: id,
    actorUserId: auth.user.id,
    organizationId: existing.organizationId,
    before: { status: from },
    after: {
      status: TrackerHandoverStatus.HANDED_TO_CUSTOMER,
      acknowledgedBy: input.acknowledgedBy,
      serialNumber: row.serialNumber,
      godId: salesman.godId,
    },
  });

  return toView(row);
}

/**
 * Mark a handed-over tracker installed, from real device state.
 *
 * Takes no evidence from its caller — only the handover id. The proof is read
 * here: the tracker has to be fitted to a vehicle on `vehicle_trackers`, and
 * that vehicle has to have an active device assignment. Both are rows the
 * device and subscription modules own, so a salesperson cannot produce either
 * by asking.
 *
 * Idempotent, and it returns quietly rather than throwing when the evidence is
 * not there yet: this is called opportunistically after onboarding checks, and
 * an exception would turn "the customer has not fitted it yet" into an error on
 * an unrelated screen.
 */
export async function markInstalledIfFitted(id: string): Promise<boolean> {
  const handover = await prisma.trackerHandover.findUnique({
    where: { id },
    select: { id: true, status: true, trackerId: true, organizationId: true, leadId: true },
  });
  if (!handover) return false;
  if (handover.status === TrackerHandoverStatus.INSTALLED) return true;
  if (!canTransitionHandover(handover.status as TrackerHandoverStatus, TrackerHandoverStatus.INSTALLED)) {
    return false;
  }

  const tracker = await prisma.vehicleTracker.findUnique({
    where: { id: handover.trackerId },
    select: { truckId: true },
  });
  if (!tracker?.truckId) return false;

  const assignment = await prisma.deviceAssignment.findFirst({
    where: { vehicleId: tracker.truckId, status: 'ACTIVE' },
    select: { id: true, assignedAt: true },
  });
  if (!assignment) return false;

  await prisma.trackerHandover.update({
    where: { id },
    data: {
      status: TrackerHandoverStatus.INSTALLED,
      installedAt: assignment.assignedAt,
      vehicleId: tracker.truckId,
    },
  });

  handoverLogger.info(
    { handoverId: id, vehicleId: tracker.truckId },
    'Tracker handover marked installed from device state',
  );

  if (handover.leadId) await syncFromCustomerState(handover.leadId);
  return true;
}

/**
 * Close a handover as returned or lost.
 *
 * A returned unit goes back to `ASSIGNED_TO_SALESMAN` availability by way of a
 * new allocation, not by rewriting this row: the trip it made and the person
 * who signed for it are part of the history even when it came back.
 */
export async function closeHandover(
  auth: AuthContext,
  id: string,
  salesmanId: string | null,
  input: HandoverStatusInput,
): Promise<HandoverView> {
  const existing = await prisma.trackerHandover.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('Tracker handover');
  if (salesmanId && existing.salesmanId !== salesmanId) throw errors.notFound('Tracker handover');

  const from = existing.status as TrackerHandoverStatus;
  if (!canTransitionHandover(from, input.status)) {
    throw errors.invalidTransition(
      `A tracker that is ${from.toLowerCase().replace(/_/g, ' ')} cannot be marked ` +
        `${input.status.toLowerCase()}.`,
      { from, to: input.status },
    );
  }

  const row = await prisma.trackerHandover.update({
    where: { id },
    data: {
      status: input.status,
      closeReason: input.reason,
      ...(input.status === TrackerHandoverStatus.RETURNED ? { returnedAt: new Date() } : {}),
    },
    include: withRelations,
  });

  await recordAudit({
    action: AuditAction.TRACKER_HANDOVER_CLOSED,
    entityType: 'TrackerHandover',
    entityId: id,
    actorUserId: auth.user.id,
    organizationId: existing.organizationId,
    before: { status: from },
    after: { status: input.status, reason: input.reason },
  });

  return toView(row);
}

/**
 * The trackers a salesperson is carrying for one customer.
 *
 * Used by the tracker-handover screen to show what is available to hand over
 * on this visit. Scoped to the salesperson, so it cannot be used to inspect a
 * colleague's stock.
 */
export async function availableForCustomer(
  salesmanId: string,
  organizationId: string,
): Promise<HandoverView[]> {
  const rows = await prisma.trackerHandover.findMany({
    where: {
      salesmanId,
      organizationId,
      status: TrackerHandoverStatus.ASSIGNED_TO_SALESMAN,
    },
    include: withRelations,
    orderBy: { assignedAt: 'asc' },
  });
  return rows.map((row) => toView(row));
}
