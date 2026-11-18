import {
  BILLING_GRACE_DAYS,
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  SubscriptionStatus,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { withLock } from '../../infra/lock';
import type { MandateStatus } from '../../providers/payments';
import { restoreArchivedAccount } from '../account-retention/account-retention.service';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';
import {
  LIVE_MANDATE,
  billingStatus,
  cancelAutopay,
  syncAutopayAmount,
  type BillingStatus,
} from './autopay.service';
import { invalidateBilling, paidPeriodWrites } from './billing.service';
import {
  COUPON_MONTHS,
  COUPON_SPAN_MS,
  activeCoupon,
  couponLockedUntil,
  findCoupon,
  type ActiveCoupon,
} from './coupons';
import type { AuthContext } from '../../auth/context';

/**
 * Applying a coupon — `coupons.ts` says what each one gives.
 *
 * Reached through a billing route, so it stays open while an account is
 * archived: from the expired screen a free coupon brings the account straight
 * back, and a partial one lowers what renewing costs.
 */

const couponLogger = logger.child({ module: 'subscriptions:coupon' });

/** How long before free months end the owner is warned, if nothing will pay for what follows. */
const REMINDER_WINDOW_MS = 3 * 86_400_000;

type CouponDefinition = NonNullable<ReturnType<typeof findCoupon>>;
type CouponSubscription = NonNullable<Awaited<ReturnType<typeof loadSubscription>>>;

/** What applying a coupon did: recorded for the billing history, and told to the owner. */
interface CouponOutcome {
  audit: Record<string, unknown>;
  message: string;
}

function loadSubscription(organizationId: string) {
  return prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
}

function inrDate(date: Date): string {
  return date.toLocaleDateString('en-IN');
}

function hasLiveMandate(subscription: {
  externalRef: string | null;
  autopayStatus: string | null;
}): boolean {
  return (
    Boolean(subscription.externalRef) &&
    LIVE_MANDATE.includes(subscription.autopayStatus as MandateStatus)
  );
}

/**
 * A 100% coupon: the months are granted now, after whatever is already
 * covered — the trial, or a month paid for. Entered again once the lock has
 * passed while they still run (a trial pushed them past it), it tops them
 * back up to three months from today rather than adding three more.
 *
 * A live mandate is stopped first, because Cashfree charges on its own monthly
 * schedule and knows nothing of free months. Set up again, its first charge
 * falls on the day they end.
 */
async function grantFreeMonths(
  auth: AuthContext,
  subscription: CouponSubscription,
  coupon: CouponDefinition,
  current: ActiveCoupon | null,
  now: number,
): Promise<CouponOutcome> {
  const covered = subscription.endsAt?.getTime() ?? now;
  const freeUntil = new Date(
    current?.freeUntil
      ? Math.max(Date.parse(current.freeUntil), now + COUPON_SPAN_MS)
      : Math.max(now, covered) + COUPON_SPAN_MS,
  );
  const endsAt = new Date(Math.max(covered, freeUntil.getTime()));

  const stopAutopay = hasLiveMandate(subscription);
  if (stopAutopay) await cancelAutopay(auth, subscription.organizationId);

  await prisma.$transaction([
    ...paidPeriodWrites(subscription.organizationId, endsAt, {
      couponCode: coupon.code,
      couponPercentOff: coupon.percentOff,
      couponMonthsLeft: 0,
      couponFreeUntil: freeUntil,
      couponAppliedAt: new Date(now),
    }),
  ]);
  await restoreArchivedAccount(subscription.organizationId);

  return {
    audit: { freeUntil: freeUntil.toISOString() },
    message:
      `${subscription.plan.name} is free until ${inrDate(freeUntil)}.` +
      (stopAutopay
        ? ' Autopay was stopped so nothing is charged meanwhile - set it up again before then to carry on without a break.'
        : ''),
  };
}

/**
 * A partial coupon: the next three plan charges are taken at its price, and
 * entering it again once the lock has passed tops it back up to three.
 * Autopay follows the lower amount now, and the full one once the discount is
 * used up (`extendPaidPeriod`).
 */
async function applyDiscount(
  subscription: CouponSubscription,
  coupon: CouponDefinition,
  current: ActiveCoupon | null,
  now: number,
): Promise<CouponOutcome> {
  if (current?.freeUntil) {
    throw errors.businessRule(
      `${current.code} already makes your plan free until ${inrDate(new Date(current.freeUntil))}. Apply ${coupon.code} after that.`,
    );
  }

  await prisma.subscription.update({
    where: { organizationId: subscription.organizationId },
    data: {
      couponCode: coupon.code,
      couponPercentOff: coupon.percentOff,
      couponMonthsLeft: COUPON_MONTHS,
      couponFreeUntil: null,
      couponAppliedAt: new Date(now),
    },
  });
  await syncAutopayAmount(subscription.organizationId);

  return {
    audit: { months: COUPON_MONTHS },
    message: `Your next ${COUPON_MONTHS} months of ${subscription.plan.name} are ${coupon.percentOff}% off.`,
  };
}

export async function redeemCoupon(
  auth: AuthContext,
  organizationId: string,
  code: string,
): Promise<BillingStatus | null> {
  const coupon = findCoupon(code);
  if (!coupon) throw errors.businessRule('That coupon code is not valid.');

  const applied = await withLock(`subscriptions:coupon:${organizationId}`, 30_000, async () => {
    const subscription = await loadSubscription(organizationId);
    if (!subscription) throw errors.businessRule('This organization has no subscription.');
    if (Number(subscription.plan.priceMonthly ?? 0) <= 0) {
      throw errors.businessRule('Saarthi Free costs nothing, so a coupon has nothing to take off.');
    }

    const now = Date.now();
    const lockedUntil = couponLockedUntil(subscription, now);
    if (lockedUntil) {
      throw errors.businessRule(
        `A coupon was already used on this account. You can enter another one after ${inrDate(lockedUntil)}.`,
        { lockedUntil: lockedUntil.toISOString() },
      );
    }

    const current = activeCoupon(subscription, now);
    const outcome =
      coupon.percentOff >= 100
        ? await grantFreeMonths(auth, subscription, coupon, current, now)
        : await applyDiscount(subscription, coupon, current, now);
    await invalidateBilling(organizationId);

    await recordAudit({
      action: AuditAction.SUBSCRIPTION_CHANGED,
      entityType: 'Subscription',
      entityId: subscription.id,
      actorUserId: auth.user.id,
      organizationId,
      before: current ? { coupon: current.code } : undefined,
      after: { coupon: coupon.code, percentOff: coupon.percentOff, ...outcome.audit },
    });
    await notifyOrganization(organizationId, {
      type: NotificationType.SUBSCRIPTION_UPDATED,
      title: `Coupon ${coupon.code} applied`,
      body: outcome.message,
      priority: NotificationPriority.NORMAL,
      actionUrl: '/settings/subscription',
      roles: OPERATOR_OWNER_ROLES,
    });
    couponLogger.info({ organizationId, coupon: coupon.code }, 'Coupon applied');
    return true;
  });
  if (!applied) {
    throw errors.conflict(
      'A coupon is already being applied to this account. Try again in a moment.',
    );
  }

  return billingStatus(organizationId);
}

/**
 * Three days' warning before a free coupon's months end with nothing set up
 * to pay for the month after. Runs with the hourly subscription lifecycle job.
 */
export async function remindFreeMonthsEnding(): Promise<number> {
  const reminded = await withLock('jobs:subscription:coupon-reminder', 10 * 60_000, async () => {
    const now = Date.now();
    const ending = await prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        couponFreeUntil: { gte: new Date(now), lt: new Date(now + REMINDER_WINDOW_MS) },
      },
      include: { plan: true },
      take: 500,
    });

    let count = 0;
    for (const subscription of ending) {
      const freeUntil = subscription.couponFreeUntil;
      // A month paid on top of the free ones, or autopay ready: nothing to warn about.
      if (
        !freeUntil ||
        subscription.endsAt?.getTime() !== freeUntil.getTime() ||
        hasLiveMandate(subscription)
      ) {
        continue;
      }

      const key = `subscription:coupon-reminder:${subscription.id}:${freeUntil.getTime()}`;
      if (await cache.get<boolean>(key)) continue;
      await cache.set(key, true, 4 * 86_400);

      await notifyOrganization(subscription.organizationId, {
        type: NotificationType.SUBSCRIPTION_UPDATED,
        title: 'Your free months end soon',
        body: `${subscription.couponCode ?? 'Your coupon'} keeps ${subscription.plan.name} free until ${inrDate(freeUntil)}. Set up autopay or pay for the next month to carry on - an account left unpaid is archived ${BILLING_GRACE_DAYS} days after.`,
        priority: NotificationPriority.HIGH,
        actionUrl: '/settings/subscription',
        roles: OPERATOR_OWNER_ROLES,
      });
      count += 1;
    }
    return count;
  });

  return reminded ?? 0;
}
