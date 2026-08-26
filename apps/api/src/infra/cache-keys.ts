import { config } from '../config/env';

/**
 * Cache key namespace and TTL policy.
 *
 * Two rules, both from hard experience:
 *
 * 1. **Every key is namespaced by environment.** A developer pointing at a
 *    shared Redis must never read staging's entitlements.
 * 2. **Every key carries its tenant.** Anything derived from tenant-scoped data
 *    is keyed by `organizationId`, so a cache hit can never cross a tenant
 *    boundary — the class of bug that turns a cache into a data breach.
 *
 * There is deliberately no single default TTL. Freshness requirements differ by
 * orders of magnitude between a live vehicle position and a places lookup, and
 * one shared constant would be wrong for both.
 */

const PREFIX = `saarthi:${config.env}`;

export const cacheKeys = {
  vehicleLive: (vehicleId: string): string => `${PREFIX}:vehicle:${vehicleId}:live`,
  vehicleSummary: (vehicleId: string): string => `${PREFIX}:vehicle:${vehicleId}:summary`,
  vehicleServiceSummary: (vehicleId: string): string =>
    `${PREFIX}:vehicle:${vehicleId}:service-summary`,
  vehicleLoanSummary: (vehicleId: string): string => `${PREFIX}:vehicle:${vehicleId}:loan-summary`,

  fleetSummary: (organizationId: string): string => `${PREFIX}:fleet:${organizationId}:summary`,
  fleetLoanSummary: (organizationId: string): string =>
    `${PREFIX}:fleet:${organizationId}:loan-summary`,
  /** Assembled live-map payload: positions plus driver and trip labels. */
  fleetPositions: (organizationId: string): string =>
    `${PREFIX}:fleet:${organizationId}:positions`,

  subscriptionEntitlement: (organizationId: string): string =>
    `${PREFIX}:subscription:${organizationId}:entitlement`,

  /** Prefix for everything derived from one tenant, for bulk invalidation. */
  organizationPrefix: (organizationId: string): string => `${PREFIX}:fleet:${organizationId}`,
  vehiclePrefix: (vehicleId: string): string => `${PREFIX}:vehicle:${vehicleId}`,
} as const;

/**
 * TTLs in seconds, chosen against how stale each answer may safely be.
 *
 * Financial figures get a short window on purpose: an operator who has just
 * paid an EMI and still sees "overdue" will not trust the number again.
 */
export const cacheTtl = {
  /** Live position — heartbeat-driven, so this is a floor not a schedule. */
  liveState: 90,
  /** Dashboard aggregates: cheap to recompute, visibly wrong if stale. */
  fleetAggregate: 20,
  /** Vehicle passport-level rollups. */
  vehicleSummary: 60,
  /** Loan and EMI rollups. Invalidated explicitly on every write. */
  financeSummary: 60,
  /** Service history: changes only when a workshop record is filed. */
  serviceSummary: 300,
  /** Subscription entitlement — invalidated on any billing change. */
  entitlement: 15,
} as const;
