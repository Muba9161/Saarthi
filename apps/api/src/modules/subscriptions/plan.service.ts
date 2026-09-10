import {
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  PLAN_CATALOGUE,
  PlanTier,
  SubscriptionStatus,
  VEHICLE_TOPUP,
  VEHICLE_TRACKER,
  quoteSubscription,
  type SelectPlanInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';
import { config } from '../../config/env';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';
import { countActiveTrackers, invalidateEntitlements } from './entitlements.service';
import { countActiveTopUps } from './topup.service';
import type { AuthContext } from '../../auth/context';

/**
 * Changing plan.
 *
 * There are two plans, so this is a switch rather than a ladder — and the only
 * direction that can hurt is Business → Personal, because Personal caps
 * vehicles, seats and drivers. That check is done up front and refuses with the
 * specific number that is in the way, rather than accepting the change and
 * leaving the tenant over every limit at once.
 *
 * Nothing is ever deleted by a downgrade. Vehicles, members and drivers already
 * on the fleet keep working exactly as they are; what a tighter plan withholds
 * is the right to add the next one. That rule is the same one
 * `describeVehicleCapacity` documents, and it exists because an operator who
 * economises must not thereby lose the record of their own fleet.
 */

const planLogger = logger.child({ module: 'subscriptions:plan' });

export interface PlanSummary {
  tier: PlanTier;
  name: string;
  status: string;
  billingPeriod: string;
  startsAt: string;
  endsAt: string | null;
  priceMonthly: number | null;
  priceYearly: number | null;
  /** Vehicles, seats and drivers in use — what a downgrade would be measured against. */
  usage: { vehicles: number; members: number; drivers: number; trackers: number };
  /** What this tenant pays a month, plan plus top-ups, before GST. */
  monthlySubtotal: number;
  /** GST on that, at the rate in the shared catalogue. */
  monthlyGst: number;
  /** Subtotal plus GST — what actually leaves the account each month. */
  monthlyTotal: number;
  gstRate: number;
  /** False when `SUBSCRIPTION_ENFORCEMENT` is off — development only. */
  enforced: boolean;
}

async function usageFor(organizationId: string) {
  const [vehicles, members, drivers, trackers] = await Promise.all([
    prisma.truck.count({ where: { organizationId, archivedAt: null } }),
    prisma.membership.count({ where: { organizationId, status: 'ACTIVE' } }),
    prisma.driver.count({ where: { organizationId, archivedAt: null } }),
    countActiveTrackers(organizationId),
  ]);
  return { vehicles, members, drivers, trackers };
}

export async function currentPlan(organizationId: string): Promise<PlanSummary | null> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
  if (!subscription) return null;

  const tier = subscription.plan.tier as PlanTier;
  const usage = await usageFor(organizationId);
  const topUps = await countActiveTopUps(organizationId);

  const billed = quoteSubscription({
    tier,
    vehicles: (subscription.plan.priceMonthly === null ? 0 : 1) + topUps,
    billing: subscription.billingPeriod === 'YEARLY' ? 'yearly' : 'monthly',
  });

  return {
    tier,
    name: subscription.plan.name,
    status: subscription.status,
    billingPeriod: subscription.billingPeriod,
    startsAt: subscription.startsAt.toISOString(),
    endsAt: subscription.endsAt?.toISOString() ?? null,
    priceMonthly: subscription.plan.priceMonthly ? Number(subscription.plan.priceMonthly) : null,
    priceYearly: subscription.plan.priceYearly ? Number(subscription.plan.priceYearly) : null,
    usage,
    // Priced from the top-ups actually held rather than from the vehicle
    // count, so a fleet that is over capacity after a lapse sees the bill it
    // has, not the bill its vehicles would imply.
    monthlySubtotal: billed.monthly.subtotal,
    monthlyGst: billed.monthly.gst,
    monthlyTotal: billed.monthly.total,
    gstRate: billed.gstRate,
    enforced: config.subscription.enforced,
  };
}

/** The lineup as every pricing surface renders it. */
export function planCatalogue() {
  return {
    plans: PLAN_CATALOGUE,
    topUp: VEHICLE_TOPUP,
    tracker: VEHICLE_TRACKER,
  };
}

/**
 * What would block a move to this plan, if anything.
 *
 * Returned as a list rather than thrown so the UI can show every obstacle at
 * once. Somebody with four vehicles and three team members should learn both
 * facts in one screen, not discover the second after fixing the first.
 */
export function downgradeBlockers(input: {
  target: PlanTier;
  usage: { vehicles: number; members: number; drivers: number };
  activeTopUps: number;
}): string[] {
  const plan = PLAN_CATALOGUE.find((candidate) => candidate.tier === input.target);
  if (!plan) return ['That plan does not exist.'];

  const { limits } = plan;
  const blockers: string[] = [];

  const vehicleCeiling =
    limits.maxTrucks === null ? null : limits.maxTrucks + limits.maxVehicleTopUps;
  if (vehicleCeiling !== null && input.usage.vehicles > vehicleCeiling) {
    blockers.push(
      `${plan.name} covers at most ${vehicleCeiling} vehicles, including top-ups. You run ${input.usage.vehicles}.`,
    );
  }
  if (limits.maxMembers !== null && input.usage.members > limits.maxMembers) {
    blockers.push(
      `${plan.name} is a single-person account. Your organization has ${input.usage.members} active members.`,
    );
  }
  if (limits.maxDrivers !== null && input.usage.drivers > limits.maxDrivers) {
    blockers.push(
      `${plan.name} covers up to ${limits.maxDrivers} drivers. You have ${input.usage.drivers}.`,
    );
  }
  if (input.activeTopUps > limits.maxVehicleTopUps) {
    blockers.push(
      `${plan.name} allows up to ${limits.maxVehicleTopUps} vehicle top-ups. You hold ${input.activeTopUps}.`,
    );
  }

  return blockers;
}

/**
 * Move an organization onto a plan.
 *
 * Idempotent for the tier: choosing the plan you are already on only updates
 * the billing period, and does not restart a trial or re-notify the team.
 */
export async function selectPlan(
  auth: AuthContext,
  organizationId: string,
  input: SelectPlanInput,
): Promise<PlanSummary> {
  const [existing, target] = await Promise.all([
    prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } }),
    prisma.subscriptionPlan.findUnique({ where: { tier: input.tier } }),
  ]);

  if (!target) {
    throw errors.businessRule(
      'That plan is not available. Run `npm run db:seed` if this is a fresh environment.',
    );
  }

  const [usage, activeTopUps] = await Promise.all([
    usageFor(organizationId),
    countActiveTopUps(organizationId),
  ]);

  const blockers = downgradeBlockers({ target: input.tier, usage, activeTopUps });
  if (blockers.length > 0) {
    throw errors.businessRule(
      `This plan does not cover what you are already running: ${blockers.join(' ')}`,
      { blockers },
    );
  }

  const billingPeriod = input.billing === 'yearly' ? 'YEARLY' : 'MONTHLY';
  const previousTier = existing ? (existing.plan.tier as PlanTier) : null;

  await prisma.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      planId: target.id,
      billingPeriod,
      status: SubscriptionStatus.ACTIVE,
      startsAt: new Date(),
      endsAt: null,
    },
    update: {
      planId: target.id,
      billingPeriod,
      // A plan chosen and paid for ends a trial and clears any lapse: the
      // tenant has just told us what they want and settled it.
      status: SubscriptionStatus.ACTIVE,
      endsAt: null,
      cancelledAt: null,
    },
  });

  invalidateEntitlements(organizationId);
  await cache.delete(cacheKeys.subscriptionEntitlement(organizationId));

  if (previousTier !== input.tier) {
    await recordAudit({
      action: AuditAction.SUBSCRIPTION_PLAN_CHANGED,
      entityType: 'Subscription',
      entityId: organizationId,
      actorUserId: auth.user.id,
      organizationId,
      before: previousTier ? { tier: previousTier } : undefined,
      after: { tier: input.tier, billingPeriod },
    });

    await notifyOrganization(organizationId, {
      type: NotificationType.SUBSCRIPTION_UPDATED,
      title: `Now on ${target.name}`,
      body:
        input.tier === PlanTier.BUSINESS
          ? 'The marketplace, dispatch, analytics and AI are available now.'
          : 'Your plan covers your own vehicles. Nothing already on the fleet was changed.',
      priority: NotificationPriority.NORMAL,
      actionUrl: '/settings/subscription',
      roles: OPERATOR_OWNER_ROLES,
    });

    planLogger.info(
      { organizationId, from: previousTier, to: input.tier, billingPeriod },
      'Subscription plan changed',
    );
  }

  const summary = await currentPlan(organizationId);
  // Unreachable: the upsert above guarantees a row.
  if (!summary) throw errors.internal('The subscription could not be read back after the change.');
  return summary;
}
