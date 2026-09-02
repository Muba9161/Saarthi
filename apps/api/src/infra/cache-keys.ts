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

  // --- Connected devices ---------------------------------------------------
  //
  // Keyed by device rather than by tenant because a device's own health is the
  // same fact whichever vehicle it is fitted to today, and it must survive a
  // reassignment. Tenant isolation is enforced where the key is *read*, by the
  // same authorisation that guards the device record itself.

  /** The unit's last self-reported health. Absence means "not heard from". */
  deviceStatus: (deviceId: string): string => `${PREFIX}:device:${deviceId}:status`,

  /**
   * Queued commands for a device that is not currently holding a socket.
   *
   * The durable record is `device_commands`; this is only the fast path, so
   * losing it costs a poll rather than a command.
   */
  deviceCommandQueue: (deviceId: string): string => `${PREFIX}:device:${deviceId}:commands`,

  /**
   * Single-use claim on a pairing token.
   *
   * The database row is authoritative, but two phones scanning the same QR
   * within the same millisecond would both pass a read-then-write check. This
   * key is taken with SET NX first, so exactly one of them proceeds to the
   * transaction.
   */
  devicePairingClaim: (tokenHash: string): string => `${PREFIX}:device:pair:${tokenHash}`,

  /**
   * Idempotency guard for a replayed offline event.
   *
   * A backstop in front of the unique index on `telemetry_readings`, so a phone
   * retrying a hundred-frame batch costs a hundred Redis reads rather than a
   * hundred failed inserts.
   */
  deviceEventIdempotency: (deviceId: string, eventId: string): string =>
    `${PREFIX}:device:${deviceId}:idem:${eventId}`,

  // --- Saarthi Terminal ----------------------------------------------------

  /**
   * The assembled terminal state view.
   *
   * Keyed by the terminal's device id, and invalidated explicitly on every
   * session transition rather than left to expire — a driver standing at a
   * truck watching a tablet for an approval must not wait out a TTL.
   */
  terminalState: (deviceId: string): string => `${PREFIX}:terminal:${deviceId}:state`,

  /**
   * Claim on one approval decision.
   *
   * Two managers opening the queue on two phones and both tapping Approve is an
   * entirely ordinary thing to happen. The transaction is what guarantees one
   * decision; this is what stops the second one doing the work and then
   * discovering it lost.
   */
  terminalDecisionClaim: (sessionId: string): string =>
    `${PREFIX}:terminal:decision:${sessionId}`,

  /**
   * Assistant request budget for one terminal session.
   *
   * A tablet with a stuck wake-word detector would otherwise spend a fleet's
   * AI quota overnight, and the driver would find out when they asked a real
   * question in the morning.
   */
  terminalAssistantBudget: (sessionId: string): string =>
    `${PREFIX}:terminal:ai:${sessionId}`,

  /**
   * Road distances for one origin and one set of destinations.
   *
   * Not tenant-scoped, and deliberately so: this is a fact about the public road
   * network between two points, identical for every fleet, and keying it per
   * tenant would multiply a bounded daily routing allowance by the number of
   * customers. Nothing tenant-owned is in the key or the value.
   */
  terminalRoadDistances: (signature: string): string =>
    `${PREFIX}:routing:matrix:${signature}`,

  /** One computed route. Same reasoning as above. */
  terminalRoute: (signature: string): string => `${PREFIX}:routing:route:${signature}`,

  /** Prefix for everything derived from one tenant, for bulk invalidation. */
  organizationPrefix: (organizationId: string): string => `${PREFIX}:fleet:${organizationId}`,
  vehiclePrefix: (vehicleId: string): string => `${PREFIX}:vehicle:${vehicleId}`,
  devicePrefix: (deviceId: string): string => `${PREFIX}:device:${deviceId}`,
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

  /**
   * Device health. Six heartbeats' grace, so one dropped packet on a train does
   * not read as a dead phone.
   */
  deviceStatus: 180,

  /** Queued commands. Matches the longest command TTL the API will issue. */
  deviceCommandQueue: 3_600,

  /** A pairing claim only has to outlive the transaction it guards. */
  devicePairingClaim: 60,

  /**
   * Idempotency window for replayed device events.
   *
   * Matches how long a device may hold an event before the gateway refuses it
   * as too old, so the guard cannot expire while a valid retry is still
   * possible.
   */
  deviceIdempotency: 86_400,

  /**
   * Assembled terminal state.
   *
   * Short: it carries an approval a person is waiting on, and being sixty
   * seconds stale about that is the difference between a driver setting off
   * and a driver standing in a yard wondering whether the tablet is broken.
   */
  terminalState: 10,

  /** Long enough to cover one decision transaction, and no longer. */
  terminalDecisionClaim: 30,

  /** One hour, matching the assistant's per-session ceiling. */
  terminalAssistantBudget: 3_600,

  /**
   * Routing results.
   *
   * Long, because the road network does not change in an afternoon and the
   * daily routing allowance is the scarce resource. There is no traffic model
   * behind these figures, so there is nothing that goes stale except the roads
   * themselves — the arrival time is recomputed from `now` on every cache hit.
   */
  terminalRoute: 1_800,
} as const;
