import {
  MaintenanceStatus,
  NotificationPriority,
  NotificationType,
  OPERATOR_MANAGEMENT_ROLES,
  TruckStatus,
  buildPaginationMeta,
  type CreateFuelRecordInput,
  type CreateMaintenanceInput,
  type MaintenanceListQuery,
  type Paginated,
  type UpdateMaintenanceInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { assertTenantAccess } from '../../server/guards';
import { notifyOrganization } from '../notifications/notification.service';
import type { AuthContext } from '../../auth/context';

/**
 * Maintenance and fuel records.
 *
 * Risk scoring is deliberately rule-based here: mileage since last service,
 * overdue schedules and recent breakdown frequency. Anything predictive lives
 * in the AI layer and is clearly labelled as a prediction, never mixed in with
 * these recorded facts.
 */

export interface MaintenanceSummary {
  id: string;
  truckId: string;
  registrationNumber: string;
  type: string;
  title: string;
  description: string | null;
  odometerKm: number | null;
  cost: number | null;
  status: MaintenanceStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  serviceProvider: string | null;
  nextDueAt: string | null;
  nextDueOdometerKm: number | null;
  overdue: boolean;
  createdAt: string;
}

type MaintenanceRecord = Prisma.MaintenanceRecordGetPayload<Record<string, never>>;

function toSummary(record: MaintenanceRecord, registrationNumber: string): MaintenanceSummary {
  const overdue =
    record.status === MaintenanceStatus.SCHEDULED &&
    record.scheduledAt !== null &&
    record.scheduledAt.getTime() < Date.now();

  return {
    id: record.id,
    truckId: record.truckId,
    registrationNumber,
    type: record.type,
    title: record.title,
    description: record.description,
    odometerKm: record.odometerKm,
    cost: record.cost ? Number(record.cost) : null,
    status: record.status,
    scheduledAt: record.scheduledAt?.toISOString() ?? null,
    startedAt: record.startedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    serviceProvider: record.serviceProvider,
    nextDueAt: record.nextDueAt?.toISOString() ?? null,
    nextDueOdometerKm: record.nextDueOdometerKm,
    overdue,
    createdAt: record.createdAt.toISOString(),
  };
}

async function truckLabels(truckIds: string[]): Promise<Map<string, string>> {
  const trucks = await prisma.truck.findMany({
    where: { id: { in: truckIds } },
    select: { id: true, registrationNumber: true },
  });
  return new Map(trucks.map((truck) => [truck.id, truck.registrationNumber]));
}

export async function listMaintenance(
  auth: AuthContext,
  organizationId: string,
  query: MaintenanceListQuery,
): Promise<Paginated<MaintenanceSummary>> {
  const where: Prisma.MaintenanceRecordWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId ? {} : { organizationId }),
    ...(query.truckId ? { truckId: query.truckId } : {}),
    ...(query.status ? { status: { in: query.status as MaintenanceStatus[] } } : {}),
    ...(query.type ? { type: { in: query.type as never } } : {}),
    ...(query.overdueOnly
      ? { status: MaintenanceStatus.SCHEDULED, scheduledAt: { lt: new Date() } }
      : {}),
  };

  const [total, records] = await Promise.all([
    prisma.maintenanceRecord.count({ where }),
    prisma.maintenanceRecord.findMany({
      where,
      orderBy: [{ status: 'asc' }, { scheduledAt: 'asc' }, { createdAt: 'desc' }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const labels = await truckLabels(records.map((record) => record.truckId));

  return {
    items: records.map((record) => toSummary(record, labels.get(record.truckId) ?? 'Unknown')),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function createMaintenance(
  auth: AuthContext,
  organizationId: string,
  input: CreateMaintenanceInput,
): Promise<MaintenanceSummary> {
  const truck = await prisma.truck.findUnique({ where: { id: input.truckId } });
  if (!truck) throw errors.notFound('Truck');
  assertTenantAccess(auth, truck.organizationId, 'Truck');

  const record = await prisma.maintenanceRecord.create({
    data: {
      truckId: input.truckId,
      organizationId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      odometerKm: input.odometerKm ?? truck.odometerKm,
      cost: input.cost ?? null,
      status: MaintenanceStatus.SCHEDULED,
      scheduledAt: input.scheduledAt ?? null,
      serviceProvider: input.serviceProvider ?? null,
      nextDueOdometerKm: input.nextDueOdometerKm ?? null,
      nextDueAt: input.nextDueAt ?? null,
      createdById: auth.user.id,
    },
  });

  return toSummary(record, truck.registrationNumber);
}

export async function updateMaintenance(
  auth: AuthContext,
  recordId: string,
  input: UpdateMaintenanceInput,
): Promise<MaintenanceSummary> {
  const record = await prisma.maintenanceRecord.findUnique({ where: { id: recordId } });
  if (!record) throw errors.notFound('Maintenance record');
  assertTenantAccess(auth, record.organizationId, 'Maintenance record');

  const truck = await prisma.truck.findUniqueOrThrow({ where: { id: record.truckId } });

  const startingWork = input.status === MaintenanceStatus.IN_PROGRESS;
  const finishingWork = input.status === MaintenanceStatus.COMPLETED;

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.maintenanceRecord.update({
      where: { id: recordId },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
        ...(input.cost !== undefined ? { cost: input.cost } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}),
        ...(input.serviceProvider !== undefined ? { serviceProvider: input.serviceProvider } : {}),
        ...(input.nextDueAt !== undefined ? { nextDueAt: input.nextDueAt } : {}),
        ...(input.nextDueOdometerKm !== undefined
          ? { nextDueOdometerKm: input.nextDueOdometerKm }
          : {}),
        ...(startingWork ? { startedAt: input.startedAt ?? new Date() } : {}),
        ...(finishingWork ? { completedAt: input.completedAt ?? new Date() } : {}),
      },
    });

    // A truck in the workshop is not available for dispatch.
    if (startingWork && !truck.currentTripId) {
      await tx.truck.update({
        where: { id: truck.id },
        data: { status: TruckStatus.MAINTENANCE },
      });
    }
    if (finishingWork && truck.status === TruckStatus.MAINTENANCE) {
      await tx.truck.update({
        where: { id: truck.id },
        data: { status: truck.currentDriverId ? TruckStatus.ASSIGNED : TruckStatus.AVAILABLE },
      });
    }

    return next;
  });

  return toSummary(updated, truck.registrationNumber);
}

export async function truckMaintenanceHistory(auth: AuthContext, truckId: string) {
  const truck = await prisma.truck.findUnique({ where: { id: truckId } });
  if (!truck) throw errors.notFound('Truck');
  assertTenantAccess(auth, truck.organizationId, 'Truck');

  const records = await prisma.maintenanceRecord.findMany({
    where: { truckId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return records.map((record) => toSummary(record, truck.registrationNumber));
}

// ---------------------------------------------------------------------------
// Fuel
// ---------------------------------------------------------------------------

export async function recordFuel(
  auth: AuthContext,
  organizationId: string,
  input: CreateFuelRecordInput,
) {
  const truck = await prisma.truck.findUnique({ where: { id: input.truckId } });
  if (!truck) throw errors.notFound('Truck');
  assertTenantAccess(auth, truck.organizationId, 'Truck');

  const totalCost = Number((input.quantityLitres * input.pricePerUnit).toFixed(2));

  const record = await prisma.fuelRecord.create({
    data: {
      truckId: input.truckId,
      organizationId,
      tripId: input.tripId ?? truck.currentTripId,
      driverId: truck.currentDriverId,
      quantityLitres: input.quantityLitres,
      pricePerUnit: input.pricePerUnit,
      totalCost,
      odometerKm: input.odometerKm ?? truck.odometerKm,
      stationName: input.stationName ?? null,
      latitude: input.latitude ?? truck.lastLatitude,
      longitude: input.longitude ?? truck.lastLongitude,
      recordedAt: input.recordedAt ?? new Date(),
      createdById: auth.user.id,
    },
  });

  // A fill-up is the most reliable odometer reading a fleet gets.
  if (input.odometerKm && input.odometerKm > truck.odometerKm) {
    await prisma.truck.update({
      where: { id: truck.id },
      data: { odometerKm: input.odometerKm },
    });
  }

  return {
    id: record.id,
    truckId: record.truckId,
    registrationNumber: truck.registrationNumber,
    quantityLitres: record.quantityLitres,
    pricePerUnit: Number(record.pricePerUnit),
    totalCost: Number(record.totalCost),
    odometerKm: record.odometerKm,
    stationName: record.stationName,
    recordedAt: record.recordedAt.toISOString(),
  };
}

export async function listFuelRecords(
  auth: AuthContext,
  organizationId: string,
  query: { page: number; pageSize: number; truckId?: string; driverId?: string; from?: Date; to?: Date },
) {
  const where: Prisma.FuelRecordWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId ? {} : { organizationId }),
    ...(query.truckId ? { truckId: query.truckId } : {}),
    ...(query.driverId ? { driverId: query.driverId } : {}),
    ...(query.from || query.to
      ? {
          recordedAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [total, records, aggregate] = await Promise.all([
    prisma.fuelRecord.count({ where }),
    prisma.fuelRecord.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      ...skipTake(query.page, query.pageSize),
    }),
    prisma.fuelRecord.aggregate({
      where,
      _sum: { quantityLitres: true, totalCost: true },
      _avg: { pricePerUnit: true },
    }),
  ]);

  const labels = await truckLabels(records.map((record) => record.truckId));

  return {
    items: records.map((record) => ({
      id: record.id,
      truckId: record.truckId,
      registrationNumber: labels.get(record.truckId) ?? 'Unknown',
      quantityLitres: record.quantityLitres,
      pricePerUnit: Number(record.pricePerUnit),
      totalCost: Number(record.totalCost),
      odometerKm: record.odometerKm,
      stationName: record.stationName,
      recordedAt: record.recordedAt.toISOString(),
    })),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
    totals: {
      litres: aggregate._sum.quantityLitres ?? 0,
      cost: Number(aggregate._sum.totalCost ?? 0),
      averagePricePerLitre: Number(aggregate._avg.pricePerUnit ?? 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Rule-based maintenance risk
// ---------------------------------------------------------------------------

export interface MaintenanceRisk {
  truckId: string;
  registrationNumber: string;
  /** 0–100; higher means more attention needed. */
  riskScore: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  odometerKm: number;
  kmSinceLastService: number | null;
  daysSinceLastService: number | null;
  overdueCount: number;
  reasons: string[];
  /** Everything here is a recorded fact or a rule, never a prediction. */
  basis: 'calculated';
}

const SERVICE_INTERVAL_KM = 15_000;
const SERVICE_INTERVAL_DAYS = 120;

export async function maintenanceRisk(organizationId: string): Promise<MaintenanceRisk[]> {
  const trucks = await prisma.truck.findMany({
    where: { organizationId, archivedAt: null },
    select: { id: true, registrationNumber: true, odometerKm: true },
  });

  const results: MaintenanceRisk[] = [];

  for (const truck of trucks) {
    const [lastService, overdueCount, recentRepairs] = await Promise.all([
      prisma.maintenanceRecord.findFirst({
        where: { truckId: truck.id, status: MaintenanceStatus.COMPLETED },
        orderBy: { completedAt: 'desc' },
      }),
      prisma.maintenanceRecord.count({
        where: {
          truckId: truck.id,
          status: MaintenanceStatus.SCHEDULED,
          scheduledAt: { lt: new Date() },
        },
      }),
      prisma.maintenanceRecord.count({
        where: {
          truckId: truck.id,
          type: 'REPAIR',
          createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
        },
      }),
    ]);

    const kmSinceLastService =
      lastService?.odometerKm !== null && lastService?.odometerKm !== undefined
        ? Math.max(0, truck.odometerKm - lastService.odometerKm)
        : null;
    const daysSinceLastService = lastService?.completedAt
      ? Math.round((Date.now() - lastService.completedAt.getTime()) / 86_400_000)
      : null;

    const reasons: string[] = [];
    let score = 0;

    if (kmSinceLastService === null) {
      score += 25;
      reasons.push('No completed service on record for this vehicle.');
    } else if (kmSinceLastService > SERVICE_INTERVAL_KM) {
      const over = kmSinceLastService - SERVICE_INTERVAL_KM;
      score += Math.min(40, 20 + over / 1000);
      reasons.push(
        `${Math.round(kmSinceLastService).toLocaleString('en-IN')} km since the last service (interval ${SERVICE_INTERVAL_KM.toLocaleString('en-IN')} km).`,
      );
    }

    if (daysSinceLastService !== null && daysSinceLastService > SERVICE_INTERVAL_DAYS) {
      score += Math.min(25, 10 + (daysSinceLastService - SERVICE_INTERVAL_DAYS) / 10);
      reasons.push(`${daysSinceLastService} days since the last service.`);
    }

    if (overdueCount > 0) {
      score += overdueCount * 15;
      reasons.push(`${overdueCount} scheduled job(s) past their due date.`);
    }

    if (recentRepairs >= 2) {
      score += recentRepairs * 8;
      reasons.push(`${recentRepairs} repairs raised in the last 90 days.`);
    }

    const riskScore = Math.min(100, Math.round(score));
    results.push({
      truckId: truck.id,
      registrationNumber: truck.registrationNumber,
      riskScore,
      level: riskScore >= 60 ? 'HIGH' : riskScore >= 30 ? 'MEDIUM' : 'LOW',
      odometerKm: Math.round(truck.odometerKm),
      kmSinceLastService: kmSinceLastService === null ? null : Math.round(kmSinceLastService),
      daysSinceLastService,
      overdueCount,
      reasons,
      basis: 'calculated',
    });
  }

  return results.sort((a, b) => b.riskScore - a.riskScore);
}

/** Background job: raise reminders for overdue and imminent maintenance. */
export async function runMaintenanceReminderSweep(): Promise<number> {
  const soon = new Date(Date.now() + 3 * 86_400_000);

  const due = await prisma.maintenanceRecord.findMany({
    where: {
      status: MaintenanceStatus.SCHEDULED,
      scheduledAt: { lte: soon },
    },
    take: 500,
  });

  let notified = 0;
  for (const record of due) {
    const overdue = record.scheduledAt !== null && record.scheduledAt.getTime() < Date.now();
    const truck = await prisma.truck.findUnique({
      where: { id: record.truckId },
      select: { registrationNumber: true },
    });

    await notifyOrganization(record.organizationId, {
      type: overdue ? NotificationType.MAINTENANCE_OVERDUE : NotificationType.MAINTENANCE_DUE,
      title: overdue ? 'Maintenance overdue' : 'Maintenance due soon',
      body: `${truck?.registrationNumber ?? 'A truck'}: ${record.title}`,
      priority: overdue ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
      actionUrl: `/fleet/maintenance`,
      roles: OPERATOR_MANAGEMENT_ROLES,
    });
    notified += 1;
  }

  return notified;
}
