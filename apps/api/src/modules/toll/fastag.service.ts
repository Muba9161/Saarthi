import {
  FastagStatus,
  Feature,
  NotificationPriority,
  NotificationType,
  Permission,
  TollDataSource,
  buildPaginationMeta,
  fastagBlocksTravel,
  formatCurrency,
  hasPermission,
  maskTagId,
  resolveFastagHealth,
  type DiscoverFastagInput,
  type FastagHealthResult,
  type FastagListQuery,
  type Paginated,
  type RecordFastagBalanceInput,
  type RecordFastagRechargeInput,
  type RegisterFastagInput,
  type SyncFastagInput,
  type UpdateFastagInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { AppError, errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { skipTake } from '../../lib/http';
import { withLock } from '../../infra/lock';
import { queue } from '../../infra/queue';
import { assertTenantAccess, hasFeature } from '../../server/guards';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';
import { fastagProvider, type ProviderTagDetails } from '../../providers/fastag';
import { importProviderCrossings } from './toll.service';
import type { AuthContext } from '../../auth/context';

/**
 * FASTag accounts.
 *
 * What Saarthi can and cannot know about a tag is the shape of this module, and
 * it is worth being exact about it:
 *
 *   • **Status comes from NETC.** Active, blacklisted, hotlisted, the vehicle
 *     class, the issuing bank. A lookup provider serves this.
 *   • **The balance does not.** It belongs to the issuing bank and is served to
 *     the account holder. So a balance in Saarthi is one somebody recorded, it
 *     carries the time it was true, and it goes stale — a reading from last
 *     week describes an account that has been paying tolls ever since.
 *   • **Recharging happens at the issuer.** Saarthi records a top-up that
 *     happened elsewhere and links to the issuer; it does not move money.
 *
 * Pretending otherwise on any of the three would put a number in front of an
 * operator that looks live and is not.
 */

const fastagLogger = logger.child({ module: 'fastag' });

export interface FastagView {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  /** Masked unless the caller holds `FASTAG_SENSITIVE`. */
  tagId: string | null;
  tagIdMasked: boolean;
  issuerBank: string;
  issuerCode: string | null;
  vehicleClass: string | null;
  status: FastagStatus;

  /** `null` means nobody has reported one — never rendered as zero. */
  balance: number | null;
  balanceUpdatedAt: string | null;
  lowBalanceThreshold: number;
  health: FastagHealthResult;

  linkedAccountRef: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  closedAt: string | null;

  source: TollDataSource;
  providerName: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the configured provider can actually do, for the UI to respect. */
export interface FastagCapabilities {
  provider: string;
  supportsLookup: boolean;
  supportsBalance: boolean;
  supportsRecharge: boolean;
  supportsTransactions: boolean;
  unavailableReason: string;
  defaultLowBalanceThreshold: number;
}

export function fastagCapabilities(): FastagCapabilities {
  return {
    provider: fastagProvider.name,
    supportsLookup: fastagProvider.supportsLookup,
    supportsBalance: fastagProvider.supportsBalance,
    supportsRecharge: fastagProvider.supportsRecharge,
    supportsTransactions: fastagProvider.supportsTransactions,
    unavailableReason: fastagProvider.unavailableReason,
    defaultLowBalanceThreshold: config.fastag.lowBalanceThreshold,
  };
}

type FastagRow = Prisma.FastagAccountGetPayload<Record<string, never>>;

const num = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

function toView(row: FastagRow, registrationNumber: string, unmasked: boolean): FastagView {
  const balance = num(row.balance);
  const threshold = num(row.lowBalanceThreshold) ?? config.fastag.lowBalanceThreshold;
  const tag = maskTagId(row.tagId, unmasked);

  return {
    id: row.id,
    vehicleId: row.vehicleId,
    registrationNumber,
    tagId: tag.value,
    tagIdMasked: tag.masked,
    issuerBank: row.issuerBank,
    issuerCode: row.issuerCode,
    vehicleClass: row.vehicleClass,
    status: row.status as FastagStatus,

    balance,
    balanceUpdatedAt: row.balanceUpdatedAt?.toISOString() ?? null,
    lowBalanceThreshold: threshold,
    health: resolveFastagHealth({
      status: row.status as FastagStatus,
      balance,
      balanceUpdatedAt: row.balanceUpdatedAt,
      lowBalanceThreshold: threshold,
      expiresAt: row.expiresAt,
    }),

    // The linked bank account is owner-level for the same reason as the tag id.
    linkedAccountRef: unmasked ? row.linkedAccountRef : null,
    issuedAt: row.issuedAt?.toISOString().slice(0, 10) ?? null,
    expiresAt: row.expiresAt?.toISOString().slice(0, 10) ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,

    source: row.source as TollDataSource,
    providerName: row.providerName,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: row.lastSyncError,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function canSeeTagId(auth: AuthContext): boolean {
  return auth.isPlatformAdmin || hasPermission(auth.permissions, Permission.FASTAG_SENSITIVE);
}

async function vehicleLabels(vehicleIds: string[]): Promise<Map<string, string>> {
  if (vehicleIds.length === 0) return new Map();
  const vehicles = await prisma.truck.findMany({
    where: { id: { in: [...new Set(vehicleIds)] } },
    select: { id: true, registrationNumber: true },
  });
  return new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.registrationNumber]));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface FastagListTotals {
  tags: number;
  needsAttention: number;
  blocked: number;
  lowBalance: number;
  unknownBalance: number;
  /** Total across tags with a recorded balance. Excludes the unknown ones. */
  knownBalanceTotal: number;
}

export async function listFastags(
  auth: AuthContext,
  organizationId: string,
  query: FastagListQuery,
): Promise<Paginated<FastagView> & { totals: FastagListTotals }> {
  const where: Prisma.FastagAccountWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId ? {} : { organizationId }),
    ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    ...(query.status ? { status: { in: query.status as FastagStatus[] } } : {}),
    ...(query.search
      ? {
          OR: [
            { issuerBank: { contains: query.search, mode: 'insensitive' } },
            { vehicle: { registrationNumber: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
    closedAt: null,
  };

  const [total, rows] = await Promise.all([
    prisma.fastagAccount.count({ where }),
    prisma.fastagAccount.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const labels = await vehicleLabels(rows.map((row) => row.vehicleId));
  const unmasked = canSeeTagId(auth);

  let items = rows.map((row) =>
    toView(row, labels.get(row.vehicleId) ?? 'Unknown', unmasked),
  );

  // Filtered after the view is built, because "needs attention" is a computed
  // verdict — a stale balance is not a status the database records.
  if (query.needsAttention) {
    items = items.filter((item) => item.health.health !== 'OK');
  }

  const totals: FastagListTotals = {
    tags: items.length,
    needsAttention: items.filter((item) => item.health.health !== 'OK').length,
    blocked: items.filter((item) => item.health.health === 'BLOCKED').length,
    lowBalance: items.filter((item) => item.health.health === 'LOW_BALANCE').length,
    unknownBalance: items.filter((item) => item.balance === null).length,
    knownBalanceTotal: Number(
      items.reduce((sum, item) => sum + (item.balance ?? 0), 0).toFixed(2),
    ),
  };

  return {
    items,
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
    totals,
  };
}

export async function getFastag(auth: AuthContext, fastagId: string): Promise<FastagView> {
  const row = await prisma.fastagAccount.findUnique({ where: { id: fastagId } });
  if (!row) throw errors.notFound('FASTag');
  assertTenantAccess(auth, row.organizationId, 'FASTag');

  const vehicle = await prisma.truck.findUnique({
    where: { id: row.vehicleId },
    select: { registrationNumber: true },
  });

  return toView(row, vehicle?.registrationNumber ?? 'Unknown', canSeeTagId(auth));
}

/** Tags fitted to one vehicle — the Vehicle Passport panel. */
export async function vehicleFastags(
  auth: AuthContext,
  vehicleId: string,
): Promise<FastagView[]> {
  const vehicle = await prisma.truck.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const rows = await prisma.fastagAccount.findMany({
    where: { vehicleId },
    orderBy: [{ closedAt: 'asc' }, { createdAt: 'desc' }],
  });

  const unmasked = canSeeTagId(auth);
  return rows.map((row) => toView(row, vehicle.registrationNumber, unmasked));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function registerFastag(
  auth: AuthContext,
  organizationId: string,
  input: RegisterFastagInput,
): Promise<FastagView> {
  const vehicle = await prisma.truck.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const duplicate = await prisma.fastagAccount.findFirst({
    where: { organizationId, tagId: input.tagId },
  });
  if (duplicate) {
    throw errors.duplicate('That FASTag is already recorded against a vehicle.', {
      fastagId: duplicate.id,
    });
  }

  // NETC allows one active tag per vehicle. An older tag is closed rather than
  // deleted, so a crossing from last year still resolves to the tag that paid.
  const existing = await prisma.fastagAccount.findFirst({
    where: { vehicleId: input.vehicleId, closedAt: null },
  });
  if (existing) {
    await prisma.fastagAccount.update({
      where: { id: existing.id },
      data: {
        closedAt: new Date(),
        closeReason: 'Replaced by a newly registered tag.',
        status: FastagStatus.CLOSED,
      },
    });
  }

  const row = await prisma.fastagAccount.create({
    data: {
      organizationId,
      vehicleId: input.vehicleId,
      tagId: input.tagId,
      issuerBank: input.issuerBank,
      issuerCode: input.issuerCode ?? null,
      vehicleClass: input.vehicleClass ?? null,
      status: input.status,
      balance: input.balance ?? null,
      // A balance is meaningless without the moment it was true.
      balanceUpdatedAt: input.balance === undefined ? null : new Date(),
      lowBalanceThreshold: input.lowBalanceThreshold ?? null,
      linkedAccountRef: input.linkedAccountRef ?? null,
      issuedAt: input.issuedAt ?? null,
      expiresAt: input.expiresAt ?? null,
      notes: input.notes ?? null,
      source: TollDataSource.MANUAL,
      createdById: auth.user.id,
    },
  });

  await recordAudit({
    action: AuditAction.FASTAG_REGISTERED,
    entityType: 'FastagAccount',
    entityId: row.id,
    actorUserId: auth.user.id,
    organizationId,
    // The tag id is never written to the audit trail in full.
    after: { vehicleId: input.vehicleId, issuerBank: input.issuerBank },
  });

  return toView(row, vehicle.registrationNumber, canSeeTagId(auth));
}

export async function updateFastag(
  auth: AuthContext,
  fastagId: string,
  input: UpdateFastagInput,
): Promise<FastagView> {
  const existing = await prisma.fastagAccount.findUnique({ where: { id: fastagId } });
  if (!existing) throw errors.notFound('FASTag');
  assertTenantAccess(auth, existing.organizationId, 'FASTag');

  await prisma.fastagAccount.update({
    where: { id: fastagId },
    data: {
      ...(input.issuerBank !== undefined ? { issuerBank: input.issuerBank } : {}),
      ...(input.issuerCode !== undefined ? { issuerCode: input.issuerCode } : {}),
      ...(input.vehicleClass !== undefined ? { vehicleClass: input.vehicleClass } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.lowBalanceThreshold !== undefined
        ? { lowBalanceThreshold: input.lowBalanceThreshold }
        : {}),
      ...(input.linkedAccountRef !== undefined
        ? { linkedAccountRef: input.linkedAccountRef }
        : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      // A balance passed through the general update still stamps its time.
      ...(input.balance !== undefined
        ? { balance: input.balance, balanceUpdatedAt: new Date() }
        : {}),
    },
  });

  return getFastag(auth, fastagId);
}

/**
 * Record a balance the operator read at the issuer.
 *
 * `observedAt` matters: somebody entering Tuesday's reading on Friday must not
 * have it stamped as current, or the staleness rule silently stops working.
 */
export async function recordBalance(
  auth: AuthContext,
  fastagId: string,
  input: RecordFastagBalanceInput,
): Promise<FastagView> {
  const existing = await prisma.fastagAccount.findUnique({ where: { id: fastagId } });
  if (!existing) throw errors.notFound('FASTag');
  assertTenantAccess(auth, existing.organizationId, 'FASTag');

  const observedAt = input.observedAt ?? new Date();

  await prisma.fastagAccount.update({
    where: { id: fastagId },
    data: {
      balance: input.balance,
      balanceUpdatedAt: observedAt,
      // A balance above the threshold clears a LOW_BALANCE the issuer set, but
      // never clears a blacklist — money in the account does not lift that.
      ...(existing.status === FastagStatus.LOW_BALANCE &&
      input.balance >=
        (Number(existing.lowBalanceThreshold) || config.fastag.lowBalanceThreshold)
        ? { status: FastagStatus.ACTIVE }
        : {}),
      source: input.source as TollDataSource,
    },
  });

  return getFastag(auth, fastagId);
}

export interface RechargeResult {
  fastag: FastagView;
  /** True when Saarthi recorded a top-up rather than performing one. */
  recordedOnly: boolean;
  message: string;
}

/**
 * Record a recharge.
 *
 * Saarthi does not move money onto a tag: that is the issuing bank's rail, and
 * a verification provider has no part in it. What this does is keep the balance
 * and the spend history coherent after the operator topped up elsewhere — and
 * say so, rather than presenting itself as a payment.
 */
export async function recordRecharge(
  auth: AuthContext,
  fastagId: string,
  input: RecordFastagRechargeInput,
): Promise<RechargeResult> {
  const existing = await prisma.fastagAccount.findUnique({ where: { id: fastagId } });
  if (!existing) throw errors.notFound('FASTag');
  assertTenantAccess(auth, existing.organizationId, 'FASTag');

  const rechargedAt = input.rechargedAt ?? new Date();
  const previous = num(existing.balance);

  // Prefer the balance the issuer showed; fall back to adding the top-up to the
  // last known figure, and stay null when there was nothing to add to.
  const balanceAfter =
    input.balanceAfter ?? (previous === null ? null : Number((previous + input.amount).toFixed(2)));

  await prisma.fastagAccount.update({
    where: { id: fastagId },
    data: {
      ...(balanceAfter !== null ? { balance: balanceAfter, balanceUpdatedAt: rechargedAt } : {}),
      ...(existing.status === FastagStatus.LOW_BALANCE ? { status: FastagStatus.ACTIVE } : {}),
      notes: input.notes ?? existing.notes,
    },
  });

  await recordAudit({
    action: AuditAction.FASTAG_RECHARGE_RECORDED,
    entityType: 'FastagAccount',
    entityId: fastagId,
    actorUserId: auth.user.id,
    organizationId: existing.organizationId,
    after: { amount: input.amount, reference: input.reference ?? null },
  });

  fastagLogger.info(
    { fastagId, organizationId: existing.organizationId, amount: input.amount },
    'FASTag recharge recorded',
  );

  return {
    fastag: await getFastag(auth, fastagId),
    recordedOnly: !fastagProvider.supportsRecharge,
    message: fastagProvider.supportsRecharge
      ? 'Recharge recorded.'
      : `Recorded ${formatCurrency(input.amount)} against this tag. Saarthi does not top up a FASTag — ` +
        'that happens at your issuing bank — so this keeps your balance and spend history in step ' +
        'with what you actually did.',
  };
}

// ---------------------------------------------------------------------------
// NETC lookup
// ---------------------------------------------------------------------------

export interface FastagSyncResult {
  provider: string;
  retrievedAt: string;
  simulated: boolean;
  applied: boolean;
  statusChanged: boolean;
  previousStatus: FastagStatus;
  status: FastagStatus;
  /** `null` when the provider does not serve balances, which is usual. */
  balance: number | null;
  balanceServed: boolean;
  crossingsImported: number;
  coverageNote: string | null;
  fastag: FastagView;
}

/**
 * Pull live tag state from NETC.
 *
 * Two things this deliberately does not do:
 *
 *   • **It does not clear a balance when the provider serves none.** A lookup
 *     that returns no balance is the normal case, and overwriting a recorded
 *     figure with null on every sync would erase the only number the fleet has.
 *   • **It does not silently downgrade.** A tag that has become blacklisted
 *     raises a notification, because that is a truck that will be stopped at
 *     the next barrier and charged double.
 */
export async function syncFastag(
  auth: AuthContext,
  fastagId: string,
  input: SyncFastagInput,
): Promise<FastagSyncResult> {
  const existing = await prisma.fastagAccount.findUnique({ where: { id: fastagId } });
  if (!existing) throw errors.notFound('FASTag');
  assertTenantAccess(auth, existing.organizationId, 'FASTag');

  if (!fastagProvider.supportsLookup) {
    throw errors.providerNotConfigured('fastag', fastagProvider.unavailableReason);
  }

  const vehicle = await prisma.truck.findUniqueOrThrow({
    where: { id: existing.vehicleId },
    select: { registrationNumber: true },
  });

  let details;
  try {
    details = await fastagProvider.fetchTagDetails({
      registrationNumber: vehicle.registrationNumber,
      tagId: existing.tagId,
    });
  } catch (error) {
    await prisma.fastagAccount.update({
      where: { id: fastagId },
      data: {
        lastSyncError: error instanceof Error ? error.message : 'Lookup failed.',
        lastSyncedAt: new Date(),
      },
    });
    throw error;
  }

  const previousStatus = existing.status as FastagStatus;
  const statusChanged = details.status !== previousStatus;

  if (input.apply) {
    await prisma.fastagAccount.update({
      where: { id: fastagId },
      data: {
        status: details.status,
        ...(details.vehicleClass ? { vehicleClass: details.vehicleClass } : {}),
        ...(details.issuerCode ? { issuerCode: details.issuerCode } : {}),
        ...(details.issuerBank ? { issuerBank: details.issuerBank } : {}),
        ...(details.issuedAt ? { issuedAt: new Date(details.issuedAt) } : {}),
        // Only written when the provider actually served one.
        ...(details.balance !== null
          ? { balance: details.balance, balanceUpdatedAt: new Date(details.retrievedAt) }
          : {}),
        source: details.simulated ? TollDataSource.SIMULATED : TollDataSource.PROVIDER_SYNC,
        providerName: details.provider,
        lastSyncedAt: new Date(details.retrievedAt),
        lastSyncError: null,
      },
    });
  }

  // A tag that has just become unusable is worth interrupting someone for: the
  // truck is still moving, and the next plaza will charge double.
  if (statusChanged && fastagBlocksTravel(details.status)) {
    await notifyOrganization(existing.organizationId, {
      type: NotificationType.FASTAG_BLACKLISTED,
      title: `FASTag ${details.status.toLowerCase()} — ${vehicle.registrationNumber}`,
      body:
        `The issuer now reports this tag as ${details.status.toLowerCase()}. ` +
        'Toll will be charged at double the cash rate until it is cleared with the issuing bank.',
      priority: NotificationPriority.CRITICAL,
      actionUrl: '/fleet/toll',
      roles: ['FLEET_OWNER', 'FLEET_MANAGER'],
    });
  }

  let crossingsImported = 0;
  let coverageNote: string | null = null;

  if (input.includeTransactions && fastagProvider.supportsTransactions) {
    const history = await fastagProvider.fetchTollHistory({
      registrationNumber: vehicle.registrationNumber,
      tagId: existing.tagId,
    });
    coverageNote = history.coverageNote;

    if (input.apply) {
      crossingsImported = await importProviderCrossings(
        existing.organizationId,
        existing.vehicleId,
        fastagId,
        history,
      );
    }
  }

  await recordAudit({
    action: AuditAction.FASTAG_SYNCED,
    entityType: 'FastagAccount',
    entityId: fastagId,
    actorUserId: auth.user.id,
    organizationId: existing.organizationId,
    after: {
      provider: details.provider,
      status: details.status,
      crossingsImported,
      simulated: details.simulated,
    },
  });

  return {
    provider: details.provider,
    retrievedAt: details.retrievedAt,
    simulated: details.simulated,
    applied: input.apply,
    statusChanged,
    previousStatus,
    status: details.status,
    balance: details.balance,
    balanceServed: details.balance !== null,
    crossingsImported,
    coverageNote,
    fastag: await getFastag(auth, fastagId),
  };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * What a discovery attempt found — including the cases where it found nothing.
 *
 * "This vehicle has no tag" is a real answer rather than a failure, and it is
 * reported as one. The caller is often a background job fired by adding a
 * vehicle, and a fleet whose truck genuinely has no FASTag must not be shown an
 * error, nor a tag row invented to fill the space.
 */
export interface FastagDiscoveryResult {
  provider: string;
  registrationNumber: string;
  /** NETC holds a tag against this vehicle. */
  found: boolean;
  /** Why nothing was recorded, when nothing was. Null once a tag is stored. */
  reason: string | null;
  applied: boolean;
  /** Saarthi already held this exact tag; it was refreshed, not added again. */
  alreadyKnown: boolean;
  /** A previously recorded tag was closed because NETC reports a different one. */
  replacedPreviousTag: boolean;
  /** The provider named the issuing bank rather than serving only a code. */
  issuerNamed: boolean;
  /** Almost always false — see the note at the top of this module. */
  balanceServed: boolean;
  crossingsImported: number;
  coverageNote: string | null;
  retrievedAt: string;
  simulated: boolean;
  fastag: FastagView | null;
}

/**
 * A name for the issuing bank, which the column requires and NETC does not give.
 *
 * The feed serves a numeric bank identifier. It is carried through as a code
 * rather than mapped to a bank name, because a tag labelled with the wrong bank
 * sends an operator to the wrong app to top it up — worse than an unlovely
 * label they can correct in one edit.
 */
function issuerLabel(details: ProviderTagDetails): string {
  if (details.issuerBank) return details.issuerBank;
  if (details.issuerCode) return `NETC issuer ${details.issuerCode}`;
  return 'Issuer not reported';
}

/**
 * Resolve the tag fitted to a vehicle from its registration number alone.
 *
 * This is the only FASTag lookup that needs no tag id, and that is what makes
 * it worth having: it lets a fleet add a truck and have its tag appear without
 * anybody reading a 24-character identifier off a windscreen sticker.
 *
 * What comes back is tag *status*, not money. The rupee balance belongs to the
 * issuing bank, so a discovered tag arrives with `balance: null` unless the
 * provider genuinely served one — never as zero.
 *
 * The organization is taken from the vehicle rather than from the caller: the
 * tag belongs where the vehicle does, which also stops a platform admin acting
 * on a tenant from filing the tag under the wrong one.
 */
export async function discoverFastag(
  auth: AuthContext,
  input: DiscoverFastagInput,
): Promise<FastagDiscoveryResult> {
  const vehicle = await prisma.truck.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  if (!fastagProvider.supportsLookup) {
    throw errors.providerNotConfigured('fastag', fastagProvider.unavailableReason);
  }

  const organizationId = vehicle.organizationId;
  const registrationNumber = vehicle.registrationNumber;

  const nothingFound = (reason: string): FastagDiscoveryResult => ({
    provider: fastagProvider.name,
    registrationNumber,
    found: false,
    reason,
    applied: false,
    alreadyKnown: false,
    replacedPreviousTag: false,
    issuerNamed: false,
    balanceServed: false,
    crossingsImported: 0,
    coverageNote: null,
    retrievedAt: new Date().toISOString(),
    simulated: false,
    fastag: null,
  });

  let details: ProviderTagDetails;
  try {
    details = await fastagProvider.fetchTagDetails({ registrationNumber });
  } catch (error) {
    // The adapter reports "no tag against this vehicle" as a 404. That is an
    // answer rather than a fault, and it is the likeliest outcome for a
    // second-hand vehicle — so it is returned instead of thrown.
    if (error instanceof AppError && error.statusCode === 404) {
      return nothingFound('NETC has no FASTag registered against this vehicle.');
    }
    throw error;
  }

  if (!details.tagId) {
    return nothingFound(
      'NETC recognises this vehicle but did not return a tag identifier, so there is nothing ' +
        'to record. Add the tag by hand from your issuer app.',
    );
  }

  // The same tag id already sitting on another vehicle in this fleet is a data
  // problem, not something to resolve silently — one of the two is wrong.
  const clash = await prisma.fastagAccount.findFirst({
    where: { organizationId, tagId: details.tagId, vehicleId: { not: vehicle.id } },
  });
  if (clash) {
    throw errors.duplicate(
      'NETC reports a tag that is already recorded against another vehicle in this fleet. ' +
        'Check which vehicle it belongs to before recording it again.',
      { fastagId: clash.id },
    );
  }

  const openTag = await prisma.fastagAccount.findFirst({
    where: { vehicleId: vehicle.id, closedAt: null },
  });
  const alreadyKnown = openTag?.tagId === details.tagId;

  const base = {
    provider: details.provider,
    registrationNumber,
    found: true,
    reason: null,
    alreadyKnown,
    issuerNamed: details.issuerBank !== null,
    balanceServed: details.balance !== null,
    retrievedAt: details.retrievedAt,
    simulated: details.simulated,
  } as const;

  // A dry run reports what NETC holds and writes nothing.
  if (!input.apply) {
    return {
      ...base,
      applied: false,
      replacedPreviousTag: false,
      crossingsImported: 0,
      coverageNote: null,
      fastag: openTag ? await getFastag(auth, openTag.id) : null,
    };
  }

  const fromProvider = {
    status: details.status,
    ...(details.vehicleClass ? { vehicleClass: details.vehicleClass } : {}),
    ...(details.issuerCode ? { issuerCode: details.issuerCode } : {}),
    ...(details.issuerBank ? { issuerBank: details.issuerBank } : {}),
    ...(details.issuedAt ? { issuedAt: new Date(details.issuedAt) } : {}),
    // Only written when the provider actually served one. Never defaulted.
    ...(details.balance !== null
      ? { balance: details.balance, balanceUpdatedAt: new Date(details.retrievedAt) }
      : {}),
    source: details.simulated ? TollDataSource.SIMULATED : TollDataSource.PROVIDER_SYNC,
    providerName: details.provider,
    lastSyncedAt: new Date(details.retrievedAt),
    lastSyncError: null,
  };

  let replacedPreviousTag = false;
  let fastagId: string;

  if (openTag && alreadyKnown) {
    // Saarthi already had this tag. Refresh it in place rather than adding a
    // second row for the same sticker.
    await prisma.fastagAccount.update({ where: { id: openTag.id }, data: fromProvider });
    fastagId = openTag.id;
  } else {
    if (openTag) {
      // NETC reports a different tag fitted to this vehicle. The old row is
      // closed rather than deleted, so a disputed crossing from last year still
      // resolves to the tag that paid for it.
      await prisma.fastagAccount.update({
        where: { id: openTag.id },
        data: {
          closedAt: new Date(),
          closeReason: 'NETC reports a different tag fitted to this vehicle.',
          status: FastagStatus.CLOSED,
        },
      });
      replacedPreviousTag = true;
    }

    const row = await prisma.fastagAccount.create({
      data: {
        organizationId,
        vehicleId: vehicle.id,
        tagId: details.tagId,
        issuerBank: issuerLabel(details),
        issuerCode: details.issuerCode,
        vehicleClass: details.vehicleClass,
        status: details.status,
        balance: details.balance,
        balanceUpdatedAt: details.balance === null ? null : new Date(details.retrievedAt),
        issuedAt: details.issuedAt ? new Date(details.issuedAt) : null,
        source: details.simulated ? TollDataSource.SIMULATED : TollDataSource.PROVIDER_SYNC,
        providerName: details.provider,
        lastSyncedAt: new Date(details.retrievedAt),
        createdById: auth.user.id,
      },
    });
    fastagId = row.id;
  }

  let crossingsImported = 0;
  let coverageNote: string | null = null;

  if (input.includeTransactions && fastagProvider.supportsTransactions) {
    const history = await fastagProvider.fetchTollHistory({
      registrationNumber,
      tagId: details.tagId,
    });
    coverageNote = history.coverageNote;
    crossingsImported = await importProviderCrossings(
      organizationId,
      vehicle.id,
      fastagId,
      history,
    );
  }

  // A tag that arrives already unusable is worth interrupting somebody for, but
  // only on first discovery — re-running this must never re-alarm a fleet about
  // a tag it has already been told about.
  if (!alreadyKnown && fastagBlocksTravel(details.status)) {
    await notifyOrganization(organizationId, {
      type: NotificationType.FASTAG_BLACKLISTED,
      title: `FASTag ${details.status.toLowerCase()} — ${registrationNumber}`,
      body:
        `The tag found on this vehicle is ${details.status.toLowerCase()} with its issuer. ` +
        'Toll will be charged at double the cash rate until it is cleared.',
      priority: NotificationPriority.CRITICAL,
      actionUrl: '/fleet/toll',
      roles: ['FLEET_OWNER', 'FLEET_MANAGER'],
    });
  }

  await recordAudit({
    action: AuditAction.FASTAG_DISCOVERED,
    entityType: 'FastagAccount',
    entityId: fastagId,
    actorUserId: auth.user.id,
    organizationId,
    // The tag id is never written to the audit trail in full.
    after: {
      vehicleId: vehicle.id,
      provider: details.provider,
      status: details.status,
      alreadyKnown,
      replacedPreviousTag,
      simulated: details.simulated,
    },
  });

  return {
    ...base,
    applied: true,
    replacedPreviousTag,
    crossingsImported,
    coverageNote,
    fastag: await getFastag(auth, fastagId),
  };
}

/**
 * Look for a tag on a newly added vehicle, without making anybody wait for it.
 *
 * Fire-and-forget on purpose, for three reasons that all point the same way:
 * adding a vehicle is a foreground action that must succeed whether or not a
 * third-party NETC service is reachable; every lookup is billed, so it runs
 * only for fleets whose plan includes the sync entitlement; and a failure here
 * is an optional enrichment nobody asked for, so it is logged and goes no
 * further rather than surfacing as an error on an unrelated screen.
 */
export function scheduleFastagDiscovery(auth: AuthContext, vehicleId: string): void {
  if (!fastagProvider.supportsLookup) return;
  if (!hasFeature(auth, Feature.TOLL_FASTAG)) return;
  if (!hasFeature(auth, Feature.TOLL_FASTAG_SYNC)) return;

  // The vehicle id is part of the job name on purpose. The distributed driver
  // takes a lock keyed on that name, so a single `fastag:discover` would mean
  // two vehicles added seconds apart suppress each other and one silently never
  // gets looked up. Per-vehicle keys also make a repeated add idempotent.
  queue.enqueue(`fastag:discover:${vehicleId}`, async () => {
    try {
      const result = await discoverFastag(auth, {
        vehicleId,
        apply: true,
        // One billed call, not two. The crossing feed is pulled when somebody
        // actually opens the tag.
        includeTransactions: false,
      });
      fastagLogger.info(
        { vehicleId, found: result.found, alreadyKnown: result.alreadyKnown },
        'FASTag discovery for a new vehicle complete',
      );
    } catch (error) {
      fastagLogger.warn({ err: error, vehicleId }, 'FASTag discovery for a new vehicle failed');
    }
  });
}

// ---------------------------------------------------------------------------
// Low balance sweep
// ---------------------------------------------------------------------------

/**
 * Warn fleets whose tags will not get them through the next plaza.
 *
 * Only tags with a *recorded* balance are evaluated. A tag nobody has reported
 * a balance for is not warned about, because "we do not know" is not a reason
 * to interrupt someone — it is a reason for the screen to say so.
 */
export async function runFastagBalanceSweep(): Promise<{ warned: number; blocked: number }> {
  const outcome = await withLock('jobs:fastag:balance-check', 5 * 60_000, async () => {
    const tags = await prisma.fastagAccount.findMany({
      where: { closedAt: null },
      take: 2000,
    });

    if (tags.length === 0) return { warned: 0, blocked: 0 };

    const labels = await vehicleLabels(tags.map((tag) => tag.vehicleId));
    const byOrganization = new Map<
      string,
      { low: string[]; blocked: string[] }
    >();

    for (const tag of tags) {
      const health = resolveFastagHealth({
        status: tag.status as FastagStatus,
        balance: num(tag.balance),
        balanceUpdatedAt: tag.balanceUpdatedAt,
        lowBalanceThreshold: num(tag.lowBalanceThreshold),
        expiresAt: tag.expiresAt,
      });

      if (health.health !== 'LOW_BALANCE' && health.health !== 'BLOCKED') continue;

      const bucket = byOrganization.get(tag.organizationId) ?? { low: [], blocked: [] };
      const registration = labels.get(tag.vehicleId) ?? 'A vehicle';
      if (health.health === 'BLOCKED') bucket.blocked.push(registration);
      else bucket.low.push(registration);
      byOrganization.set(tag.organizationId, bucket);
    }

    let warned = 0;
    let blocked = 0;

    for (const [organizationId, bucket] of byOrganization) {
      if (bucket.blocked.length > 0) {
        await notifyOrganization(organizationId, {
          type: NotificationType.FASTAG_BLACKLISTED,
          title: `${bucket.blocked.length} FASTag${bucket.blocked.length === 1 ? '' : 's'} blocked`,
          body: `${bucket.blocked.slice(0, 5).join(', ')} will be charged double at the next plaza.`,
          priority: NotificationPriority.CRITICAL,
          actionUrl: '/fleet/toll',
          roles: ['FLEET_OWNER', 'FLEET_MANAGER'],
        });
        blocked += bucket.blocked.length;
      }

      if (bucket.low.length > 0) {
        await notifyOrganization(organizationId, {
          type: NotificationType.FASTAG_LOW_BALANCE,
          title: `${bucket.low.length} FASTag${bucket.low.length === 1 ? '' : 's'} low on balance`,
          body: `${bucket.low.slice(0, 5).join(', ')} — roughly one more national plaza each.`,
          priority: NotificationPriority.HIGH,
          actionUrl: '/fleet/toll',
          roles: ['FLEET_OWNER', 'FLEET_MANAGER'],
        });
        warned += bucket.low.length;
      }
    }

    fastagLogger.info({ warned, blocked, examined: tags.length }, 'FASTag balance sweep complete');
    return { warned, blocked };
  });

  return outcome ?? { warned: 0, blocked: 0 };
}
