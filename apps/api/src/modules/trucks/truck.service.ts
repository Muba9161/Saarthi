import {
  ASSIGNABLE_TRUCK_STATUSES,
  TruckStatus,
  VerificationStatus,
  buildPaginationMeta,
  resolveDocumentValidity,
  type CreateTruckInput,
  type Paginated,
  type TruckListQuery,
  type UpdateTruckInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { assertTenantAccess } from '../../server/guards';
import type { AuthContext } from '../../auth/context';
import { broadcastTruckStatus } from '../../realtime/realtime.service';

/**
 * Truck management.
 *
 * Every read and write is scoped to the caller's organization. Status changes
 * fan out over the realtime layer so the fleet map reacts without a refresh,
 * and every assignment is recorded as history rather than overwriting a field.
 */

export interface TruckSummary {
  id: string;
  registrationNumber: string;
  truckType: string;
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  capacityTons: number;
  fuelType: string;
  status: string;
  verificationStatus: string;
  odometerKm: number;
  currentDriver: { id: string; name: string; overallScore: number | null } | null;
  currentTripId: string | null;
  lastLocation: {
    latitude: number;
    longitude: number;
    speedKph: number | null;
    heading: number | null;
    recordedAt: string;
  } | null;
  documentHealth: { total: number; expired: number; expiringSoon: number; pending: number };
  createdAt: string;
  archivedAt: string | null;
}

const truckInclude = {
  assignments: {
    where: { status: 'ACTIVE' as const },
    include: {
      driver: {
        include: { user: { select: { firstName: true, lastName: true } } },
      },
    },
    take: 1,
  },
} satisfies Prisma.TruckInclude;

type TruckWithRelations = Prisma.TruckGetPayload<{ include: typeof truckInclude }>;

/** Compliance roll-up per truck, computed from its document set. */
async function documentHealthFor(
  truckIds: string[],
): Promise<Map<string, TruckSummary['documentHealth']>> {
  const map = new Map<string, TruckSummary['documentHealth']>();
  if (truckIds.length === 0) return map;

  const documents = await prisma.document.findMany({
    where: { ownerType: 'TRUCK', ownerId: { in: truckIds }, deletedAt: null },
    select: { ownerId: true, expiryDate: true, verificationStatus: true },
  });

  for (const truckId of truckIds) {
    map.set(truckId, { total: 0, expired: 0, expiringSoon: 0, pending: 0 });
  }

  for (const document of documents) {
    const bucket = map.get(document.ownerId);
    if (!bucket) continue;
    bucket.total += 1;
    const { validity } = resolveDocumentValidity({
      expiryDate: document.expiryDate,
      verificationStatus: document.verificationStatus,
    });
    if (validity === 'EXPIRED') bucket.expired += 1;
    else if (validity === 'EXPIRING_SOON') bucket.expiringSoon += 1;
    else if (validity === 'PENDING_VERIFICATION') bucket.pending += 1;
  }

  return map;
}

function toSummary(
  truck: TruckWithRelations,
  health: TruckSummary['documentHealth'] = { total: 0, expired: 0, expiringSoon: 0, pending: 0 },
): TruckSummary {
  const assignment = truck.assignments[0];
  return {
    id: truck.id,
    registrationNumber: truck.registrationNumber,
    truckType: truck.truckType,
    manufacturer: truck.manufacturer,
    model: truck.model,
    year: truck.year,
    capacityTons: truck.capacityTons,
    fuelType: truck.fuelType,
    status: truck.status,
    verificationStatus: truck.verificationStatus,
    odometerKm: truck.odometerKm,
    currentDriver: assignment
      ? {
          id: assignment.driver.id,
          name: `${assignment.driver.user.firstName} ${assignment.driver.user.lastName}`.trim(),
          overallScore: assignment.driver.overallScore,
        }
      : null,
    currentTripId: truck.currentTripId,
    lastLocation:
      truck.lastLatitude !== null && truck.lastLongitude !== null && truck.lastLocationAt
        ? {
            latitude: truck.lastLatitude,
            longitude: truck.lastLongitude,
            speedKph: truck.lastSpeedKph,
            heading: truck.lastHeading,
            recordedAt: truck.lastLocationAt.toISOString(),
          }
        : null,
    documentHealth: health,
    createdAt: truck.createdAt.toISOString(),
    archivedAt: truck.archivedAt?.toISOString() ?? null,
  };
}

export async function listTrucks(
  auth: AuthContext,
  query: TruckListQuery,
): Promise<Paginated<TruckSummary>> {
  const where: Prisma.TruckWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId
      ? {}
      : { organizationId: auth.organizationId ?? '__none__' }),
    ...(query.includeArchived ? {} : { archivedAt: null }),
    ...(query.status ? { status: { in: query.status as TruckStatus[] } } : {}),
    ...(query.truckType ? { truckType: { in: query.truckType as never } } : {}),
    ...(query.verificationStatus
      ? { verificationStatus: { in: query.verificationStatus as VerificationStatus[] } }
      : {}),
    ...(query.driverId ? { currentDriverId: query.driverId } : {}),
    ...(query.minCapacityTons ? { capacityTons: { gte: query.minCapacityTons } } : {}),
    ...(query.search
      ? {
          OR: [
            { registrationNumber: { contains: query.search.toUpperCase().replace(/[\s-]/g, '') } },
            { manufacturer: { contains: query.search, mode: 'insensitive' } },
            { model: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.TruckOrderByWithRelationInput =
    query.sortBy === 'registrationNumber'
      ? { registrationNumber: query.sortOrder }
      : query.sortBy === 'status'
        ? { status: query.sortOrder }
        : query.sortBy === 'capacityTons'
          ? { capacityTons: query.sortOrder }
          : query.sortBy === 'lastLocationAt'
            ? { lastLocationAt: query.sortOrder }
            : { createdAt: query.sortOrder };

  const [total, trucks] = await Promise.all([
    prisma.truck.count({ where }),
    prisma.truck.findMany({
      where,
      include: truckInclude,
      orderBy,
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const health = await documentHealthFor(trucks.map((truck) => truck.id));

  return {
    items: trucks.map((truck) => toSummary(truck, health.get(truck.id))),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getTruck(auth: AuthContext, truckId: string): Promise<TruckSummary> {
  const truck = await prisma.truck.findUnique({ where: { id: truckId }, include: truckInclude });
  if (!truck) throw errors.notFound('Truck');
  assertTenantAccess(auth, truck.organizationId, 'Truck');

  const health = await documentHealthFor([truck.id]);
  return toSummary(truck, health.get(truck.id));
}

/**
 * Enforces the subscription's fleet-size limit before creating a truck.
 *
 * `limits.maxTrucks` is the *effective* capacity — the plan's allowance plus
 * any active `+1` top-ups — so a fleet that has paid for one extra vehicle can
 * add it here without this check knowing anything about top-ups.
 */
async function assertTruckLimit(auth: AuthContext, organizationId: string): Promise<void> {
  const max = auth.subscription?.limits.maxTrucks;
  if (max === null || max === undefined) return;

  const existing = await prisma.truck.count({ where: { organizationId, archivedAt: null } });
  if (existing >= max) {
    throw errors.planLimitReached(
      'maxTrucks',
      `Your ${auth.subscription?.planName ?? 'current'} plan covers ${max} vehicle${max === 1 ? '' : 's'}. ` +
        'Add a +1 vehicle top-up for this one truck, or upgrade the plan if the fleet is growing.',
    );
  }
}

export async function createTruck(
  auth: AuthContext,
  organizationId: string,
  input: CreateTruckInput,
): Promise<TruckSummary> {
  await assertTruckLimit(auth, organizationId);

  const existing = await prisma.truck.findUnique({
    where: { registrationNumber: input.registrationNumber },
  });
  if (existing) {
    throw errors.duplicate(
      `A truck with registration ${input.registrationNumber} is already registered on Saarthi.`,
      { fields: { registrationNumber: ['This registration number is already registered.'] } },
    );
  }

  const truck = await prisma.truck.create({
    data: {
      organizationId,
      registrationNumber: input.registrationNumber,
      truckType: input.truckType,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      capacityTons: input.capacityTons,
      fuelType: input.fuelType,
      fuelEfficiency: input.fuelEfficiency ?? null,
      odometerKm: input.odometerKm,
      notes: input.notes ?? null,
      shareLocation: input.shareLocation,
      status: TruckStatus.AVAILABLE,
      verificationStatus: VerificationStatus.PENDING,
    },
    include: truckInclude,
  });

  await prisma.truckEvent.create({
    data: {
      truckId: truck.id,
      organizationId,
      type: 'CREATED',
      description: `Truck ${truck.registrationNumber} added to the fleet.`,
      actorUserId: auth.user.id,
    },
  });

  return toSummary(truck);
}

export async function updateTruck(
  auth: AuthContext,
  truckId: string,
  input: UpdateTruckInput,
): Promise<TruckSummary> {
  const existing = await prisma.truck.findUnique({ where: { id: truckId } });
  if (!existing) throw errors.notFound('Truck');
  assertTenantAccess(auth, existing.organizationId, 'Truck');

  if (input.registrationNumber && input.registrationNumber !== existing.registrationNumber) {
    const clash = await prisma.truck.findUnique({
      where: { registrationNumber: input.registrationNumber },
    });
    if (clash) {
      throw errors.duplicate('This registration number is already registered on Saarthi.', {
        fields: { registrationNumber: ['This registration number is already registered.'] },
      });
    }
  }

  const truck = await prisma.truck.update({
    where: { id: truckId },
    data: {
      ...(input.registrationNumber !== undefined
        ? { registrationNumber: input.registrationNumber }
        : {}),
      ...(input.truckType !== undefined ? { truckType: input.truckType } : {}),
      ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.year !== undefined ? { year: input.year } : {}),
      ...(input.capacityTons !== undefined ? { capacityTons: input.capacityTons } : {}),
      ...(input.fuelType !== undefined ? { fuelType: input.fuelType } : {}),
      ...(input.fuelEfficiency !== undefined ? { fuelEfficiency: input.fuelEfficiency } : {}),
      ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.shareLocation !== undefined ? { shareLocation: input.shareLocation } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
    include: truckInclude,
  });

  if (input.status && input.status !== existing.status) {
    await recordStatusChange(auth, truck.id, existing.status, input.status, existing.organizationId);
  }

  const health = await documentHealthFor([truck.id]);
  return toSummary(truck, health.get(truck.id));
}

async function recordStatusChange(
  auth: AuthContext,
  truckId: string,
  from: string,
  to: string,
  organizationId: string,
): Promise<void> {
  await prisma.truckEvent.create({
    data: {
      truckId,
      organizationId,
      type: 'STATUS_CHANGED',
      description: `Status changed from ${from} to ${to}.`,
      metadata: { from, to },
      actorUserId: auth.user.id,
    },
  });

  const truck = await prisma.truck.findUnique({
    where: { id: truckId },
    select: { currentDriverId: true, currentTripId: true, status: true },
  });

  await broadcastTruckStatus({
    truckId,
    organizationId,
    status: (truck?.status ?? to) as never,
    driverId: truck?.currentDriverId ?? null,
    tripId: truck?.currentTripId ?? null,
    updatedAt: new Date().toISOString(),
  });
}

export async function setTruckStatus(
  auth: AuthContext,
  truckId: string,
  status: TruckStatus,
  reason?: string,
): Promise<TruckSummary> {
  const existing = await prisma.truck.findUnique({ where: { id: truckId } });
  if (!existing) throw errors.notFound('Truck');
  assertTenantAccess(auth, existing.organizationId, 'Truck');

  if (existing.currentTripId && status !== TruckStatus.EMERGENCY) {
    throw errors.businessRule(
      'This truck is on an active trip. Complete or cancel the trip before changing its status manually.',
    );
  }

  const truck = await prisma.truck.update({
    where: { id: truckId },
    data: { status },
    include: truckInclude,
  });

  await prisma.truckEvent.create({
    data: {
      truckId,
      organizationId: existing.organizationId,
      type: 'STATUS_CHANGED',
      description: reason ?? `Status changed from ${existing.status} to ${status}.`,
      metadata: { from: existing.status, to: status, reason: reason ?? null },
      actorUserId: auth.user.id,
    },
  });

  await broadcastTruckStatus({
    truckId,
    organizationId: existing.organizationId,
    status,
    driverId: truck.currentDriverId,
    tripId: truck.currentTripId,
    updatedAt: new Date().toISOString(),
  });

  return toSummary(truck);
}

export async function archiveTruck(auth: AuthContext, truckId: string): Promise<void> {
  const truck = await prisma.truck.findUnique({ where: { id: truckId } });
  if (!truck) throw errors.notFound('Truck');
  assertTenantAccess(auth, truck.organizationId, 'Truck');

  if (truck.currentTripId) {
    throw errors.businessRule('This truck is on an active trip and cannot be archived yet.');
  }

  await prisma.$transaction([
    prisma.truckAssignment.updateMany({
      where: { truckId, status: 'ACTIVE' },
      data: { status: 'ENDED', unassignedAt: new Date() },
    }),
    prisma.driver.updateMany({ where: { currentTruckId: truckId }, data: { currentTruckId: null } }),
    prisma.truck.update({
      where: { id: truckId },
      data: { archivedAt: new Date(), status: TruckStatus.OFFLINE, currentDriverId: null },
    }),
    prisma.truckEvent.create({
      data: {
        truckId,
        organizationId: truck.organizationId,
        type: 'ARCHIVED',
        description: `Truck ${truck.registrationNumber} archived.`,
        actorUserId: auth.user.id,
      },
    }),
  ]);
}

export async function restoreTruck(auth: AuthContext, truckId: string): Promise<TruckSummary> {
  const truck = await prisma.truck.findUnique({ where: { id: truckId } });
  if (!truck) throw errors.notFound('Truck');
  assertTenantAccess(auth, truck.organizationId, 'Truck');
  await assertTruckLimit(auth, truck.organizationId);

  const restored = await prisma.truck.update({
    where: { id: truckId },
    data: { archivedAt: null, status: TruckStatus.AVAILABLE },
    include: truckInclude,
  });
  return toSummary(restored);
}

// ---------------------------------------------------------------------------
// Driver assignment
// ---------------------------------------------------------------------------

export async function assignDriver(
  auth: AuthContext,
  truckId: string,
  driverId: string,
  note?: string,
): Promise<TruckSummary> {
  const [truck, driver] = await Promise.all([
    prisma.truck.findUnique({ where: { id: truckId } }),
    prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  if (!truck) throw errors.notFound('Truck');
  assertTenantAccess(auth, truck.organizationId, 'Truck');
  if (!driver) throw errors.notFound('Driver');
  assertTenantAccess(auth, driver.organizationId, 'Driver');

  if (truck.archivedAt) throw errors.businessRule('This truck is archived.');
  if (driver.archivedAt) throw errors.businessRule('This driver is archived.');
  if (!ASSIGNABLE_TRUCK_STATUSES.includes(truck.status as TruckStatus)) {
    throw errors.businessRule(
      `Cannot assign a driver while the truck is ${truck.status.toLowerCase().replace(/_/g, ' ')}.`,
    );
  }
  if (driver.verificationStatus !== VerificationStatus.VERIFIED) {
    throw errors.businessRule(
      'This driver has not completed verification yet. Verify the driver before assigning a truck.',
    );
  }
  if (driver.currentTruckId && driver.currentTruckId !== truckId) {
    throw errors.conflict('This driver is already assigned to another truck.');
  }

  const driverName = `${driver.user.firstName} ${driver.user.lastName}`.trim();

  await prisma.$transaction([
    // Close any existing assignment so history stays accurate.
    prisma.truckAssignment.updateMany({
      where: { truckId, status: 'ACTIVE' },
      data: { status: 'ENDED', unassignedAt: new Date() },
    }),
    prisma.truckAssignment.create({
      data: {
        truckId,
        driverId,
        organizationId: truck.organizationId,
        status: 'ACTIVE',
        assignedById: auth.user.id,
        note: note ?? null,
      },
    }),
    prisma.truck.update({
      where: { id: truckId },
      data: { currentDriverId: driverId, status: TruckStatus.ASSIGNED },
    }),
    prisma.driver.update({ where: { id: driverId }, data: { currentTruckId: truckId } }),
    prisma.truckEvent.create({
      data: {
        truckId,
        organizationId: truck.organizationId,
        type: 'DRIVER_ASSIGNED',
        description: `${driverName} assigned to ${truck.registrationNumber}.`,
        metadata: { driverId },
        actorUserId: auth.user.id,
      },
    }),
  ]);

  return getTruck(auth, truckId);
}

export async function unassignDriver(auth: AuthContext, truckId: string): Promise<TruckSummary> {
  const truck = await prisma.truck.findUnique({ where: { id: truckId } });
  if (!truck) throw errors.notFound('Truck');
  assertTenantAccess(auth, truck.organizationId, 'Truck');

  if (truck.currentTripId) {
    throw errors.businessRule('Complete or cancel the active trip before unassigning the driver.');
  }
  if (!truck.currentDriverId) {
    throw errors.businessRule('This truck does not have a driver assigned.');
  }

  await prisma.$transaction([
    prisma.truckAssignment.updateMany({
      where: { truckId, status: 'ACTIVE' },
      data: { status: 'ENDED', unassignedAt: new Date() },
    }),
    prisma.driver.updateMany({ where: { currentTruckId: truckId }, data: { currentTruckId: null } }),
    prisma.truck.update({
      where: { id: truckId },
      data: { currentDriverId: null, status: TruckStatus.AVAILABLE },
    }),
    prisma.truckEvent.create({
      data: {
        truckId,
        organizationId: truck.organizationId,
        type: 'DRIVER_UNASSIGNED',
        description: `Driver unassigned from ${truck.registrationNumber}.`,
        actorUserId: auth.user.id,
      },
    }),
  ]);

  return getTruck(auth, truckId);
}

export async function truckAssignmentHistory(auth: AuthContext, truckId: string) {
  const truck = await prisma.truck.findUnique({ where: { id: truckId } });
  if (!truck) throw errors.notFound('Truck');
  assertTenantAccess(auth, truck.organizationId, 'Truck');

  const assignments = await prisma.truckAssignment.findMany({
    where: { truckId },
    include: { driver: { include: { user: { select: { firstName: true, lastName: true } } } } },
    orderBy: { assignedAt: 'desc' },
  });

  return assignments.map((assignment) => ({
    id: assignment.id,
    driverId: assignment.driverId,
    driverName: `${assignment.driver.user.firstName} ${assignment.driver.user.lastName}`.trim(),
    status: assignment.status,
    assignedAt: assignment.assignedAt.toISOString(),
    unassignedAt: assignment.unassignedAt?.toISOString() ?? null,
    note: assignment.note,
  }));
}

export async function truckEvents(auth: AuthContext, truckId: string, limit = 50) {
  const truck = await prisma.truck.findUnique({ where: { id: truckId } });
  if (!truck) throw errors.notFound('Truck');
  assertTenantAccess(auth, truck.organizationId, 'Truck');

  const events = await prisma.truckEvent.findMany({
    where: { truckId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, limit),
  });

  return events.map((event) => ({
    id: event.id,
    type: event.type,
    description: event.description,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
  }));
}
