import {
  PaymentTrigger,
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  SubscriptionStatus,
  inclusiveOfGst,
  trackerCharge,
  sumTotals,
  type PlanTier,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { restoreArchivedAccount } from '../account-retention/account-retention.service';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';
import { qualifyPayment, qualifySubscriptionPayment } from '../sales/qualification';
import { invalidateEntitlements } from './entitlements.service';

/**
 * What a settled subscription payment buys.
 *
 * Two kinds of charge carry `PaymentPurpose.SUBSCRIPTION`:
 *
 *   • add-ons — `+1 vehicle` top-ups and trackers, ordered at signup or from
 *     the subscription screen. Their rows wait in PENDING_PAYMENT, granting
 *     nothing, until the payment settles; then they go live together.
 *   • the plan itself — a month paid for directly (a `PLAN-` reference) or by
 *     autopay. Either way the paid period moves forward one month.
 *
 * Both are reached through `settlePayment`, once per payment.
 */

const billingLogger = logger.child({ module: 'subscriptions:billing' });

/** One billing month. Matches the top-up window. */
export const BILLING_PERIOD_MS = 30 * 86_400_000;

/** A plan payment's reference, so settlement can tell it from add-ons. */
export const PLAN_PAYMENT_PREFIX = 'PLAN-';

export async function invalidateBilling(organizationId: string): Promise<void> {
  invalidateEntitlements(organizationId);
  await cache.delete(cacheKeys.subscriptionEntitlement(organizationId));
}

async function planTierOf(organizationId: string): Promise<PlanTier | null> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { plan: { select: { tier: true } } },
  });
  return (subscription?.plan.tier as PlanTier | undefined) ?? null;
}

/**
 * Put the top-ups and trackers a payment bought on the account.
 *
 * The move out of PENDING_PAYMENT is conditional, so a repeated call finds
 * nothing left to activate and does nothing.
 */
export async function activatePaidAddOns(input: {
  organizationId: string;
  paymentReference: string;
  actorUserId: string | null;
}): Promise<{ topUps: number; trackers: number }> {
  const where = {
    organizationId: input.organizationId,
    paymentReference: input.paymentReference,
    status: 'PENDING_PAYMENT' as const,
  };
  const [topUps, trackers] = await Promise.all([
    prisma.vehicleSubscriptionTopUp.findMany({ where, select: { id: true, priceMonthly: true } }),
    prisma.vehicleTracker.findMany({ where, select: { id: true, pricePaid: true } }),
  ]);
  if (topUps.length === 0 && trackers.length === 0) return { topUps: 0, trackers: 0 };

  const now = new Date();
  /*
   * A top-up runs to the plan's own period end — the trial end, or the date the
   * next autopay charge renews everything — rather than 30 days from purchase.
   * The renewal charge then bills it from that date, so no day is paid twice.
   * With no future period end to align to, it falls back to one period.
   */
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: input.organizationId },
    select: { endsAt: true },
  });
  const topUpExpiresAt =
    subscription?.endsAt && subscription.endsAt > now
      ? subscription.endsAt
      : new Date(now.getTime() + BILLING_PERIOD_MS);

  const [movedTopUps, movedTrackers] = await Promise.all([
    topUps.length === 0
      ? Promise.resolve({ count: 0 })
      : prisma.vehicleSubscriptionTopUp.updateMany({
          where: { id: { in: topUps.map((row) => row.id) }, status: 'PENDING_PAYMENT' },
          data: {
            status: 'ACTIVE',
            startsAt: now,
            expiresAt: topUpExpiresAt,
          },
        }),
    trackers.length === 0
      ? Promise.resolve({ count: 0 })
      : prisma.vehicleTracker.updateMany({
          where: { id: { in: trackers.map((row) => row.id) }, status: 'PENDING_PAYMENT' },
          data: { status: 'ACTIVE', purchasedAt: now },
        }),
  ]);

  await invalidateBilling(input.organizationId);

  // Recorded on what was actually charged, split the way the invoice is: every
  // price is final with GST inside it, a tracker's derived from its base price.
  const topUpCharge = inclusiveOfGst(topUps.reduce((sum, row) => sum + Number(row.priceMonthly), 0));
  const trackersCharged = sumTotals(...trackers.map((row) => trackerCharge(Number(row.pricePaid))));
  const tier = await planTierOf(input.organizationId);

  if (movedTopUps.count > 0) {
    await recordAudit({
      action: AuditAction.SUBSCRIPTION_TOPUP_PURCHASED,
      entityType: 'VehicleSubscriptionTopUp',
      entityId: topUps[0]!.id,
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      after: {
        count: movedTopUps.count,
        price: topUpCharge.subtotal,
        gst: topUpCharge.gst,
        charged: topUpCharge.total,
        reference: input.paymentReference,
      },
    });
    await qualifyPayment({
      organizationId: input.organizationId,
      baseAmount: topUpCharge.subtotal,
      paymentReference: input.paymentReference,
      trigger: PaymentTrigger.VEHICLE_TOPUP,
      planTier: tier,
    });
  }

  if (movedTrackers.count > 0) {
    await recordAudit({
      action: AuditAction.SUBSCRIPTION_TRACKER_PURCHASED,
      entityType: 'VehicleTracker',
      entityId: trackers[0]!.id,
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      after: {
        count: movedTrackers.count,
        price: trackersCharged.subtotal,
        gst: trackersCharged.gst,
        charged: trackersCharged.total,
        reference: input.paymentReference,
      },
    });
    await qualifyPayment({
      organizationId: input.organizationId,
      baseAmount: trackersCharged.subtotal,
      paymentReference: input.paymentReference,
      trigger: PaymentTrigger.TRACKER,
      planTier: tier,
    });
  }

  const parts = [
    movedTopUps.count > 0
      ? `${movedTopUps.count} extra vehicle${movedTopUps.count === 1 ? '' : 's'}`
      : null,
    movedTrackers.count > 0
      ? `${movedTrackers.count} tracker${movedTrackers.count === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean);

  await notifyOrganization(input.organizationId, {
    type: NotificationType.SUBSCRIPTION_UPDATED,
    title: 'Payment received',
    body:
      `${parts.join(' and ')} added to your account.` +
      (movedTrackers.count > 0
        ? ' Live telemetry is unlocked — fit each tracker and pair it from the Devices screen.'
        : ''),
    priority: NotificationPriority.NORMAL,
    actionUrl: movedTrackers.count > 0 ? '/devices' : '/settings/subscription',
    roles: OPERATOR_OWNER_ROLES,
  });

  billingLogger.info(
    {
      organizationId: input.organizationId,
      reference: input.paymentReference,
      topUps: movedTopUps.count,
      trackers: movedTrackers.count,
    },
    'Paid add-ons activated',
  );

  return { topUps: movedTopUps.count, trackers: movedTrackers.count };
}

/** A declined add-on payment: its rows are kept for the record, granting nothing. */
export async function failPendingAddOns(input: {
  organizationId: string;
  paymentReference: string;
  message: string;
}): Promise<void> {
  const where = {
    organizationId: input.organizationId,
    paymentReference: input.paymentReference,
    status: 'PENDING_PAYMENT' as const,
  };
  const [topUps, trackers] = await Promise.all([
    prisma.vehicleSubscriptionTopUp.updateMany({
      where,
      data: { status: 'PAYMENT_FAILED', note: input.message.slice(0, 200) },
    }),
    prisma.vehicleTracker.updateMany({
      where,
      data: { status: 'PAYMENT_FAILED', note: input.message.slice(0, 200) },
    }),
  ]);
  if (topUps.count + trackers.count === 0) return;

  await notifyOrganization(input.organizationId, {
    type: NotificationType.PAYMENT_FAILED,
    title: 'Payment failed',
    body: `${input.message} Nothing was added — try again from the subscription screen.`,
    priority: NotificationPriority.HIGH,
    actionUrl: '/settings/subscription',
    roles: OPERATOR_OWNER_ROLES,
  });
}

/**
 * Move the paid period forward one month — a plan payment settled.
 *
 * From whichever is later, the current period end or now, so an early payment
 * does not lose the days already paid for and a late one does not charge for
 * days that passed unpaid. Active top-ups follow the plan's period, because
 * the monthly charge covered them too.
 */
export async function extendPaidPeriod(input: {
  organizationId: string;
  paymentReference: string;
  amount: number;
}): Promise<void> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: input.organizationId },
    include: { plan: true },
  });
  if (!subscription) return;

  const now = Date.now();
  const from = Math.max(now, subscription.endsAt?.getTime() ?? now);
  const endsAt = new Date(from + BILLING_PERIOD_MS);

  await prisma.$transaction([
    prisma.subscription.update({
      where: { organizationId: input.organizationId },
      data: { status: SubscriptionStatus.ACTIVE, endsAt, cancelledAt: null },
    }),
    prisma.vehicleSubscriptionTopUp.updateMany({
      where: { organizationId: input.organizationId, status: 'ACTIVE', expiresAt: { not: null } },
      data: { expiresAt: endsAt },
    }),
  ]);

  // A renewal paid while archived brings the account back as it was.
  await restoreArchivedAccount(input.organizationId);
  await invalidateBilling(input.organizationId);

  await qualifySubscriptionPayment({
    organizationId: input.organizationId,
    baseAmount: inclusiveOfGst(input.amount).subtotal,
    paymentReference: input.paymentReference,
    planTier: subscription.plan.tier as PlanTier,
    subscriptionId: subscription.id,
  });

  await notifyOrganization(input.organizationId, {
    type: NotificationType.SUBSCRIPTION_UPDATED,
    title: 'Subscription paid',
    body: `Thank you — ${subscription.plan.name} is paid until ${endsAt.toLocaleDateString('en-IN')}.`,
    priority: NotificationPriority.NORMAL,
    actionUrl: '/settings/subscription',
    roles: OPERATOR_OWNER_ROLES,
  });

  billingLogger.info(
    { organizationId: input.organizationId, reference: input.paymentReference, endsAt },
    'Paid period extended',
  );
}
