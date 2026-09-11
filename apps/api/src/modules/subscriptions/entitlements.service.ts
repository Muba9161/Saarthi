import {
  ALL_FEATURES,
  Feature,
  PLAN_LIMITS,
  effectiveVehicleLimit,
  PlanTier,
  SubscriptionStatus,
  featuresForTier,
  trackerFeatures,
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
 * Two things are folded in on top of the plan, because every capacity and
 * feature check in the system reads the resolved entitlement and none of them
 * should have to remember to do it themselves:
 *
 *   • active `+1 vehicle` top-ups, which raise `limits.maxTrucks`
 *   • active trackers, which grant the telemetry capabilities no plan sells
 *     and set `limits.maxDevices` to the number of units actually bought
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
    maxTrackers: num('maxTrackers'),
    telemetryRetentionDays: (num('telemetryRetentionDays') ??
      fallback.telemetryRetentionDays) as number,
  };
}

const ACTIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
];

/**
 * Remove features that exist in the catalogue but are not launched yet.
 *
 * Deferred features are stripped from the resolved entitlement rather than
 * from the plan catalogue. One switch then closes every door at once: the
 * feature guard on each route, the navigation item, and the buttons — all of
 * which already ask the same question. Nothing is deleted, so turning the flag
 * back on restores the surface exactly as it was.
 *
 * At module scope, and not inside `resolveEntitlement`, because the
 * development entitlement below must apply it too. While it did not, a
 * developer with `SUBSCRIPTION_ENFORCEMENT=false` was handed ALL_FEATURES raw
 * and `RESALE_ENABLED=false` did nothing whatsoever — the two switches
 * cancelled each other, and the one that looked more specific lost.
 *
 * "Not enforcing billing" and "this surface is not built yet" are different
 * questions. Only the first is a plan concern; the second holds regardless of
 * who is paying for what.
 */
function withoutDeferred(list: Feature[]): Feature[] {
  return config.resale.enabled
    ? list
    : list.filter(
        (feature) => feature !== Feature.RESALE_MARKETPLACE && feature !== Feature.RESALE_PUBLISH,
      );
}

/**
 * Everything, unlimited — the development entitlement.
 *
 * Returned in place of a real lookup when `SUBSCRIPTION_ENFORCEMENT` is off, so
 * a feature can be built and driven end-to-end without first seeding a plan or
 * buying a tracker. `enforced: false` travels with it, so the API and the UI
 * can say plainly that gating is off rather than implying the tenant paid for
 * all of this.
 */
function unenforcedEntitlement(): AuthSubscription {
  return {
    planTier: PlanTier.BUSINESS,
    planName: 'Development (enforcement off)',
    baseVehicleLimit: null,
    vehicleTopUps: 0,
    activeTrackers: 0,
    // Everything the product actually ships — see `withoutDeferred`. Handing
    // out ALL_FEATURES raw here is what kept the resale marketplace reachable
    // on a machine that had switched it off.
    features: withoutDeferred([...ALL_FEATURES]),
    limits: {
      maxTrucks: null,
      maxVehicleTopUps: Number.MAX_SAFE_INTEGER,
      maxDrivers: null,
      maxMembers: null,
      trackingHistoryDays: 3650,
      aiRequestsPerDay: Number.MAX_SAFE_INTEGER,
      maxDevices: null,
      maxTrackers: null,
      telemetryRetentionDays: 3650,
    },
    active: true,
    enforced: false,
  };
}

/** Trackers that are paid for and not retired. */
export async function countActiveTrackers(organizationId: string): Promise<number> {
  return prisma.vehicleTracker.count({
    where: { organizationId, status: 'ACTIVE' },
  });
}

export async function resolveSubscription(
  organizationId: string,
): Promise<AuthSubscription | null> {
  // Checked before the cache so flipping the flag takes effect on the next
  // request rather than fifteen seconds later.
  if (!config.subscription.enforced) return unenforcedEntitlement();

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
    const limitRow = subscription.plan.planFeatures.find((planFeature) => planFeature.limits !== null);

    const limits = limitsFromJson(limitRow?.limits, tier);

    /*
     * Vehicle capacity resolves to base + active top-ups, and device capacity
     * to the trackers actually bought.
     *
     * Folding both in here rather than at each call site is the point: every
     * capacity check in the system reads the resolved `limits`, so a tenant who
     * has paid for a `+1` or a tracker gets it everywhere at once, and no
     * future check can forget to add it. Top-ups are counted only while active
     * and unexpired; a tracker has no expiry, because it was bought outright.
     */
    const [activeTopUps, activeTrackers] = await Promise.all([
      limits.maxTrucks === null
        ? Promise.resolve(0)
        : prisma.vehicleSubscriptionTopUp.count({
            where: {
              organizationId,
              status: 'ACTIVE',
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          }),
      countActiveTrackers(organizationId),
    ]);

    /*
     * The tracker capabilities are added on top of the plan, never by it.
     *
     * They read hardware wired into a vehicle, so a tenant with no tracker has
     * nothing for them to report — see `TRACKER_ONLY_FEATURES` in the shared
     * catalogue. Adding them here means a Personal customer who fits one
     * tracker gets the same engine data a fleet does, which is the whole point
     * of charging for the device rather than for the tier.
     *
     * Granted only while the plan itself is active: an expired subscription
     * falls back to the Personal feature set, and reading live telemetry is not
     * part of that read-only fallback.
     */
    const planFeatures = active
      ? dbFeatures.length > 0
        ? dbFeatures
        : featuresForTier(tier)
      : featuresForTier(PlanTier.PERSONAL);

    const granted =
      active && activeTrackers > 0 ? [...planFeatures, ...trackerFeatures()] : planFeatures;

    value = {
      planTier: tier,
      planName: subscription.plan.name,
      baseVehicleLimit: limits.maxTrucks,
      vehicleTopUps: activeTopUps,
      activeTrackers,
      // Active plans grant their features; an expired/cancelled plan falls back
      // to the Personal feature set so the tenant keeps read access to its data.
      features: withoutDeferred([...new Set(granted)]),
      limits: {
        ...limits,
        maxTrucks: effectiveVehicleLimit(limits.maxTrucks, activeTopUps),
        // One device per tracker bought. Not a plan constant: the tracker *is*
        // the device, so anything else would either sell capacity for hardware
        // that does not exist or refuse hardware that does.
        maxDevices: activeTrackers,
      },
      active,
      enforced: true,
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

/**
 * Assign a plan to a brand-new organization.
 *
 * Business is the default because it is what every commercial registration
 * takes; a Personal registration passes `PERSONAL` explicitly. The trial length
 * comes from configuration rather than a constant so a launch promotion does
 * not need a deploy.
 */
export async function createDefaultSubscription(
  organizationId: string,
  tier: PlanTier = PlanTier.BUSINESS,
  options: { billing?: 'monthly' | 'yearly'; trialDays?: number } = {},
): Promise<void> {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { tier } });
  if (!plan) return;

  const trialDays = options.trialDays ?? config.subscription.trialDays;
  const billingPeriod = options.billing === 'yearly' ? 'YEARLY' : 'MONTHLY';

  await prisma.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      planId: plan.id,
      billingPeriod,
      // A zero-day trial is a real configuration — a launch with no free
      // period — and must not become an already-expired subscription.
      status: trialDays > 0 ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
      startsAt: new Date(),
      endsAt: trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000) : null,
    },
    update: {},
  });

  invalidateEntitlements(organizationId);
}

/**
 * The plan's own limits, before top-ups.
 *
 * Capacity screens need the base and the top-up count as separate figures —
 * "1 vehicle + 2 top-ups" explains a bill in a way "3 vehicles" does not.
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
