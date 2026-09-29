import type {
  SharedFuelInput,
  SharedFuelView,
  SharedMaintenanceInput,
  SharedMaintenanceView,
  SharedTripInput,
  SharedTripView,
  SharedVehicleView,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import type { AuthContext } from '../../auth/context';
import { insertFuelRecord, insertMaintenanceRecord } from '../maintenance/maintenance.service';
import { createTrip } from '../trips/trip.service';
import { requireActiveShare } from './vehicle-share.service';
import { sharedVehicleView } from './shared-vehicle.view';

/**
 * What a shared person can do with a vehicle: follow it, and add its trips,
 * fuel and maintenance.
 *
 * Every function starts at `requireActiveShare`, and everything written is
 * filed on the owner's account — the vehicle's history stays in one place, the
 * owner sees it all, and the shared person is recorded as its author. The
 * writes go through the same code the owner's own screens use, so a shared
 * entry is indistinguishable from any other except by who made it.
 */

const HISTORY_LIMIT = 50;

export async function getSharedVehicle(
  auth: AuthContext,
  shareId: string,
): Promise<SharedVehicleView> {
  const share = await requireActiveShare(auth, shareId);
  const owner = await prisma.organization.findUnique({
    where: { id: share.ownerOrganizationId },
    select: { name: true },
  });
  return sharedVehicleView(share, owner?.name ?? '');
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

const tripSelect = {
  id: true,
  reference: true,
  status: true,
  originAddress: true,
  destinationAddress: true,
  plannedDistanceKm: true,
  actualDistanceKm: true,
  plannedStartAt: true,
  actualStartAt: true,
  actualArrivalAt: true,
  createdAt: true,
} as const;

function tripView(trip: {
  id: string;
  reference: string;
  status: string;
  originAddress: string;
  destinationAddress: string;
  plannedDistanceKm: number | null;
  actualDistanceKm: number;
  plannedStartAt: Date | null;
  actualStartAt: Date | null;
  actualArrivalAt: Date | null;
  createdAt: Date;
}): SharedTripView {
  return {
    id: trip.id,
    reference: trip.reference,
    status: trip.status,
    origin: trip.originAddress,
    destination: trip.destinationAddress,
    plannedDistanceKm: trip.plannedDistanceKm,
    actualDistanceKm: trip.actualDistanceKm,
    plannedStartAt: trip.plannedStartAt?.toISOString() ?? null,
    startedAt: trip.actualStartAt?.toISOString() ?? null,
    arrivedAt: trip.actualArrivalAt?.toISOString() ?? null,
    createdAt: trip.createdAt.toISOString(),
  };
}

export async function listSharedTrips(
  auth: AuthContext,
  shareId: string,
): Promise<SharedTripView[]> {
  const { vehicle } = await requireActiveShare(auth, shareId);
  const trips = await prisma.trip.findMany({
    where: { truckId: vehicle.id, organizationId: vehicle.organizationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
    select: tripSelect,
  });
  return trips.map(tripView);
}

/**
 * Log a trip on the shared vehicle. It runs with the driver the owner has
 * assigned to the vehicle — a shared person cannot pick from the owner's
 * drivers — and carries no order or price, which are the owner's business.
 */
export async function createSharedTrip(
  auth: AuthContext,
  shareId: string,
  input: SharedTripInput,
): Promise<SharedTripView> {
  const { vehicle } = await requireActiveShare(auth, shareId);
  if (!vehicle.currentDriverId) {
    throw errors.businessRule(
      'The owner has not assigned a driver to this vehicle yet, so a trip cannot be added. Ask them to assign one.',
    );
  }

  const created = await createTrip(auth, vehicle.organizationId, {
    truckId: vehicle.id,
    origin: input.origin,
    destination: input.destination,
    ...(input.plannedStartAt ? { plannedStartAt: input.plannedStartAt } : {}),
    ...(input.plannedArrivalAt ? { plannedArrivalAt: input.plannedArrivalAt } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  });

  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: created.id },
    select: tripSelect,
  });
  return tripView(trip);
}

// ---------------------------------------------------------------------------
// Fuel
// ---------------------------------------------------------------------------

export async function listSharedFuel(
  auth: AuthContext,
  shareId: string,
): Promise<SharedFuelView[]> {
  const { vehicle } = await requireActiveShare(auth, shareId);
  const records = await prisma.fuelRecord.findMany({
    where: { truckId: vehicle.id, organizationId: vehicle.organizationId },
    orderBy: { recordedAt: 'desc' },
    take: HISTORY_LIMIT,
  });
  return records.map((record) => ({
    id: record.id,
    quantityLitres: record.quantityLitres,
    pricePerUnit: Number(record.pricePerUnit),
    totalCost: Number(record.totalCost),
    odometerKm: record.odometerKm,
    stationName: record.stationName,
    recordedAt: record.recordedAt.toISOString(),
  }));
}

export async function createSharedFuel(
  auth: AuthContext,
  shareId: string,
  input: SharedFuelInput,
): Promise<SharedFuelView> {
  const { vehicle } = await requireActiveShare(auth, shareId);
  const record = await insertFuelRecord(vehicle, vehicle.organizationId, input, auth.user.id);
  return {
    id: record.id,
    quantityLitres: record.quantityLitres,
    pricePerUnit: record.pricePerUnit,
    totalCost: record.totalCost,
    odometerKm: record.odometerKm,
    stationName: record.stationName,
    recordedAt: record.recordedAt,
  };
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export async function listSharedMaintenance(
  auth: AuthContext,
  shareId: string,
): Promise<SharedMaintenanceView[]> {
  const { vehicle } = await requireActiveShare(auth, shareId);
  const records = await prisma.maintenanceRecord.findMany({
    where: { truckId: vehicle.id, organizationId: vehicle.organizationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
  });
  return records.map((record) => ({
    id: record.id,
    type: record.type,
    title: record.title,
    status: record.status,
    cost: record.cost ? Number(record.cost) : null,
    odometerKm: record.odometerKm,
    serviceProvider: record.serviceProvider,
    scheduledAt: record.scheduledAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  }));
}

export async function createSharedMaintenance(
  auth: AuthContext,
  shareId: string,
  input: SharedMaintenanceInput,
): Promise<SharedMaintenanceView> {
  const { vehicle } = await requireActiveShare(auth, shareId);
  if (!input.performedAt && !input.scheduledAt) {
    throw errors.validation('Say when the work was done, or when it is booked for.');
  }

  const record = await insertMaintenanceRecord(
    vehicle,
    vehicle.organizationId,
    {
      type: input.type,
      title: input.title,
      description: input.description,
      odometerKm: input.odometerKm,
      cost: input.cost,
      serviceProvider: input.serviceProvider,
      scheduledAt: input.scheduledAt,
    },
    auth.user.id,
    input.performedAt,
  );

  return {
    id: record.id,
    type: record.type,
    title: record.title,
    status: record.status,
    cost: record.cost,
    odometerKm: record.odometerKm,
    serviceProvider: record.serviceProvider,
    scheduledAt: record.scheduledAt,
    completedAt: record.completedAt,
    createdAt: record.createdAt,
  };
}
