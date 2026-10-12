import {
  ACTIVE_TRIP_STATUSES,
  ExpenseCategory,
  MediaOwnerType,
  buildPaginationMeta,
  type ExpenseListQuery,
  type TripStatus,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { skipTake } from '../../lib/http';
import type { AuthContext } from '../../auth/context';

/**
 * Road expenses — the slips a driver pays and photographs that are not fuel.
 *
 * Each slip belongs to the dispatched trip the vehicle was on when it was paid,
 * so it lands in that trip's expenses; one paid between trips stays on the
 * vehicle alone. A service run to a pump is not a trip anyone prices, so it is
 * never the trip a slip is filed against.
 */

/** The dispatched trip a slip paid right now belongs to, if one is open. */
export async function tripForSlip(vehicleId: string): Promise<string | null> {
  const truck = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: { currentTripId: true },
  });
  if (!truck?.currentTripId) return null;

  const trip = await prisma.trip.findUnique({
    where: { id: truck.currentTripId },
    select: { id: true, adHoc: true, status: true },
  });
  if (!trip || trip.adHoc || !ACTIVE_TRIP_STATUSES.includes(trip.status as TripStatus)) return null;
  return trip.id;
}

export interface ExpenseSlipInput {
  organizationId: string;
  vehicleId: string;
  driverId: string | null;
  createdById: string | null;
  category: ExpenseCategory;
  amount: number;
  vendorName: string | null;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
}

export async function recordExpense(input: ExpenseSlipInput): Promise<{ id: string }> {
  return prisma.expense.create({
    data: {
      organizationId: input.organizationId,
      truckId: input.vehicleId,
      tripId: await tripForSlip(input.vehicleId),
      driverId: input.driverId,
      createdById: input.createdById,
      category: input.category,
      amount: input.amount,
      vendorName: input.vendorName,
      notes: input.notes,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    select: { id: true },
  });
}

/** Undo a slip whose photograph could not be stored, so no slip lacks its evidence. */
export async function discardExpense(id: string): Promise<void> {
  await prisma.expense.deleteMany({ where: { id } });
}

export interface TripExpenseTotals {
  total: number;
  toll: number;
}

/** Slip totals per trip, in one grouped read for any number of trips. */
export async function expenseTotalsByTrip(
  tripIds: readonly string[],
): Promise<Map<string, TripExpenseTotals>> {
  const totals = new Map<string, TripExpenseTotals>();
  if (tripIds.length === 0) return totals;

  const groups = await prisma.expense.groupBy({
    by: ['tripId', 'category'],
    where: { tripId: { in: [...tripIds] } },
    _sum: { amount: true },
  });

  for (const group of groups) {
    if (!group.tripId) continue;
    const amount = Number(group._sum.amount ?? 0);
    const entry = totals.get(group.tripId) ?? { total: 0, toll: 0 };
    entry.total += amount;
    if (group.category === ExpenseCategory.TOLL) entry.toll += amount;
    totals.set(group.tripId, entry);
  }
  return totals;
}

export interface ExpenseListItem {
  id: string;
  truckId: string;
  registrationNumber: string;
  tripId: string | null;
  tripReference: string | null;
  driverId: string | null;
  driverName: string | null;
  category: ExpenseCategory;
  amount: number;
  vendorName: string | null;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  recordedAt: string;
  /** The slip's photograph, servable from `/media/:id/file`. */
  photoId: string | null;
}

export async function listExpenses(
  auth: AuthContext,
  organizationId: string,
  query: ExpenseListQuery,
) {
  const where: Prisma.ExpenseWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId ? {} : { organizationId }),
    ...(query.truckId ? { truckId: query.truckId } : {}),
    ...(query.tripId ? { tripId: query.tripId } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.from || query.to
      ? {
          recordedAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [total, records, byCategory] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      ...skipTake(query.page, query.pageSize),
      include: { truck: { select: { registrationNumber: true } } },
    }),
    prisma.expense.groupBy({ by: ['category'], where, _sum: { amount: true } }),
  ]);

  const ids = records.map((record) => record.id);
  const tripIds = [...new Set(records.map((record) => record.tripId).filter((id): id is string => !!id))];
  const driverIds = [
    ...new Set(records.map((record) => record.driverId).filter((id): id is string => !!id)),
  ];

  const [photos, trips, drivers] = await Promise.all([
    ids.length > 0
      ? prisma.mediaAsset.findMany({
          where: { ownerType: MediaOwnerType.EXPENSE, ownerId: { in: ids }, deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, ownerId: true },
        })
      : Promise.resolve([]),
    tripIds.length > 0
      ? prisma.trip.findMany({ where: { id: { in: tripIds } }, select: { id: true, reference: true } })
      : Promise.resolve([]),
    driverIds.length > 0
      ? prisma.driver.findMany({
          where: { id: { in: driverIds } },
          select: { id: true, user: { select: { firstName: true, lastName: true } } },
        })
      : Promise.resolve([]),
  ]);

  const photoByExpense = new Map<string, string>();
  for (const photo of photos) {
    if (!photoByExpense.has(photo.ownerId)) photoByExpense.set(photo.ownerId, photo.id);
  }
  const tripReference = new Map(trips.map((trip) => [trip.id, trip.reference]));
  const driverName = new Map(
    drivers.map((driver) => [driver.id, `${driver.user.firstName} ${driver.user.lastName}`.trim()]),
  );

  const items: ExpenseListItem[] = records.map((record) => ({
    id: record.id,
    truckId: record.truckId,
    registrationNumber: record.truck.registrationNumber,
    tripId: record.tripId,
    tripReference: record.tripId ? (tripReference.get(record.tripId) ?? null) : null,
    driverId: record.driverId,
    driverName: record.driverId ? (driverName.get(record.driverId) ?? null) : null,
    category: record.category as ExpenseCategory,
    amount: Number(record.amount),
    vendorName: record.vendorName,
    notes: record.notes,
    latitude: record.latitude,
    longitude: record.longitude,
    recordedAt: record.recordedAt.toISOString(),
    photoId: photoByExpense.get(record.id) ?? null,
  }));

  return {
    items,
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
    totals: {
      amount: byCategory.reduce((sum, group) => sum + Number(group._sum.amount ?? 0), 0),
      byCategory: Object.fromEntries(
        byCategory.map((group) => [group.category, Number(group._sum.amount ?? 0)]),
      ) as Partial<Record<ExpenseCategory, number>>,
    },
  };
}
