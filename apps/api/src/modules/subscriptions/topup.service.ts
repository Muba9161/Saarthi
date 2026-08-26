import {
  NotificationPriority,
  NotificationType,
  PLAN_LIMITS,
  PlanTier,
  VEHICLE_TOPUP,
  canAddVehicleTopUp,
  describeVehicleCapacity,
  type PurchaseTopUpInput,
  type VehicleCapacity,
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
import { invalidateEntitlements, resolveBaseLimits } from './entitlements.service';
import type { AuthContext } from '../../auth/context';

/**
 * `+1 vehicle` subscription top-ups.
 *
 * The problem this solves is concrete: an operator on a five-vehicle plan buys
 * a sixth truck. Making them jump to the twenty-vehicle price to put one
 * vehicle on the road is how a fleet ends up keeping that truck off Saarthi
 * entirely — and a truck that is not on the platform is not being tracked,
 * serviced or reminded about its EMI.
 *
 * Each top-up is its own row with its own payment and billing window, so three
 * bought at different times can be cancelled independently.
 */

const topUpLogger = logger.child({ module: 'subscriptions:topups' });

const ACTIVE_STATUS = 'ACTIVE' as const;

export interface TopUpView {
  id: string;
  status: string;
  startsAt: string;
  expiresAt: string | null;
  cancelledAt: string | null;
  priceMonthly: number;
  paymentReference: string | null;
  note: string | null;
  createdAt: string;
}

function toView(row: {
  id: string;
  status: string;
  startsAt: Date;
  expiresAt: Date | null;
  cancelledAt: Date | null;
  priceMonthly: unknown;
  paymentReference: string | null;
  note: string | null;
  createdAt: Date;
}): TopUpView {
  return {
    id: row.id,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    priceMonthly: Number(row.priceMonthly),
    paymentReference: row.paymentReference,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Top-ups that are currently granting capacity.
 *
 * An expired row keeps existing — the billing history matters — but stops
 * counting the moment its window closes, without waiting for a sweep.
 */
export async function countActiveTopUps(organizationId: string): Promise<number> {
  return prisma.vehicleSubscriptionTopUp.count({
    where: {
      organizationId,
      status: ACTIVE_STATUS,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
}

export async function listTopUps(organizationId: string): Promise<TopUpView[]> {
  const rows = await prisma.vehicleSubscriptionTopUp.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map(toView);
}

/**
 * Vehicles in use, the plan's capacity, and what is left.
 *
 * The base limit is read from the plan rather than recovered from the caller's
 * resolved entitlement. That resolved figure already has top-ups folded into
 * it, and subtracting them back out would be correct only until the moment a
 * purchase lands — exactly when this is asked.
 */
export async function vehicleCapacity(
  organizationId: string,
): Promise<VehicleCapacity & { planName: string; topUpPriceMonthly: number }> {
  const [base, used, activeTopUps] = await Promise.all([
    resolveBaseLimits(organizationId),
    prisma.truck.count({ where: { organizationId, archivedAt: null } }),
    countActiveTopUps(organizationId),
  ]);

  const tier = base?.tier ?? PlanTier.BASIC;

  return {
    ...describeVehicleCapacity({
      tier,
      baseLimit: base?.limits.maxTrucks ?? PLAN_LIMITS[tier].maxTrucks,
      activeTopUps,
      used,
    }),
    planName: base?.planName ?? 'No plan',
    topUpPriceMonthly: VEHICLE_TOPUP.priceMonthly,
  };
}

/**
 * Buy one `+1 vehicle` top-up.
 *
 * Serialised per tenant with a lock: two managers clicking at once must not
 * produce two charges and two rows for one intended vehicle, and the ceiling
 * check has to be read-then-write to mean anything.
 */
export async function purchaseTopUp(
  auth: AuthContext,
  organizationId: string,
  input: PurchaseTopUpInput,
): Promise<{ topUp: TopUpView; capacity: VehicleCapacity }> {
  const result = await withLock(`subscription:topup:${organizationId}`, 30_000, async () => {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
    if (!subscription) {
      throw errors.businessRule(
        'This organization has no active subscription to add a top-up to.',
      );
    }

    const tier = subscription.plan.tier as PlanTier;
    const activeTopUps = await countActiveTopUps(organizationId);

    if (!canAddVehicleTopUp(tier, activeTopUps)) {
      throw errors.planLimitReached(
        'vehicleTopUpLimit',
        `You already hold the maximum number of vehicle top-ups for the ${subscription.plan.name} plan. ` +
          'Upgrading is the cheaper move from here.',
      );
    }

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });

    const reference = `TOPUP-${organizationId.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;

    const payment = await paymentProvider.createIntent({
      reference,
      amount: VEHICLE_TOPUP.priceMonthly,
      currency: 'INR',
      description: `${VEHICLE_TOPUP.name} — ${organization.name}`,
      customerName: `${auth.user.firstName} ${auth.user.lastName}`.trim(),
      customerEmail: auth.user.email,
      customerPhone: auth.user.phone,
      metadata: {
        organizationId,
        kind: 'vehicle_topup',
        ...(input.simulateFailure ? { simulateFailure: 'true' } : {}),
      },
    });

    if (payment.status === 'FAILED') {
      // The failed attempt is recorded rather than discarded: "my payment did
      // not go through" is a support conversation that needs a row to point at.
      const failed = await prisma.vehicleSubscriptionTopUp.create({
        data: {
          organizationId,
          status: 'PAYMENT_FAILED',
          priceMonthly: VEHICLE_TOPUP.priceMonthly,
          paymentReference: payment.providerReference,
          purchasedById: auth.user.id,
          note: payment.failureMessage ?? 'Payment declined.',
        },
      });

      await notifyOrganization(organizationId, {
        type: NotificationType.PAYMENT_FAILED,
        title: 'Vehicle top-up payment failed',
        body: payment.failureMessage ?? 'The payment was declined. No capacity was added.',
        priority: NotificationPriority.HIGH,
        actionUrl: '/settings/subscription',
        roles: ['FLEET_OWNER'],
      });

      throw errors.businessRule(
        payment.failureMessage ?? 'The payment was declined, so no capacity was added.',
        { topUpId: failed.id, providerReference: payment.providerReference },
      );
    }

    const row = await prisma.vehicleSubscriptionTopUp.create({
      data: {
        organizationId,
        status: ACTIVE_STATUS,
        priceMonthly: VEHICLE_TOPUP.priceMonthly,
        paymentReference: payment.providerReference,
        purchasedById: auth.user.id,
        ...(input.note ? { note: input.note } : {}),
        // Monthly window; the renewal sweep extends it while it stays active.
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    await invalidateCapacity(organizationId);

    topUpLogger.info(
      { organizationId, topUpId: row.id, activeTopUps: activeTopUps + 1 },
      'Vehicle top-up purchased',
    );

    await recordAudit({
      action: AuditAction.SUBSCRIPTION_TOPUP_PURCHASED,
      entityType: 'VehicleSubscriptionTopUp',
      entityId: row.id,
      actorUserId: auth.user.id,
      organizationId,
      after: { price: VEHICLE_TOPUP.priceMonthly, reference: payment.providerReference },
    });

    await notifyOrganization(organizationId, {
      type: NotificationType.SUBSCRIPTION_UPDATED,
      title: 'Vehicle capacity increased',
      body: `A +1 vehicle top-up is active. You can now add one more vehicle.`,
      priority: NotificationPriority.NORMAL,
      actionUrl: '/settings/subscription',
      roles: ['FLEET_OWNER'],
    });

    return toView(row);
  });

  if (!result) {
    // Another purchase for this tenant is mid-flight. Failing here is the safe
    // outcome: a duplicate charge is worse than a retry.
    throw errors.conflict(
      'Another top-up purchase is already in progress for this organization. Try again in a moment.',
    );
  }

  // Recomputed from storage so the response cannot disagree with what the next
  // request will resolve.
  const capacity = await vehicleCapacity(organizationId);
  return { topUp: result, capacity };
}

export async function cancelTopUp(
  auth: AuthContext,
  organizationId: string,
  topUpId: string,
): Promise<TopUpView> {
  const row = await prisma.vehicleSubscriptionTopUp.findUnique({ where: { id: topUpId } });
  if (!row || row.organizationId !== organizationId) throw errors.notFound('Top-up');
  if (row.status !== ACTIVE_STATUS) {
    throw errors.conflict('This top-up is not active.');
  }

  const updated = await prisma.vehicleSubscriptionTopUp.update({
    where: { id: topUpId },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });

  await invalidateCapacity(organizationId);

  await recordAudit({
    action: AuditAction.SUBSCRIPTION_TOPUP_CANCELLED,
    entityType: 'VehicleSubscriptionTopUp',
    entityId: topUpId,
    actorUserId: auth.user.id,
    organizationId,
  });

  // Vehicles above the new capacity keep working — see `describeVehicleCapacity`.
  // Cancelling removes the right to add another, never the vehicles already on
  // the road.
  topUpLogger.info({ organizationId, topUpId }, 'Vehicle top-up cancelled');

  return toView(updated);
}

/** Entitlements are cached in two places; a capacity change must clear both. */
async function invalidateCapacity(organizationId: string): Promise<void> {
  invalidateEntitlements(organizationId);
  await cache.delete(cacheKeys.subscriptionEntitlement(organizationId));
}

/**
 * Expire top-ups whose billing window has closed.
 *
 * Runs under a lock so two workers cannot both expire the same rows and send
 * two notifications for one lapse.
 */
export async function runTopUpExpirySweep(): Promise<number> {
  const result = await withLock('jobs:subscription:topup-expiry', 5 * 60_000, async () => {
    const lapsed = await prisma.vehicleSubscriptionTopUp.findMany({
      where: { status: ACTIVE_STATUS, expiresAt: { lt: new Date() } },
      select: { id: true, organizationId: true },
      take: 1000,
    });

    if (lapsed.length === 0) return 0;

    await prisma.vehicleSubscriptionTopUp.updateMany({
      where: { id: { in: lapsed.map((row) => row.id) } },
      data: { status: 'EXPIRED' },
    });

    for (const organizationId of new Set(lapsed.map((row) => row.organizationId))) {
      await invalidateCapacity(organizationId);
      await notifyOrganization(organizationId, {
        type: NotificationType.SUBSCRIPTION_UPDATED,
        title: 'Vehicle top-up expired',
        body: 'A +1 vehicle top-up has lapsed. Your vehicles keep working — you just cannot add another until you renew or upgrade.',
        priority: NotificationPriority.NORMAL,
        actionUrl: '/settings/subscription',
        roles: ['FLEET_OWNER'],
      });
    }

    topUpLogger.info({ expired: lapsed.length }, 'Vehicle top-up expiry sweep complete');
    return lapsed.length;
  });

  return result ?? 0;
}
