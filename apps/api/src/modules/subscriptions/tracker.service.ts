import {
  CommissionTrigger,
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  PLAN_LIMITS,
  OrganizationType,
  PlanTier,
  VEHICLE_TRACKER,
  accountRunsVehicles,
  canAddVehicleTracker,
  withGst,
  type AssignTrackerInput,
  type PurchaseTrackerInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';
import { withLock } from '../../infra/lock';
import { paymentProvider } from '../../providers/payments';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';
import { qualifyPayment } from '../sales/qualification';
import { assertPersonalIdentityVerified } from '../identity-verification/personal-onboarding.guard';
import { countActiveTrackers, invalidateEntitlements, resolveBaseLimits } from './entitlements.service';
import type { AuthContext } from '../../auth/context';

/**
 * The optional Saarthi tracker.
 *
 * What it is for, in the customer's words: the driver app knows where the phone
 * is, and a phone can be left at home, run flat, or lose signal in a tunnel —
 * so the odometer, the fuel figure and the trip start time are all inferred and
 * occasionally wrong. A tracker reads the vehicle. Everything the telemetry
 * screens show is measured rather than guessed, which is why those capabilities
 * are granted by owning one and cannot be bought on any plan.
 *
 * Charged once per vehicle. There is no billing window on the row and no expiry
 * sweep, because the money bought a device and its fitting — renting a box that
 * is already screwed to somebody's truck is how an operator ends up with a
 * tracker they have stopped paying for and a dashboard that has gone blank.
 */

const trackerLogger = logger.child({ module: 'subscriptions:trackers' });

const ACTIVE_STATUS = 'ACTIVE' as const;

export interface TrackerView {
  id: string;
  status: string;
  truckId: string | null;
  truckRegistration: string | null;
  serialNumber: string | null;
  pricePaid: number;
  purchasedAt: string;
  retiredAt: string | null;
  paymentReference: string | null;
  note: string | null;
}

function toView(row: {
  id: string;
  status: string;
  truckId: string | null;
  serialNumber: string | null;
  pricePaid: unknown;
  purchasedAt: Date;
  retiredAt: Date | null;
  paymentReference: string | null;
  note: string | null;
}, truckRegistration: string | null = null): TrackerView {
  return {
    id: row.id,
    status: row.status,
    truckId: row.truckId,
    truckRegistration,
    serialNumber: row.serialNumber,
    pricePaid: Number(row.pricePaid),
    purchasedAt: row.purchasedAt.toISOString(),
    retiredAt: row.retiredAt?.toISOString() ?? null,
    paymentReference: row.paymentReference,
    note: row.note,
  };
}

/** The vehicle registration for each tracker that is fitted to one. */
async function registrationsFor(truckIds: string[]): Promise<Map<string, string>> {
  if (truckIds.length === 0) return new Map();
  const trucks = await prisma.truck.findMany({
    where: { id: { in: truckIds } },
    select: { id: true, registrationNumber: true },
  });
  return new Map(trucks.map((truck) => [truck.id, truck.registrationNumber]));
}

export async function listTrackers(organizationId: string): Promise<TrackerView[]> {
  const rows = await prisma.vehicleTracker.findMany({
    where: { organizationId },
    orderBy: { purchasedAt: 'desc' },
    take: 500,
  });

  const registrations = await registrationsFor(
    rows.map((row) => row.truckId).filter((id): id is string => Boolean(id)),
  );

  return rows.map((row) => toView(row, row.truckId ? registrations.get(row.truckId) ?? null : null));
}

export interface TrackerCoverage {
  /** Trackers paid for and not retired. */
  activeTrackers: number;
  /** Vehicles on the fleet, which is the natural ceiling on useful trackers. */
  vehicles: number;
  /** Vehicles with a tracker fitted. */
  covered: number;
  /** Vehicles running on driver-app data alone. */
  uncovered: number;
  /** How many more may be bought. `null` = as many as there are vehicles. */
  remaining: number | null;
  canPurchase: boolean;
  /** Plan ceiling on holding trackers. `null` = unlimited. */
  ceiling: number | null;
  priceOneTime: number;
}

/**
 * How much of the fleet is actually measured rather than inferred.
 *
 * `uncovered` is the number the operator needs: it is the count of vehicles
 * whose odometer and fuel figures come from a phone, and therefore the count of
 * vehicles whose numbers may be wrong.
 */
export async function trackerCoverage(organizationId: string): Promise<TrackerCoverage> {
  const [base, vehicles, activeTrackers, fitted] = await Promise.all([
    resolveBaseLimits(organizationId),
    prisma.truck.count({ where: { organizationId, archivedAt: null } }),
    countActiveTrackers(organizationId),
    prisma.vehicleTracker.findMany({
      where: { organizationId, status: ACTIVE_STATUS, truckId: { not: null } },
      select: { truckId: true },
    }),
  ]);

  const tier = base?.tier ?? PlanTier.PERSONAL;
  const ceiling = base?.limits.maxTrackers ?? PLAN_LIMITS[tier].maxTrackers;
  const covered = new Set(fitted.map((row) => row.truckId)).size;

  return {
    activeTrackers,
    vehicles,
    covered,
    uncovered: Math.max(0, vehicles - covered),
    remaining:
      ceiling === null
        ? Math.max(0, vehicles - activeTrackers)
        : Math.max(0, Math.min(ceiling, Math.max(vehicles, 1)) - activeTrackers),
    canPurchase: canAddVehicleTracker({ tier, activeTrackers, vehicleCount: vehicles }),
    ceiling,
    priceOneTime: VEHICLE_TRACKER.priceOneTime,
  };
}

/**
 * Buy one tracker.
 *
 * Serialised per tenant with a lock for the same reason as a top-up purchase:
 * two managers clicking at once must not produce two charges for one intended
 * device, and the ceiling check has to be read-then-write to mean anything.
 */
export async function purchaseTracker(
  auth: AuthContext,
  organizationId: string,
  input: PurchaseTrackerInput,
): Promise<{ tracker: TrackerView; coverage: TrackerCoverage }> {
  const result = await withLock(`subscription:tracker:${organizationId}`, 30_000, async () => {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
    if (!subscription) {
      throw errors.businessRule('This organization has no subscription to add a tracker to.');
    }

    const tier = subscription.plan.tier as PlanTier;
    const [activeTrackers, vehicleCount] = await Promise.all([
      countActiveTrackers(organizationId),
      prisma.truck.count({ where: { organizationId, archivedAt: null } }),
    ]);

    const tenant = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { type: true },
    });

    /*
     * An account that runs no vehicles is not sold capacity for them.
     *
     * The tracker requirement follows the *account type*, not the price of the
     * plan: a supplier buys the same Business subscription a freight fleet
     * does and owns nothing to fit hardware to. Checked against the
     * organization rather than the tier for exactly that reason - the tier
     * cannot tell the two apart.
     *
     * Unreachable through the UI today, since neither a supplier nor a
     * customer holds SUBSCRIPTION_MANAGE. It is here because the next thing
     * this function does is take money.
     */
    if (!accountRunsVehicles({ tier, organizationType: tenant.type as OrganizationType })) {
      throw errors.businessRule(
        'A tracker is fitted to a vehicle. This account does not run one, so there is nothing to fit it to.',
      );
    }

    /*
     * And, on Personal, the account holder has to have confirmed who they are.
     *
     * Inside the lock and before the charge, because the next thing this
     * function does is take money for hardware. A refusal here costs the
     * customer nothing and is fixed in a minute; a refund is neither.
     */
    await assertPersonalIdentityVerified(auth, organizationId, 'tracker');

    if (vehicleCount === 0) {
      throw errors.businessRule(
        'Add a vehicle before buying a tracker — a tracker is fitted to a vehicle, and there is nothing yet to fit it to.',
      );
    }

    if (!canAddVehicleTracker({ tier, activeTrackers, vehicleCount })) {
      const ceiling = PLAN_LIMITS[tier].maxTrackers;
      throw errors.planLimitReached(
        'maxTrackers',
        ceiling !== null && activeTrackers >= ceiling
          ? `The ${subscription.plan.name} plan covers up to ${ceiling} trackers. Moving to Business removes the limit.`
          : 'You already hold a tracker for every vehicle on your fleet. Add the vehicle first, then buy its tracker.',
      );
    }

    // A named vehicle must be one of the caller's own, and must not already
    // have a tracker on it — fitting two to one vehicle would double-charge for
    // one stream of data.
    if (input.truckId) {
      const truck = await prisma.truck.findFirst({
        where: { id: input.truckId, organizationId, archivedAt: null },
        select: { id: true },
      });
      if (!truck) throw errors.notFound('Vehicle');

      const existing = await prisma.vehicleTracker.findFirst({
        where: { organizationId, truckId: input.truckId, status: ACTIVE_STATUS },
        select: { id: true },
      });
      if (existing) throw errors.conflict('This vehicle already has a tracker fitted.');
    }

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });

    const reference = `TRACKER-${organizationId.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;

    // Exclusive of GST in the catalogue, so the charge is the taxed figure.
    // `pricePaid` on the row keeps the pre-tax price — see the note in
    // `purchaseTopUp`.
    const charge = withGst(VEHICLE_TRACKER.priceOneTime);

    const payment = await paymentProvider.createIntent({
      reference,
      amount: charge.total,
      currency: 'INR',
      description: `${VEHICLE_TRACKER.name} — ${organization.name}`,
      customerName: `${auth.user.firstName} ${auth.user.lastName}`.trim(),
      customerEmail: auth.user.email,
      customerPhone: auth.user.phone,
      metadata: {
        organizationId,
        kind: 'vehicle_tracker',
        subtotal: charge.subtotal.toFixed(2),
        gst: charge.gst.toFixed(2),
        ...(input.truckId ? { truckId: input.truckId } : {}),
        ...(input.simulateFailure ? { simulateFailure: 'true' } : {}),
      },
    });

    if (payment.status === 'FAILED') {
      // The failed attempt is recorded rather than discarded: "my payment did
      // not go through" is a support conversation that needs a row to point at.
      const failed = await prisma.vehicleTracker.create({
        data: {
          organizationId,
          status: 'PAYMENT_FAILED',
          pricePaid: VEHICLE_TRACKER.priceOneTime,
          truckId: input.truckId ?? null,
          paymentReference: payment.providerReference,
          purchasedById: auth.user.id,
          note: payment.failureMessage ?? 'Payment declined.',
        },
      });

      await notifyOrganization(organizationId, {
        type: NotificationType.PAYMENT_FAILED,
        title: 'Tracker payment failed',
        body: payment.failureMessage ?? 'The payment was declined. No tracker was added.',
        priority: NotificationPriority.HIGH,
        actionUrl: '/settings/subscription',
        roles: OPERATOR_OWNER_ROLES,
      });

      throw errors.businessRule(
        payment.failureMessage ?? 'The payment was declined, so no tracker was added.',
        { trackerId: failed.id, providerReference: payment.providerReference },
      );
    }

    const row = await prisma.vehicleTracker.create({
      data: {
        organizationId,
        status: ACTIVE_STATUS,
        pricePaid: VEHICLE_TRACKER.priceOneTime,
        truckId: input.truckId ?? null,
        paymentReference: payment.providerReference,
        purchasedById: auth.user.id,
        ...(input.note ? { note: input.note } : {}),
      },
    });

    await invalidateTracking(organizationId);

    trackerLogger.info(
      { organizationId, trackerId: row.id, activeTrackers: activeTrackers + 1 },
      'Tracker purchased',
    );

    await recordAudit({
      action: AuditAction.SUBSCRIPTION_TRACKER_PURCHASED,
      entityType: 'VehicleTracker',
      entityId: row.id,
      actorUserId: auth.user.id,
      organizationId,
      after: {
        price: charge.subtotal,
        gst: charge.gst,
        charged: charge.total,
        reference: payment.providerReference,
        truckId: row.truckId,
      },
    });

    await notifyOrganization(organizationId, {
      type: NotificationType.SUBSCRIPTION_UPDATED,
      title: 'Tracker added',
      body: 'Live telemetry is unlocked. Fit the tracker and pair it from the Devices screen to start reading the vehicle itself.',
      priority: NotificationPriority.NORMAL,
      actionUrl: '/devices',
      roles: OPERATOR_OWNER_ROLES,
    });

    /*
     * Commission, if a salesperson brought this customer.
     *
     * After the charge succeeded, never before, and on the pre-tax subtotal
     * rather than the charged total — GST is not Saarthi's revenue. Cannot
     * throw, so a commission problem can never undo a purchase the customer
     * has already paid for.
     */
    await qualifyPayment({
      organizationId,
      baseAmount: charge.subtotal,
      paymentReference: payment.providerReference,
      trigger: CommissionTrigger.TRACKER,
    });

    return toView(row);
  });

  if (!result) {
    // Another purchase for this tenant is mid-flight. Failing here is the safe
    // outcome: a duplicate charge is worse than a retry.
    throw errors.conflict(
      'Another tracker purchase is already in progress for this organization. Try again in a moment.',
    );
  }

  const coverage = await trackerCoverage(organizationId);
  return { tracker: result, coverage };
}

/**
 * Move a tracker to a different vehicle, or take it off the fleet.
 *
 * Hardware outlives the vehicle it was first fitted to: a truck is sold, a unit
 * is swapped into the replacement. The purchase follows the device, not the
 * vehicle, so re-fitting costs nothing.
 */
export async function assignTracker(
  auth: AuthContext,
  organizationId: string,
  trackerId: string,
  input: AssignTrackerInput,
): Promise<TrackerView> {
  const row = await prisma.vehicleTracker.findUnique({ where: { id: trackerId } });
  if (!row || row.organizationId !== organizationId) throw errors.notFound('Tracker');
  if (row.status !== ACTIVE_STATUS) {
    throw errors.conflict('This tracker is not active.');
  }

  /*
   * Fitting a tracker to a vehicle is the moment it starts reading one, so a
   * Personal account holder has to be verified by here.
   *
   * Gated as well as the purchase, and not instead of it, because the two are
   * separate events: a tracker bought with the subscription at signup arrives
   * unassigned, and this is where it would otherwise come alive. Taking it
   * *off* a vehicle is deliberately not gated — nobody should have to verify
   * anything to stop sending data.
   */
  if (input.truckId) {
    await assertPersonalIdentityVerified(auth, organizationId, 'tracker');
  }

  if (input.truckId) {
    const truck = await prisma.truck.findFirst({
      where: { id: input.truckId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!truck) throw errors.notFound('Vehicle');

    const occupied = await prisma.vehicleTracker.findFirst({
      where: {
        organizationId,
        truckId: input.truckId,
        status: ACTIVE_STATUS,
        id: { not: trackerId },
      },
      select: { id: true },
    });
    if (occupied) throw errors.conflict('This vehicle already has a tracker fitted.');
  }

  const updated = await prisma.vehicleTracker.update({
    where: { id: trackerId },
    data: { truckId: input.truckId },
  });

  await invalidateTracking(organizationId);

  await recordAudit({
    action: AuditAction.SUBSCRIPTION_TRACKER_ASSIGNED,
    entityType: 'VehicleTracker',
    entityId: trackerId,
    actorUserId: auth.user.id,
    organizationId,
    before: { truckId: row.truckId },
    after: { truckId: input.truckId },
  });

  const registrations = await registrationsFor(updated.truckId ? [updated.truckId] : []);
  return toView(updated, updated.truckId ? registrations.get(updated.truckId) ?? null : null);
}

/**
 * Retire a tracker.
 *
 * The row stays — it is a purchase record — but stops granting its entitlement.
 * There is no refund path here on purpose: taking a device out of service is an
 * operational decision the operator makes for themselves, while a refund is a
 * money decision that belongs with support.
 */
export async function retireTracker(
  auth: AuthContext,
  organizationId: string,
  trackerId: string,
): Promise<TrackerView> {
  const row = await prisma.vehicleTracker.findUnique({ where: { id: trackerId } });
  if (!row || row.organizationId !== organizationId) throw errors.notFound('Tracker');
  if (row.status !== ACTIVE_STATUS) throw errors.conflict('This tracker is not active.');

  const updated = await prisma.vehicleTracker.update({
    where: { id: trackerId },
    data: { status: 'RETIRED', retiredAt: new Date(), truckId: null },
  });

  await invalidateTracking(organizationId);

  await recordAudit({
    action: AuditAction.SUBSCRIPTION_TRACKER_RETIRED,
    entityType: 'VehicleTracker',
    entityId: trackerId,
    actorUserId: auth.user.id,
    organizationId,
    before: { truckId: row.truckId, status: row.status },
  });

  trackerLogger.info({ organizationId, trackerId }, 'Tracker retired');

  return toView(updated);
}

/** Entitlements are cached in two places; a tracker change must clear both. */
async function invalidateTracking(organizationId: string): Promise<void> {
  invalidateEntitlements(organizationId);
  await cache.delete(cacheKeys.subscriptionEntitlement(organizationId));
}
