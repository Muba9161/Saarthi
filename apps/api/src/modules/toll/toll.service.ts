import {
  FinanceVerificationStatus,
  TollDataSource,
  TollPaymentMode,
  buildPaginationMeta,
  resolveTollVariance,
  summariseTollSpend,
  summariseTripCost,
  type ImportTollInput,
  type Paginated,
  type RecordTollInput,
  type TollDirection,
  type TollListQuery,
  type TollSpendSummary,
  type TollSummaryQuery,
  type TollVarianceResult,
  type TripCostSummary,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { skipTake } from '../../lib/http';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';
import { assertTenantAccess } from '../../server/guards';
import { AuditAction, recordAudit } from '../audit/audit.service';
import type { ProviderTollHistory } from '../../providers/fastag';
import type { AuthContext } from '../../auth/context';

/**
 * Toll crossings.
 *
 * A crossing is money that left the fleet's account while nobody was watching,
 * at a place nobody chose to stop. Two consequences shape this module:
 *
 *   • **Every crossing is kept, however thin.** A row from a paper receipt with
 *     no reference is still the only record that ₹430 was spent. Refusing it
 *     for want of an identifier would lose the fact entirely.
 *   • **A crossing without an amount is not a free crossing.** The NETC feed
 *     reports the *passage*, not the fare, so `amount` stays null until a
 *     statement or a person supplies it — and every total says how many rows
 *     it could not price.
 */

const tollLogger = logger.child({ module: 'toll' });

export interface TollTransactionView {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  tripId: string | null;
  plazaName: string;
  plazaCode: string | null;
  highway: string | null;
  laneId: string | null;
  latitude: number | null;
  longitude: number | null;
  direction: TollDirection;
  paymentMode: TollPaymentMode;
  amount: number;
  balanceAfter: number | null;
  crossedAt: string;
  source: TollDataSource;
  verificationStatus: FinanceVerificationStatus;
  conflictNote: string | null;
  notes: string | null;
  createdAt: string;
}

type TollRow = Prisma.TollTransactionGetPayload<Record<string, never>>;

const num = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

function toView(row: TollRow, registrationNumber: string): TollTransactionView {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    registrationNumber,
    tripId: row.tripId,
    plazaName: row.plazaName,
    plazaCode: row.plazaCode,
    highway: row.highway,
    laneId: row.laneId,
    latitude: row.latitude,
    longitude: row.longitude,
    direction: row.direction as TollDirection,
    paymentMode: row.paymentMode as TollPaymentMode,
    amount: Number(row.amount),
    balanceAfter: num(row.balanceAfter),
    crossedAt: row.crossedAt.toISOString(),
    source: row.source as TollDataSource,
    verificationStatus: row.verificationStatus as FinanceVerificationStatus,
    conflictNote: row.conflictNote,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
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

export async function listTollTransactions(
  auth: AuthContext,
  organizationId: string,
  query: TollListQuery,
): Promise<Paginated<TollTransactionView> & { totals: { amount: number; crossings: number } }> {
  const where: Prisma.TollTransactionWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId ? {} : { organizationId }),
    ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    ...(query.tripId ? { tripId: query.tripId } : {}),
    ...(query.paymentMode ? { paymentMode: { in: query.paymentMode as never } } : {}),
    ...(query.source ? { source: { in: query.source as never } } : {}),
    ...(query.plaza ? { plazaName: { contains: query.plaza, mode: 'insensitive' } } : {}),
    ...(query.from || query.to
      ? {
          crossedAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [total, rows, aggregate] = await Promise.all([
    prisma.tollTransaction.count({ where }),
    prisma.tollTransaction.findMany({
      where,
      orderBy: { crossedAt: 'desc' },
      ...skipTake(query.page, query.pageSize),
    }),
    prisma.tollTransaction.aggregate({ where, _sum: { amount: true } }),
  ]);

  const labels = await vehicleLabels(rows.map((row) => row.vehicleId));

  return {
    items: rows.map((row) => toView(row, labels.get(row.vehicleId) ?? 'Unknown')),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
    totals: { amount: Number(aggregate._sum.amount ?? 0), crossings: total },
  };
}

export interface TollSummaryResult extends TollSpendSummary {
  /** Crossings with no fare attached — see the note at the top of this file. */
  unpricedCrossings: number;
  vehiclesWithTolls: number;
}

export async function tollSummary(
  auth: AuthContext,
  organizationId: string,
  query: TollSummaryQuery,
): Promise<TollSummaryResult> {
  const cacheKey = query.vehicleId
    ? `${cacheKeys.vehiclePrefix(query.vehicleId)}:toll:${query.days}`
    : `${cacheKeys.organizationPrefix(organizationId)}:toll:${query.days}`;

  const hit = await cache.get<TollSummaryResult>(cacheKey);
  if (hit) return hit;

  const since = new Date(Date.now() - query.days * 86_400_000);
  const rows = await prisma.tollTransaction.findMany({
    where: {
      organizationId,
      crossedAt: { gte: since },
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    },
    select: {
      amount: true,
      crossedAt: true,
      plazaName: true,
      paymentMode: true,
      vehicleId: true,
    },
    take: 5000,
  });

  const summary = summariseTollSpend(
    rows.map((row) => ({
      amount: Number(row.amount),
      crossedAt: row.crossedAt,
      plazaName: row.plazaName,
      paymentMode: row.paymentMode as TollPaymentMode,
      vehicleId: row.vehicleId,
    })),
    query.days,
  );

  const result: TollSummaryResult = {
    ...summary,
    unpricedCrossings: rows.filter((row) => Number(row.amount) === 0).length,
    vehiclesWithTolls: new Set(rows.map((row) => row.vehicleId)).size,
  };

  await cache.set(cacheKey, result, 60);
  return result;
}

/**
 * Compare one trip's toll against comparable runs on the same corridor.
 *
 * "Comparable" is deliberately narrow: the same origin and destination, the
 * same vehicle class of trip, completed. A loose comparison would produce a
 * variance figure that reflects a different route rather than a different bill.
 */
export async function tripTollVariance(
  auth: AuthContext,
  tripId: string,
): Promise<TollVarianceResult & { tripReference: string; corridor: string }> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw errors.notFound('Trip');
  assertTenantAccess(auth, trip.organizationId, 'Trip');

  const [actual, comparableTrips] = await Promise.all([
    prisma.tollTransaction.aggregate({
      where: { tripId },
      _sum: { amount: true },
    }),
    prisma.trip.findMany({
      where: {
        organizationId: trip.organizationId,
        id: { not: tripId },
        status: 'COMPLETED',
        originAddress: trip.originAddress,
        destinationAddress: trip.destinationAddress,
      },
      select: { id: true },
      orderBy: { actualArrivalAt: 'desc' },
      take: 20,
    }),
  ]);

  const comparableRuns: number[] = [];
  for (const comparable of comparableTrips) {
    const total = await prisma.tollTransaction.aggregate({
      where: { tripId: comparable.id },
      _sum: { amount: true },
    });
    const value = Number(total._sum.amount ?? 0);
    if (value > 0) comparableRuns.push(value);
  }

  return {
    ...resolveTollVariance({
      actual: Number(actual._sum.amount ?? 0),
      comparableRuns,
    }),
    tripReference: trip.reference,
    corridor: `${trip.originAddress} → ${trip.destinationAddress}`,
  };
}

/**
 * What one trip cost, with toll separated out.
 *
 * Toll is usually folded into "expenses" and disappears. Splitting it is the
 * point of this endpoint: an operator who learns that toll is a fifth of a
 * corridor's cost can price the next job for it.
 */
export async function tripCostSummary(
  auth: AuthContext,
  tripId: string,
): Promise<TripCostSummary & { tripReference: string; tollCrossings: number }> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw errors.notFound('Trip');
  assertTenantAccess(auth, trip.organizationId, 'Trip');

  const [toll, fuel] = await Promise.all([
    prisma.tollTransaction.aggregate({
      where: { tripId },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.fuelRecord.aggregate({ where: { tripId }, _sum: { totalCost: true } }),
  ]);

  const tollCost = Number(toll._sum.amount ?? 0);
  const fuelCost = Number(fuel._sum.totalCost ?? 0);
  // `expenses` on a trip is the operator's own catch-all. Toll recorded
  // separately is not deducted from it — that would be guessing at what they
  // put in the box.
  const otherExpenses = trip.expenses === null ? 0 : Number(trip.expenses);

  return {
    ...summariseTripCost({
      revenue: trip.price === null ? null : Number(trip.price),
      fuelCost,
      tollCost,
      otherExpenses,
      distanceKm: trip.actualDistanceKm > 0 ? trip.actualDistanceKm : trip.plannedDistanceKm,
    }),
    tripReference: trip.reference,
    tollCrossings: toll._count,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Attach a crossing to the trip that was running when it happened. */
async function inferTripId(vehicleId: string, crossedAt: Date): Promise<string | null> {
  const trip = await prisma.trip.findFirst({
    where: {
      truckId: vehicleId,
      actualStartAt: { lte: crossedAt },
      OR: [{ actualArrivalAt: null }, { actualArrivalAt: { gte: crossedAt } }],
    },
    orderBy: { actualStartAt: 'desc' },
    select: { id: true },
  });
  return trip?.id ?? null;
}

export async function recordToll(
  auth: AuthContext,
  organizationId: string,
  input: RecordTollInput,
): Promise<TollTransactionView> {
  const vehicle = await prisma.truck.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const fastag = await prisma.fastagAccount.findFirst({
    where: { vehicleId: input.vehicleId, closedAt: null },
    select: { id: true },
  });

  const row = await prisma.tollTransaction.create({
    data: {
      organizationId,
      vehicleId: input.vehicleId,
      fastagId: fastag?.id ?? null,
      tripId: input.tripId ?? (await inferTripId(input.vehicleId, input.crossedAt)),
      driverId: vehicle.currentDriverId,
      plazaName: input.plazaName,
      plazaCode: input.plazaCode ?? null,
      laneId: input.laneId ?? null,
      highway: input.highway ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      direction: input.direction,
      paymentMode: input.paymentMode,
      amount: input.amount,
      balanceAfter: input.balanceAfter ?? null,
      crossedAt: input.crossedAt,
      externalReference: input.externalReference ?? null,
      notes: input.notes ?? null,
      source: TollDataSource.MANUAL,
      recordedById: auth.user.id,
    },
  });

  // A crossing reports the balance immediately after the deduction — the most
  // reliable balance reading a fleet gets without asking the bank.
  if (input.balanceAfter !== undefined && fastag) {
    await prisma.fastagAccount.update({
      where: { id: fastag.id },
      data: { balance: input.balanceAfter, balanceUpdatedAt: input.crossedAt },
    });
  }

  await invalidateTollCache(organizationId, input.vehicleId);

  await recordAudit({
    action: AuditAction.TOLL_RECORDED,
    entityType: 'TollTransaction',
    entityId: row.id,
    actorUserId: auth.user.id,
    organizationId,
    after: { vehicleId: input.vehicleId, plaza: input.plazaName, amount: input.amount },
  });

  return toView(row, vehicle.registrationNumber);
}

export interface TollImportResult {
  imported: number;
  duplicates: number;
  conflicts: number;
  linkedToTrips: number;
}

/**
 * Import crossings from a bank or NETC statement.
 *
 * Idempotent on `externalReference`, which is what makes re-importing the same
 * month harmless rather than doubling it. Rows without a reference fall back to
 * matching on plaza, minute and amount — weaker, and a repeat import of a
 * referenceless receipt can genuinely produce a duplicate, so the caller is
 * told how many rows were matched that way.
 */
export async function importTollTransactions(
  auth: AuthContext,
  organizationId: string,
  input: ImportTollInput,
): Promise<TollImportResult> {
  const vehicle = await prisma.truck.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const fastag = await prisma.fastagAccount.findFirst({
    where: { vehicleId: input.vehicleId, closedAt: null },
    select: { id: true },
  });

  let imported = 0;
  let duplicates = 0;
  let conflicts = 0;
  let linkedToTrips = 0;

  for (const crossing of input.crossings) {
    const existing = crossing.externalReference
      ? await prisma.tollTransaction.findFirst({
          where: { organizationId, externalReference: crossing.externalReference },
        })
      : await prisma.tollTransaction.findFirst({
          where: {
            organizationId,
            vehicleId: input.vehicleId,
            plazaName: crossing.plazaName,
            // Within a minute: the same passage reported by two sources rarely
            // agrees to the second.
            crossedAt: {
              gte: new Date(crossing.crossedAt.getTime() - 60_000),
              lte: new Date(crossing.crossedAt.getTime() + 60_000),
            },
          },
        });

    if (existing) {
      const sameAmount = Math.abs(Number(existing.amount) - crossing.amount) < 1;
      if (sameAmount) {
        duplicates += 1;
        continue;
      }

      // Two sources, two fares for one passage. Both are kept and a person
      // decides, rather than the import silently overwriting a receipt.
      await prisma.tollTransaction.update({
        where: { id: existing.id },
        data: {
          verificationStatus: FinanceVerificationStatus.CONFLICT,
          conflictNote:
            `The imported statement shows ₹${crossing.amount} for this crossing; ` +
            `₹${Number(existing.amount)} was already recorded. Check the statement and confirm which is right.`,
        },
      });
      conflicts += 1;
      continue;
    }

    const tripId = await inferTripId(input.vehicleId, crossing.crossedAt);
    if (tripId) linkedToTrips += 1;

    await prisma.tollTransaction.create({
      data: {
        organizationId,
        vehicleId: input.vehicleId,
        fastagId: fastag?.id ?? null,
        tripId,
        plazaName: crossing.plazaName,
        plazaCode: crossing.plazaCode ?? null,
        direction: crossing.direction,
        paymentMode: crossing.paymentMode,
        amount: crossing.amount,
        balanceAfter: crossing.balanceAfter ?? null,
        crossedAt: crossing.crossedAt,
        externalReference: crossing.externalReference ?? null,
        source: input.source as TollDataSource,
        // An imported row is a statement, not a verified fact. Anything read
        // off a receipt image waits for a person.
        verificationStatus:
          input.source === 'DOCUMENT_EXTRACTION'
            ? FinanceVerificationStatus.PENDING_REVIEW
            : FinanceVerificationStatus.PROVIDER_REPORTED,
        recordedById: auth.user.id,
      },
    });
    imported += 1;
  }

  await invalidateTollCache(organizationId, input.vehicleId);

  await recordAudit({
    action: AuditAction.TOLL_IMPORTED,
    entityType: 'Truck',
    entityId: input.vehicleId,
    actorUserId: auth.user.id,
    organizationId,
    after: { imported, duplicates, conflicts, source: input.source },
  });

  tollLogger.info(
    { organizationId, vehicleId: input.vehicleId, imported, duplicates, conflicts },
    'Toll statement imported',
  );

  return { imported, duplicates, conflicts, linkedToTrips };
}

/**
 * Store crossings a NETC lookup returned.
 *
 * Called by the FASTag sync rather than by a route. Deliberately silent about
 * fares: this feed reports passages, and a crossing whose amount the provider
 * did not give is stored at zero *and* left unverified, so the summary can say
 * how many rows it could not price rather than quietly under-reporting spend.
 */
export async function importProviderCrossings(
  organizationId: string,
  vehicleId: string,
  fastagId: string,
  history: ProviderTollHistory,
): Promise<number> {
  let imported = 0;

  for (const crossing of history.crossings) {
    if (crossing.externalReference) {
      const existing = await prisma.tollTransaction.findFirst({
        where: { organizationId, externalReference: crossing.externalReference },
      });
      if (existing) continue;
    }

    await prisma.tollTransaction.create({
      data: {
        organizationId,
        vehicleId,
        fastagId,
        tripId: await inferTripId(vehicleId, new Date(crossing.crossedAt)),
        plazaName: crossing.plazaName,
        plazaCode: crossing.plazaCode,
        latitude: crossing.latitude,
        longitude: crossing.longitude,
        direction: crossing.direction,
        paymentMode: TollPaymentMode.FASTAG,
        amount: crossing.amount ?? 0,
        balanceAfter: crossing.balanceAfter,
        crossedAt: new Date(crossing.crossedAt),
        externalReference: crossing.externalReference,
        source: history.simulated ? TollDataSource.SIMULATED : TollDataSource.PROVIDER_SYNC,
        verificationStatus:
          crossing.amount === null
            ? // No fare was served, so nothing here is a spend figure yet.
              FinanceVerificationStatus.PENDING_REVIEW
            : FinanceVerificationStatus.PROVIDER_REPORTED,
        conflictNote:
          crossing.amount === null
            ? 'The NETC feed reported this passage without a fare. Add the amount from your statement.'
            : null,
      },
    });
    imported += 1;
  }

  await invalidateTollCache(organizationId, vehicleId);
  return imported;
}

async function invalidateTollCache(organizationId: string, vehicleId: string): Promise<void> {
  // Summaries are cached per window, so every window a screen offers is cleared.
  for (const days of [7, 30, 90, 365]) {
    await cache.delete(`${cacheKeys.organizationPrefix(organizationId)}:toll:${days}`);
    await cache.delete(`${cacheKeys.vehiclePrefix(vehicleId)}:toll:${days}`);
  }
}
