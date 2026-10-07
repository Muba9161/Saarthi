import {
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  BILLING_GRACE_DAYS,
  DATA_PURGE_AFTER_DAYS,
  SubscriptionStatus,
  quoteSubscription,
  trackerCharge,
  type PlanTier,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { isUniqueViolation, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { withLock } from '../../infra/lock';
import { paymentProvider, type CheckoutSession, type MandateStatus } from '../../providers/payments';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';
import { archiveUnpaid, warnUnpaid } from '../account-retention/account-retention.service';
import {
  registerMandateEventHandler,
  type MandateWebhookEvent,
} from '../payments/cashfree-webhook.service';
import {
  completeSettledPayment,
  openPayment,
  registerSettlementHandler,
  settlePayment,
  type SettledPayment,
} from '../payments/payment-settlement.service';
import {
  BILLING_PERIOD_MS,
  PLAN_PAYMENT_PREFIX,
  activatePaidAddOns,
  extendPaidPeriod,
  failPendingAddOns,
  invalidateBilling,
} from './billing.service';
import type { AuthContext } from '../../auth/context';

/**
 * The plan's own billing: the free trial, autopay, and what happens when a
 * period ends.
 *
 *   Paid plan → subscription → 30-day trial → trial active → recurring billing
 *
 * During the trial the owner sets up autopay: a mandate whose first charge is
 * the day the trial ends. Each month's charge then moves the paid period on by
 * a month (`extendPaidPeriod`). Without autopay the owner can pay a month
 * directly. A period that ends unpaid gets three days' grace with a warning,
 * then the account is archived — locked until renewed — and its own data is
 * deleted 90 days later (see `account-retention`).
 *
 * `runSubscriptionLifecycleSweep` is what makes the trial actually end: it
 * warns and archives unpaid periods, renews mock autopay, and warns an owner
 * three days before a trial ends with no autopay in place.
 */

const autopayLogger = logger.child({ module: 'subscriptions:autopay' });

/** Grace after an unpaid period ends, before the account is archived. */
const GRACE_MS = BILLING_GRACE_DAYS * 86_400_000;
/**
 * A Cashfree autopay debit can land a little after the due date, so an owner
 * with a live mandate is not warned until it is a day late.
 */
const AUTOPAY_WARN_AFTER_MS = 86_400_000;
const TRIAL_REMINDER_WINDOW_MS = 3 * 86_400_000;

const RENEWABLE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
];

/** Mandate states that are still expected to take the next charge. */
const LIVE_MANDATE: MandateStatus[] = ['ACTIVE', 'PENDING', 'ON_HOLD'];

export interface PendingPayment {
  reference: string;
  amount: number;
  createdAt: string;
  topUps: number;
  trackers: number;
}

export interface BillingStatus {
  provider: 'mock' | 'cashfree';
  tier: PlanTier;
  planName: string;
  status: string;
  /** Set while the free trial runs. */
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  /** The end of the current paid (or trial) period. */
  periodEndsAt: string | null;
  /** What each month costs now — plan plus active top-ups, GST included. */
  monthlyTotal: number;
  autopay: { provider: string; status: string; reference: string } | null;
  /** True for a paid plan, which is the only kind that bills. */
  billable: boolean;
  /** Extra vehicles and trackers ordered and waiting for their checkout. */
  pendingPayments: PendingPayment[];
}

async function monthlyTotalFor(organizationId: string, tier: PlanTier): Promise<number> {
  const topUps = await prisma.vehicleSubscriptionTopUp.count({
    where: { organizationId, status: 'ACTIVE' },
  });
  return quoteSubscription({ tier, vehicles: 1 + topUps }).monthly.total;
}

async function pendingPaymentsFor(organizationId: string): Promise<PendingPayment[]> {
  const where = { organizationId, status: 'PENDING_PAYMENT' as const };
  const [topUps, trackers] = await Promise.all([
    prisma.vehicleSubscriptionTopUp.findMany({
      where,
      select: { paymentReference: true, priceMonthly: true, createdAt: true },
    }),
    prisma.vehicleTracker.findMany({
      where,
      select: { paymentReference: true, pricePaid: true, createdAt: true },
    }),
  ]);

  const byReference = new Map<string, PendingPayment>();
  const entry = (reference: string, createdAt: Date): PendingPayment => {
    const existing = byReference.get(reference);
    if (existing) return existing;
    const created: PendingPayment = {
      reference,
      amount: 0,
      createdAt: createdAt.toISOString(),
      topUps: 0,
      trackers: 0,
    };
    byReference.set(reference, created);
    return created;
  };

  for (const row of topUps) {
    if (!row.paymentReference) continue;
    const group = entry(row.paymentReference, row.createdAt);
    group.topUps += 1;
    group.amount += Number(row.priceMonthly);
  }
  for (const row of trackers) {
    if (!row.paymentReference) continue;
    const group = entry(row.paymentReference, row.createdAt);
    group.trackers += 1;
    group.amount += trackerCharge(Number(row.pricePaid)).total;
  }

  return [...byReference.values()].map((group) => ({
    ...group,
    amount: Math.round(group.amount * 100) / 100,
  }));
}

export async function billingStatus(organizationId: string): Promise<BillingStatus | null> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
  if (!subscription) return null;

  const tier = subscription.plan.tier as PlanTier;
  const trialing = subscription.status === SubscriptionStatus.TRIALING;
  const endsAt = subscription.endsAt;

  return {
    provider: paymentProvider.name,
    tier,
    planName: subscription.plan.name,
    status: subscription.status,
    trialEndsAt: trialing && endsAt ? endsAt.toISOString() : null,
    trialDaysLeft:
      trialing && endsAt ? Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000)) : null,
    periodEndsAt: endsAt?.toISOString() ?? null,
    monthlyTotal: await monthlyTotalFor(organizationId, tier),
    autopay:
      subscription.externalRef && subscription.autopayProvider
        ? {
            provider: subscription.autopayProvider,
            status: subscription.autopayStatus ?? 'PENDING',
            reference: subscription.externalRef,
          }
        : null,
    billable: Number(subscription.plan.priceMonthly ?? 0) > 0,
    pendingPayments: await pendingPaymentsFor(organizationId),
  };
}

async function payer(auth: AuthContext) {
  return {
    name: `${auth.user.firstName} ${auth.user.lastName}`.trim(),
    email: auth.user.email,
    phone: auth.user.phone,
  };
}

/**
 * Set up autopay for the plan.
 *
 * The first charge is the end of the current period — the trial's last day,
 * or the day a paid month runs out — so setting it up early never charges
 * early. On the mock gateway the mandate is live at once; on Cashfree the
 * owner authorises it on the returned checkout.
 */
/** Server-side return paths — the client only ever names one of these. */
const AUTOPAY_RETURN_PATHS = {
  subscription: '/settings/subscription',
  activation: '/activate',
} as const;

export async function startAutopay(
  auth: AuthContext,
  organizationId: string,
  returnTo: keyof typeof AUTOPAY_RETURN_PATHS = 'subscription',
): Promise<{ status: BillingStatus | null; checkout: CheckoutSession | null }> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
  if (!subscription) throw errors.businessRule('This organization has no subscription.');
  if (Number(subscription.plan.priceMonthly ?? 0) <= 0) {
    throw errors.businessRule('Saarthi Free has nothing to bill, so it needs no autopay.');
  }
  if (!RENEWABLE_STATUSES.includes(subscription.status as SubscriptionStatus)) {
    throw errors.businessRule(
      'This subscription has lapsed. Pay for this month first, then set up autopay from the next.',
    );
  }
  if (
    subscription.externalRef &&
    subscription.autopayStatus &&
    ['ACTIVE', 'ON_HOLD'].includes(subscription.autopayStatus)
  ) {
    throw errors.conflict('Autopay is already set up for this subscription.');
  }

  /*
   * A mandate still PENDING is one of two things, and only the gateway knows
   * which: never authorised (the owner left Cashfree's page), or authorised and
   * waiting on the bank. The first is replaced — cancelled so it can never be
   * approved alongside the new one; the second is simply waited for, because a
   * second mandate would be a second monthly charge.
   */
  if (
    subscription.externalRef &&
    subscription.autopayStatus === 'PENDING' &&
    subscription.autopayProvider === paymentProvider.name
  ) {
    const state = await paymentProvider.fetchMandate(subscription.externalRef);
    const awaitingBank = /BANK_APPROVAL/i.test(state.providerStatus);
    if (state.status !== 'PENDING' || awaitingBank) {
      if (state.status !== subscription.autopayStatus) {
        await prisma.subscription.update({ where: { organizationId }, data: { autopayStatus: state.status } });
      }
      if (state.status === 'ACTIVE' || state.status === 'ON_HOLD' || awaitingBank) {
        return { status: await billingStatus(organizationId), checkout: null };
      }
    } else {
      await paymentProvider.cancelMandate(subscription.externalRef).catch((error: unknown) => {
        autopayLogger.warn({ err: error, organizationId }, 'Unauthorised mandate could not be cancelled before replacing it');
      });
    }
  }

  const tier = subscription.plan.tier as PlanTier;
  const monthlyAmount = await monthlyTotalFor(organizationId, tier);
  const firstChargeAt =
    subscription.endsAt && subscription.endsAt.getTime() > Date.now()
      ? subscription.endsAt
      : new Date(Date.now() + BILLING_PERIOD_MS);

  const mandate = await paymentProvider.createMandate({
    reference: `SUB-${organizationId.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`,
    monthlyAmount,
    firstChargeAt,
    customer: { id: organizationId, ...(await payer(auth)) },
    returnPath: AUTOPAY_RETURN_PATHS[returnTo],
  });

  await prisma.subscription.update({
    where: { organizationId },
    data: {
      externalRef: mandate.reference,
      autopayProvider: paymentProvider.name,
      autopayStatus: mandate.status,
      // A period with no end on a paid plan is a legacy row; autopay gives it one.
      ...(subscription.endsAt ? {} : { endsAt: firstChargeAt }),
    },
  });

  await recordAudit({
    action: AuditAction.SUBSCRIPTION_CHANGED,
    entityType: 'Subscription',
    entityId: subscription.id,
    actorUserId: auth.user.id,
    organizationId,
    after: {
      autopay: mandate.status,
      provider: paymentProvider.name,
      reference: mandate.reference,
      monthlyAmount,
      firstChargeAt: firstChargeAt.toISOString(),
    },
  });

  autopayLogger.info(
    { organizationId, reference: mandate.reference, status: mandate.status },
    'Autopay mandate created',
  );

  return { status: await billingStatus(organizationId), checkout: mandate.checkout };
}

/** Ask the provider where the mandate stands — used when the owner returns from authorising it. */
export async function refreshAutopay(organizationId: string): Promise<BillingStatus | null> {
  const subscription = await prisma.subscription.findUnique({ where: { organizationId } });
  if (subscription?.externalRef && subscription.autopayProvider === paymentProvider.name) {
    const state = await paymentProvider.fetchMandate(subscription.externalRef);
    if (state.status !== subscription.autopayStatus) {
      await prisma.subscription.update({
        where: { organizationId },
        data: { autopayStatus: state.status },
      });
      await recordAudit({
        action: AuditAction.SUBSCRIPTION_CHANGED,
        entityType: 'Subscription',
        entityId: subscription.id,
        actorUserId: null,
        organizationId,
        after: { autopayStatus: state.status, reference: subscription.externalRef },
      });
    }
  }
  return billingStatus(organizationId);
}

export async function cancelAutopay(
  auth: AuthContext,
  organizationId: string,
): Promise<BillingStatus | null> {
  const subscription = await prisma.subscription.findUnique({ where: { organizationId } });
  if (!subscription?.externalRef) throw errors.businessRule('Autopay is not set up.');

  if (subscription.autopayProvider === paymentProvider.name) {
    await paymentProvider.cancelMandate(subscription.externalRef);
  }
  await prisma.subscription.update({
    where: { organizationId },
    data: { autopayStatus: 'CANCELLED' },
  });

  await recordAudit({
    action: AuditAction.SUBSCRIPTION_CHANGED,
    entityType: 'Subscription',
    entityId: subscription.id,
    actorUserId: auth.user.id,
    organizationId,
    after: { autopay: 'CANCELLED', reference: subscription.externalRef },
  });

  return billingStatus(organizationId);
}

/**
 * Keep the mandate's monthly amount in step with what the plan now costs —
 * after a top-up goes live or the plan changes. Never throws: the change is
 * retried on the next one, and a failure here must not undo a purchase.
 */
export async function syncAutopayAmount(organizationId: string): Promise<void> {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
    if (
      !subscription?.externalRef ||
      subscription.autopayProvider !== paymentProvider.name ||
      !subscription.autopayStatus ||
      !LIVE_MANDATE.includes(subscription.autopayStatus as MandateStatus)
    ) {
      return;
    }
    const amount = await monthlyTotalFor(organizationId, subscription.plan.tier as PlanTier);
    await paymentProvider.changeMandateAmount(subscription.externalRef, amount);
  } catch (error) {
    autopayLogger.warn({ organizationId, error }, 'Could not update the autopay amount');
  }
}

/**
 * Pay for a month now — to renew a lapsed subscription, or to pay ahead
 * without autopay. One month, GST included, from the end of the current period.
 */
export async function payPlanNow(
  auth: AuthContext,
  organizationId: string,
): Promise<{ status: BillingStatus | null; checkout: CheckoutSession | null }> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
  if (!subscription) throw errors.businessRule('This organization has no subscription.');
  if (Number(subscription.plan.priceMonthly ?? 0) <= 0) {
    throw errors.businessRule('Saarthi Free costs nothing, so there is nothing to pay.');
  }

  const amount = await monthlyTotalFor(organizationId, subscription.plan.tier as PlanTier);
  const { paymentId, intent } = await openPayment({
    reference: `${PLAN_PAYMENT_PREFIX}${organizationId.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`,
    purpose: PaymentPurpose.SUBSCRIPTION,
    organizationId,
    userId: auth.user.id,
    amount,
    description: `${subscription.plan.name} — one month`,
    customer: await payer(auth),
    returnPath: '/settings/subscription',
    metadata: { kind: 'plan_month', tier: subscription.plan.tier },
  });

  if (intent.status === 'FAILED') {
    throw errors.businessRule(intent.failureMessage ?? 'The payment was declined.');
  }
  if (intent.status === 'SUCCEEDED') await completeSettledPayment(paymentId);

  return { status: await billingStatus(organizationId), checkout: intent.checkout };
}

/**
 * Re-open the checkout for extra vehicles and trackers still waiting to be
 * paid for — a checkout closed early, or a signup order on a hosted gateway.
 * A fresh gateway order is opened and the rows are moved onto it.
 */
export async function resumePendingPayment(
  auth: AuthContext,
  organizationId: string,
  reference: string,
): Promise<{ checkout: CheckoutSession | null; status: BillingStatus | null }> {
  const pending = (await pendingPaymentsFor(organizationId)).find(
    (group) => group.reference === reference,
  );
  if (!pending) throw errors.notFound('Pending payment');

  /*
   * The checkout it was ordered on may still be open, or even paid since. It
   * is settled first and reused if it can still be paid — opening a second
   * order beside a live one is how one purchase gets paid for twice.
   */
  const open = await prisma.payment.findFirst({
    where: { organizationId, providerReference: reference, status: PaymentStatus.PROCESSING },
  });
  if (open) {
    if ((await settlePayment(open.reference)) === PaymentStatus.SUCCEEDED) {
      return { checkout: null, status: await billingStatus(organizationId) };
    }
    const checkout = await paymentProvider.resumeCheckout(reference);
    if (checkout) return { checkout, status: await billingStatus(organizationId) };
  }

  const next = `ADDON-${organizationId.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
  const { paymentId, intent } = await openPayment({
    reference: next,
    purpose: PaymentPurpose.SUBSCRIPTION,
    organizationId,
    userId: auth.user.id,
    amount: pending.amount,
    description: 'Saarthi extra vehicles and trackers',
    customer: await payer(auth),
    returnPath: '/settings/subscription',
    metadata: {
      kind: 'addons',
      topUps: String(pending.topUps),
      trackers: String(pending.trackers),
    },
  });
  if (intent.status === 'FAILED') {
    throw errors.businessRule(intent.failureMessage ?? 'The payment was declined.');
  }

  const where = { organizationId, paymentReference: reference, status: 'PENDING_PAYMENT' as const };
  await Promise.all([
    prisma.vehicleSubscriptionTopUp.updateMany({
      where,
      data: { paymentReference: intent.providerReference },
    }),
    prisma.vehicleTracker.updateMany({ where, data: { paymentReference: intent.providerReference } }),
  ]);

  if (intent.status === 'SUCCEEDED') await completeSettledPayment(paymentId);
  return { checkout: intent.checkout, status: await billingStatus(organizationId) };
}

/** Whoever pays for this organization — recorded against autopay charges. */
async function ownerUserId(organizationId: string): Promise<string | null> {
  const membership = await prisma.membership.findFirst({
    where: { organizationId, status: 'ACTIVE' },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { userId: true },
  });
  return membership?.userId ?? null;
}

/**
 * A charge taken by autopay: recorded once — the payment reference is unique —
 * and the paid period moved on.
 */
async function recordAutopayCharge(input: {
  organizationId: string;
  reference: string;
  amount: number;
}): Promise<void> {
  const userId = await ownerUserId(input.organizationId);
  if (!userId) return;
  try {
    await prisma.payment.create({
      data: {
        reference: input.reference,
        purpose: PaymentPurpose.SUBSCRIPTION,
        status: PaymentStatus.SUCCEEDED,
        method: paymentProvider.name === 'mock' ? PaymentMethod.MOCK : PaymentMethod.ONLINE,
        organizationId: input.organizationId,
        initiatedByUserId: userId,
        amount: input.amount,
        currency: 'INR',
        provider: paymentProvider.name,
        providerReference: input.reference,
        processedAt: new Date(),
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return; // Already applied.
    throw error;
  }
  await extendPaidPeriod({
    organizationId: input.organizationId,
    paymentReference: input.reference,
    amount: input.amount,
  });
}

/** Cashfree Subscriptions webhooks, as `cashfree-webhook.service` hands them over. */
async function handleMandateEvent(event: MandateWebhookEvent): Promise<void> {
  if (!event.subscriptionId) return;
  const subscription = await prisma.subscription.findFirst({
    where: { externalRef: event.subscriptionId },
    include: { plan: true },
  });
  if (!subscription) return;
  const organizationId = subscription.organizationId;

  if (event.type === 'SUBSCRIPTION_PAYMENT_SUCCESS' && event.paymentType === 'CHARGE') {
    await recordAutopayCharge({
      organizationId,
      reference: `AUTOPAY-${event.paymentId ?? event.subscriptionId}`,
      amount: event.paymentAmount ?? (await monthlyTotalFor(organizationId, subscription.plan.tier as PlanTier)),
    });
    return;
  }

  if (event.type === 'SUBSCRIPTION_PAYMENT_FAILED' && event.paymentType === 'CHARGE') {
    await prisma.subscription.update({
      where: { organizationId },
      data: { status: SubscriptionStatus.PAST_DUE },
    });
    await invalidateBilling(organizationId);
    // No money moved, so there is no payment row — recorded here so the
    // account's billing history still shows the failed charge.
    await recordAudit({
      action: AuditAction.SUBSCRIPTION_CHANGED,
      entityType: 'Subscription',
      entityId: subscription.id,
      actorUserId: null,
      organizationId,
      after: {
        autopayCharge: 'FAILED',
        amount: event.paymentAmount,
        reason: event.failureReason,
        reference: event.paymentId,
      },
    });
    await notifyOrganization(organizationId, {
      type: NotificationType.PAYMENT_FAILED,
      title: 'Autopay payment failed',
      body: `This month's payment for ${subscription.plan.name} did not go through${
        event.failureReason ? ` (${event.failureReason})` : ''
      }. Cashfree will retry; you can also pay now from the subscription screen.`,
      priority: NotificationPriority.HIGH,
      actionUrl: '/settings/subscription',
      roles: OPERATOR_OWNER_ROLES,
    });
    return;
  }

  // Status and authorisation events: take the provider's word for the mandate
  // itself rather than the payload's.
  const state = await paymentProvider.fetchMandate(event.subscriptionId);
  if (state.status === subscription.autopayStatus) return;
  await prisma.subscription.update({
    where: { organizationId },
    data: { autopayStatus: state.status },
  });
  // The bank confirming, pausing or stopping autopay, for the billing history.
  await recordAudit({
    action: AuditAction.SUBSCRIPTION_CHANGED,
    entityType: 'Subscription',
    entityId: subscription.id,
    actorUserId: null,
    organizationId,
    after: { autopayStatus: state.status, reference: event.subscriptionId },
  });
  if (state.status === 'CANCELLED') {
    await notifyOrganization(organizationId, {
      type: NotificationType.SUBSCRIPTION_UPDATED,
      title: 'Autopay stopped',
      body: 'Autopay for your Saarthi subscription was cancelled. Set it up again, or pay each month from the subscription screen.',
      priority: NotificationPriority.NORMAL,
      actionUrl: '/settings/subscription',
      roles: OPERATOR_OWNER_ROLES,
    });
  }
}

registerMandateEventHandler(handleMandateEvent);

/**
 * End what has ended, renew what renews, warn about what is about to end.
 *
 * Runs under a lock so two workers never lapse or renew one subscription twice.
 */
export async function runSubscriptionLifecycleSweep(): Promise<{
  expired: number;
  renewed: number;
  reminded: number;
}> {
  const result = await withLock('jobs:subscription:lifecycle', 10 * 60_000, async () => {
    const now = Date.now();
    let expired = 0;
    let renewed = 0;
    let reminded = 0;

    const due = await prisma.subscription.findMany({
      // Paid plans only: Free has nothing to lapse.
      where: {
        status: { in: RENEWABLE_STATUSES },
        endsAt: { lt: new Date(now) },
        plan: { priceMonthly: { gt: 0 } },
      },
      include: { plan: true },
      take: 500,
    });

    for (const subscription of due) {
      const organizationId = subscription.organizationId;
      const overdue = now - (subscription.endsAt?.getTime() ?? now);
      const mandate = subscription.autopayStatus as MandateStatus | null;
      const liveMandate = Boolean(subscription.externalRef) && mandate !== null && LIVE_MANDATE.includes(mandate);

      try {
        if (liveMandate && subscription.autopayProvider === 'mock' && mandate === 'ACTIVE') {
          // The mock takes the month's charge itself, keyed on the period it pays for.
          await recordAutopayCharge({
            organizationId,
            reference: `AUTOPAY-${subscription.externalRef}-${subscription.endsAt?.getTime() ?? now}`,
            amount: await monthlyTotalFor(organizationId, subscription.plan.tier as PlanTier),
          });
          renewed += 1;
        } else if (config.subscription.enforced) {
          /*
           * Unpaid. Three days' grace with the warning, then archived. Never
           * with enforcement off: a development machine holds no account.
           *
           * With a live Cashfree mandate the debit is expected and confirmed
           * by webhook, so the warning waits a day for a late or retried
           * charge; the archive date is the same for everyone.
           */
          const periodEnd = subscription.endsAt ?? new Date(now);
          const cashfreeMandate = liveMandate && subscription.autopayProvider === 'cashfree';
          if (overdue >= GRACE_MS) {
            if (await archiveUnpaid({ organizationId, planName: subscription.plan.name })) expired += 1;
            await invalidateBilling(organizationId);
          } else if (!cashfreeMandate || overdue >= AUTOPAY_WARN_AFTER_MS) {
            if (await warnUnpaid({ organizationId, planName: subscription.plan.name, periodEnd })) {
              await invalidateBilling(organizationId);
            }
          }
        }
      } catch (error) {
        autopayLogger.error({ organizationId, error }, 'Subscription lifecycle step failed');
      }
    }

    // Three days' warning before a trial ends with nothing set up to pay for it.
    const endingSoon = await prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        endsAt: { gte: new Date(now), lt: new Date(now + TRIAL_REMINDER_WINDOW_MS) },
      },
      include: { plan: true },
      take: 500,
    });
    for (const subscription of endingSoon) {
      const covered =
        subscription.externalRef &&
        subscription.autopayStatus &&
        LIVE_MANDATE.includes(subscription.autopayStatus as MandateStatus);
      if (covered || Number(subscription.plan.priceMonthly ?? 0) <= 0) continue;

      const key = `subscription:trial-reminder:${subscription.id}`;
      if (await cache.get<boolean>(key)) continue;
      await cache.set(key, true, 4 * 86_400);

      await notifyOrganization(subscription.organizationId, {
        type: NotificationType.SUBSCRIPTION_UPDATED,
        title: 'Your free trial ends soon',
        body: `Your ${subscription.plan.name} trial ends on ${subscription.endsAt!.toLocaleDateString('en-IN')}. Set up autopay to carry on without a break - an account left unpaid is archived ${BILLING_GRACE_DAYS} days after, and deleted ${DATA_PURGE_AFTER_DAYS} days after that.`,
        priority: NotificationPriority.HIGH,
        actionUrl: '/settings/subscription',
        roles: OPERATOR_OWNER_ROLES,
      });
      reminded += 1;
    }

    if (expired + renewed + reminded > 0) {
      autopayLogger.info({ expired, renewed, reminded }, 'Subscription lifecycle sweep complete');
    }
    return { expired, renewed, reminded };
  });

  return result ?? { expired: 0, renewed: 0, reminded: 0 };
}

/**
 * What a settled subscription payment buys — see `billing.service`. Registered
 * here, beside autopay, because a new top-up changes the autopay amount.
 */
async function onSubscriptionPaymentSettled(payment: SettledPayment): Promise<void> {
  if (payment.reference.startsWith(PLAN_PAYMENT_PREFIX)) {
    await extendPaidPeriod({
      organizationId: payment.organizationId,
      paymentReference: payment.providerReference ?? payment.reference,
      amount: payment.amount,
    });
    return;
  }
  const activated = await activatePaidAddOns({
    organizationId: payment.organizationId,
    paymentReference: payment.providerReference ?? payment.reference,
    actorUserId: payment.initiatedByUserId,
  });
  // More vehicles means a larger monthly charge from here on.
  if (activated.topUps > 0) await syncAutopayAmount(payment.organizationId);
}

registerSettlementHandler(PaymentPurpose.SUBSCRIPTION, {
  onSucceeded: onSubscriptionPaymentSettled,
  onFailed: async (payment, message) => {
    if (payment.reference.startsWith(PLAN_PAYMENT_PREFIX)) return;
    await failPendingAddOns({
      organizationId: payment.organizationId,
      paymentReference: payment.providerReference ?? payment.reference,
      message,
    });
  },
});
