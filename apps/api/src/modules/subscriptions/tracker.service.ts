import {
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  PLAN_LIMITS,
  PaymentPurpose,
  OrganizationType,
  PlanTier,
  TRACKER_PRODUCTS,
  accountRunsVehicles,
  canAddVehicleTracker,
  trackerProduct,
  inclusiveOfGst,
  trackerCharge,
  type TrackerProduct,
  type TrackerProductDefinition,
  type AssignTrackerInput,
  type PurchaseTrackerInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';
import { withLock } from '../../infra/lock';
import {
  completeSettledPayment,
  openPayment,
  type CheckoutSession,
} from '../payments/payment-settlement.service';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';
import { assertPersonalIdentityVerified } from '../identity-verification/personal-onboarding.guard';
import { countActiveTrackers, invalidateEntitlements, resolveBaseLimits } from './entitlements.service';
import type { AuthContext } from '../../auth/context';

/**
 * Saarthi tracker hardware — the Bluetooth OBD unit or the 4G tracker.
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
  product: TrackerProduct;
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
  product: TrackerProduct;
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
    product: row.product,
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

/** The Saarthi tracker bought for and fitted to this vehicle, if there is one. */
export async function trackerProductFor(vehicleId: string): Promise<TrackerProduct | null> {
  const row = await prisma.vehicleTracker.findFirst({
    where: { truckId: vehicleId, status: ACTIVE_STATUS },
    select: { product: true },
  });
  return row?.product ?? null;
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
  /** What is on sale, with base prices before GST. */
  products: readonly TrackerProductDefinition[];
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
    products: TRACKER_PRODUCTS,
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
): Promise<{ tracker: TrackerView; coverage: TrackerCoverage; checkout: CheckoutSession | null }> {
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
     * This follows the *account type*, not the price of the plan: a Business
     * account that is not a vehicle operator owns nothing to fit hardware to,
     * and the tier alone cannot tell it apart from a fleet.
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

    // Every tracker ordered must fit a vehicle and the plan — all of them, not
    // just the first: one tracker per vehicle, and the plan's own ceiling.
    const quantity = input.quantity;
    const ceiling = PLAN_LIMITS[tier].maxTrackers;
    const allowed = Math.min(ceiling ?? Number.POSITIVE_INFINITY, Math.max(vehicleCount, 1));
    if (!canAddVehicleTracker({ tier, activeTrackers, vehicleCount }) || activeTrackers + quantity > allowed) {
      const left = Math.max(0, allowed - activeTrackers);
      throw errors.planLimitReached(
        'maxTrackers',
        ceiling !== null && activeTrackers + quantity > ceiling
          ? `The ${subscription.plan.name} plan covers up to ${ceiling} trackers${left > 0 ? ` - you can add ${left} more` : ''}.`
          : left > 0
            ? `You can add ${left} more tracker${left === 1 ? '' : 's'} - one for each vehicle without one.`
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

    // The customer pays the final price — base plus GST, rounded up to end in
    // 9. `pricePaid` on the row keeps the base price, which is what an invoice
    // itemises and what `trackerCharge` derives the final price from.
    const product = trackerProduct(input.product);
    const unit = trackerCharge(product.priceOneTime);
    const charge = inclusiveOfGst(unit.total * quantity);

    const { paymentId, intent } = await openPayment({
      reference,
      purpose: PaymentPurpose.SUBSCRIPTION,
      organizationId,
      userId: auth.user.id,
      amount: charge.total,
      description: `${quantity > 1 ? `${quantity} × ` : ''}${product.name} — ${organization.name}`,
      customer: {
        name: `${auth.user.firstName} ${auth.user.lastName}`.trim(),
        email: auth.user.email,
        phone: auth.user.phone,
      },
      returnPath: input.truckId ? `/fleet/vehicles/${input.truckId}/telemetry` : '/settings/subscription',
      metadata: {
        kind: 'vehicle_tracker',
        product: product.product,
        quantity: String(quantity),
        subtotal: charge.subtotal.toFixed(2),
        gst: charge.gst.toFixed(2),
        ...(input.truckId ? { truckId: input.truckId } : {}),
        ...(input.simulateFailure ? { simulateFailure: 'true' } : {}),
      },
    });

    if (intent.status === 'FAILED') {
      // The failed attempt is recorded rather than discarded: "my payment did
      // not go through" is a support conversation that needs a row to point at.
      const failed = await prisma.vehicleTracker.create({
        data: {
          organizationId,
          status: 'PAYMENT_FAILED',
          product: product.product,
          pricePaid: product.priceOneTime,
          truckId: input.truckId ?? null,
          paymentReference: intent.providerReference,
          purchasedById: auth.user.id,
          note: intent.failureMessage ?? 'Payment declined.',
        },
      });

      await notifyOrganization(organizationId, {
        type: NotificationType.PAYMENT_FAILED,
        title: 'Tracker payment failed',
        body: intent.failureMessage ?? 'The payment was declined. No tracker was added.',
        priority: NotificationPriority.HIGH,
        actionUrl: '/settings/subscription',
        roles: OPERATOR_OWNER_ROLES,
      });

      throw errors.businessRule(
        intent.failureMessage ?? 'The payment was declined, so no tracker was added.',
        { trackerId: failed.id, providerReference: intent.providerReference },
      );
    }

    // Pending until the payment settles; `activatePaidAddOns` puts it live and
    // handles the audit, notification and commission.
    const rows = await prisma.vehicleTracker.createManyAndReturn({
      data: Array.from({ length: quantity }, () => ({
        organizationId,
        status: 'PENDING_PAYMENT' as const,
        product: product.product,
        pricePaid: product.priceOneTime,
        truckId: input.truckId ?? null,
        paymentReference: intent.providerReference,
        purchasedById: auth.user.id,
        ...(input.note ? { note: input.note } : {}),
      })),
      select: { id: true },
    });
    const row = rows[0]!;

    if (intent.status === 'SUCCEEDED') await completeSettledPayment(paymentId);

    trackerLogger.info(
      { organizationId, trackerId: row.id, quantity, status: intent.status },
      'Tracker ordered',
    );

    const fresh = await prisma.vehicleTracker.findUniqueOrThrow({ where: { id: row.id } });
    return { view: toView(fresh), checkout: intent.checkout };
  });

  if (!result) {
    // Another purchase for this tenant is mid-flight. Failing here is the safe
    // outcome: a duplicate charge is worse than a retry.
    throw errors.conflict(
      'Another tracker purchase is already in progress for this organization. Try again in a moment.',
    );
  }

  const coverage = await trackerCoverage(organizationId);
  return { tracker: result.view, coverage, checkout: result.checkout };
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
    await assertPersonalIdentityVerified(auth, organizationId, 'tracker', trackerId);
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
