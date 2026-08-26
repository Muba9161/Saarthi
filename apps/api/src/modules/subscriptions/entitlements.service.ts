import {
  Feature,
  PLAN_LIMITS,
  effectiveVehicleLimit,
  PlanTier,
  SubscriptionStatus,
  featuresForTier,
  type PlanLimits,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import type { AuthSubscription } from '../../auth/context';

/**
 * Entitlement resolution: organization → subscription → plan → features.
 *
 * The plan→feature mapping is stored in PostgreSQL (`plan_features`) so it can
 * be tuned without a deploy; the shared catalogue is only the seed source and
 * the fallback when a row is missing.
 *
 * A short in-process cache keeps the hot path off the database on every
 * request while still reacting to plan changes within seconds.
 */

interface CacheEntry {
  value: AuthSubscription | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, CacheEntry>();

export function invalidateEntitlements(organizationId?: string): void {
  if (organizationId) cache.delete(organizationId);
  else cache.clear();
}

function limitsFromJson(raw: unknown, tier: PlanTier): PlanLimits {
  const fallback = PLAN_LIMITS[tier];
  if (!raw || typeof raw !== 'object') return fallback;
  const record = raw as Record<string, unknown>;
  const num = (key: keyof PlanLimits): number | null => {
    const value = record[key];
    if (value === null) return null;
    return typeof value === 'number' ? value : (fallback[key] as number | null);
  };
  return {
    maxTrucks: num('maxTrucks'),
    maxVehicleTopUps: (num('maxVehicleTopUps') ?? fallback.maxVehicleTopUps) as number,
    maxDrivers: num('maxDrivers'),
    maxMembers: num('maxMembers'),
    trackingHistoryDays: (num('trackingHistoryDays') ?? fallback.trackingHistoryDays) as number,
    aiRequestsPerDay: (num('aiRequestsPerDay') ?? fallback.aiRequestsPerDay) as number,
    maxDevices: num('maxDevices'),
    telemetryRetentionDays: (num('telemetryRetentionDays') ??
      fallback.telemetryRetentionDays) as number,
  };
}

const ACTIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
];

export async function resolveSubscription(
  organizationId: string,
): Promise<AuthSubscription | null> {
  const cached = cache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: {
      plan: {
        include: {
          planFeatures: { include: { feature: true } },
        },
      },
    },
  });

  let value: AuthSubscription | null = null;

  if (subscription) {
    const expired =
      subscription.endsAt !== null && subscription.endsAt.getTime() < Date.now();
    const active =
      !expired && ACTIVE_STATUSES.includes(subscription.status as SubscriptionStatus);

    const tier = subscription.plan.tier as PlanTier;
    const dbFeatures = subscription.plan.planFeatures
      .map((planFeature) => planFeature.feature.key as Feature)
      .filter(Boolean);

    // Aggregate limits across the plan's feature rows, falling back to the tier.
    const limitRow = subscription.plan.planFeatures.find((pf) => pf.limits !== null);

    const limits = limitsFromJson(limitRow?.limits, tier);

    /*
     * Vehicle capacity resolves to base + active top-ups.
     *
     * Folding it in here rather than at each call site is the point: every
     * capacity check in the system reads `limits.maxTrucks`, so a tenant who
     * has paid for a `+1` gets it everywhere at once, and no future check can
     * forget to add it. Top-ups are counted only while active and unexpired.
     */
    const activeTopUps =
      limits.maxTrucks === null
        ? 0
        : await prisma.vehicleSubscriptionTopUp.count({
            where: {
              organizationId,
              status: 'ACTIVE',
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          });

    /*
     * Deferred features are removed from the resolved entitlement rather than
     * from the plan catalogue. One switch then closes every door at once: the
     * feature guard on each route, the navigation item, and the buttons — all
     * of which already ask the same question. Nothing is deleted, so turning
     * the flag back on restores the surface exactly as it was.
     */
    const withoutDeferred = (list: Feature[]): Feature[] =>
      config.resale.enabled
        ? list
        : list.filter(
            (feature) =>
              feature !== Feature.RESALE_MARKETPLACE && feature !== Feature.RESALE_PUBLISH,
          );

    value = {
      planTier: tier,
      planName: subscription.plan.name,
      baseVehicleLimit: limits.maxTrucks,
      vehicleTopUps: activeTopUps,
      // Active plans grant their features; an expired/cancelled plan falls back
      // to the Basic feature set so the tenant keeps read access to its data.
      features: withoutDeferred(
        active
          ? dbFeatures.length > 0
            ? dbFeatures
            : featuresForTier(tier)
          : featuresForTier(PlanTier.BASIC),
      ),
      limits: {
        ...limits,
        maxTrucks: effectiveVehicleLimit(limits.maxTrucks, activeTopUps),
      },
      active,
    };
  }

  cache.set(organizationId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function subscriptionHasFeature(
  subscription: AuthSubscription | null,
  feature: Feature,
): boolean {
  if (!subscription) return false;
  return subscription.features.includes(feature);
}

/** Assign the default plan to a brand-new organization. */
export async function createDefaultSubscription(
  organizationId: string,
  tier: PlanTier = PlanTier.PRO,
  trialDays = 30,
): Promise<void> {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { tier } });
  if (!plan) return;

  await prisma.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      planId: plan.id,
      status: SubscriptionStatus.TRIALING,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + trialDays * 86_400_000),
    },
    update: {},
  });

  invalidateEntitlements(organizationId);
}

/**
 * The plan's own limits, before top-ups.
 *
 * Capacity screens need the base and the top-up count as separate figures —
 * "5 vehicles + 2 top-ups" explains a bill in a way "7 vehicles" does not.
 * `resolveSubscription` deliberately returns only the combined number, because
 * every enforcement check wants that one and nothing else.
 */
export async function resolveBaseLimits(
  organizationId: string,
): Promise<{ tier: PlanTier; planName: string; limits: PlanLimits } | null> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: { include: { planFeatures: true } } },
  });
  if (!subscription) return null;

  const tier = subscription.plan.tier as PlanTier;
  const limitRow = subscription.plan.planFeatures.find((planFeature) => planFeature.limits !== null);

  return {
    tier,
    planName: subscription.plan.name,
    limits: limitsFromJson(limitRow?.limits, tier),
  };
}
