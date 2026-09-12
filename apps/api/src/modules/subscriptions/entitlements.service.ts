import {
  ALL_FEATURES,
  Feature,
  PLAN_LIMITS,
  accountFeatures,
  accountRunsVehicles,
  effectiveVehicleLimit,
  OrganizationType,
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
 * And one thing is folded *out*: whatever this kind of business cannot use.
 * A freight fleet, a travel operator and a materials supplier all buy the same
 * Business plan, and exactly one of them owns a vehicle — so resolving on the
 * plan alone handed a supplier live telemetry, backhaul matching and a driver
 * roster it has no drivers for. `accountFeatures` in the shared catalogue is
 * where that subtraction is defined; applying it here means every gated route,
 * every navigation item and every upgrade prompt gets the same answer without
 * any of them having to ask a second question.
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

  const [subscription, organization] = await Promise.all([
    prisma.subscription.findUnique({
      where: { organizationId },
      include: {
        plan: {
          include: {
            planFeatures: { include: { feature: true } },
          },
        },
      },
    }),
    // The kind of business, which decides what the plan's features are
    // narrowed to. Read in the same round trip rather than lazily: every
    // request resolves this, and a second query per request to answer one
    // enum would be paid on the hot path.
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    }),
  ]);

  const organizationType = (organization?.type as OrganizationType | undefined) ?? null;

  let value: AuthSubscription | null = null;

  if (subscription) {
    const expired =
      subscription.endsAt !== null && subscription.endsAt.getTime() < Date.now();
    const active =
      !expired && ACTIVE_STATUSES.includes(subscription.status as SubscriptionStatus);

    const tier = subscription.plan.tier as PlanTier;
    /** Whether this account enters the vehicle/tracker ecosystem at all. */
    const runsVehicles = accountRunsVehicles({ tier, organizationType });
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
     * An expired or cancelled plan falls back to a read-only floor rather than
     * to nothing, so a tenant never loses sight of their own data over a
     * lapsed card.
     *
     * Which floor depends on whether there are vehicles to read about. Personal
     * is the right fallback for an operator; for a supplier or a customer it
     * offered maintenance records and trip replay for vehicles that do not
     * exist, so Free — the plan built for an account with none — is the honest
     * one. The account-shape filter below would strip most of the difference
     * anyway; choosing the right floor here means the two agree instead of one
     * undoing the other.
     */
    const lapsedFloor = runsVehicles ? PlanTier.PERSONAL : PlanTier.FREE;

    const planFeatures = active
      ? dbFeatures.length > 0
        ? dbFeatures
        : featuresForTier(tier)
      : featuresForTier(lapsedFloor);

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
     * falls back to the read-only floor above, and reading live telemetry is
     * not part of that.
     */
    const withTracker =
      active && activeTrackers > 0 ? [...planFeatures, ...trackerFeatures()] : planFeatures;

    /*
     * The plan, narrowed to what this kind of business can actually use.
     *
     * Applied last so it wins over everything above it, including the tracker
     * grant: a tracker bought against a supplier account — which should never
     * happen, and is now refused at both registration and purchase — would
     * otherwise hand it the telemetry surface anyway.
     */
    const granted = accountFeatures({
      tier,
      organizationType,
      planFeatures: withTracker,
    });

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
        /*
         * Vehicle capacity, or none at all.
         *
         * An account that does not run vehicles resolves to zero however
         * generous its plan is — a supplier on Business is on the same plan as
         * a fleet, and the plan is not the thing that decides this. Written
         * here rather than left to each capacity check, because "can I add a
         * vehicle?" is asked in a dozen places and every one of them reads
         * this number.
         */
        maxTrucks: runsVehicles
          ? effectiveVehicleLimit(limits.maxTrucks, activeTopUps)
          : 0,
        // One device per tracker bought. Not a plan constant: the tracker *is*
        // the device, so anything else would either sell capacity for hardware
        // that does not exist or refuse hardware that does.
        maxDevices: runsVehicles ? activeTrackers : 0,
        maxVehicleTopUps: runsVehicles ? limits.maxVehicleTopUps : 0,
        maxTrackers: runsVehicles ? limits.maxTrackers : 0,
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

  /*
   * Free is not on trial, because there is nothing for the trial to end.
   *
   * A trial is a paid plan somebody has not started paying for yet, and it
   * expires — which for Free would mean an account that costs nothing lapsing
   * after fourteen days and falling back to a read-only floor. So it is
   * created ACTIVE with no end date, and the trial applies to the two plans
   * that are actually sold.
   */
  const trialDays = tier === PlanTier.FREE ? 0 : options.trialDays ?? config.subscription.trialDays;
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
