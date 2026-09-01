import {
  FREIGHT_VEHICLE_TYPES,
  PASSENGER_VEHICLE_TYPES,
  TRAVEL_VEHICLE_TYPES,
  TruckStatus,
  VehicleCapability,
  VehicleType,
  VerificationStatus,
  buildPaginationMeta,
  resolveDocumentValidity,
  resolveTruckType,
  validateVehicleCapacities,
  vehicleCapabilities,
  vehicleTypeDefinition,
  type CreateVehicleInput,
  type Paginated,
  type UpdateVehicleInput,
  type VehicleListQuery,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { assertTenantAccess } from '../../server/guards';
import type { AuthContext } from '../../auth/context';
import { broadcastTruckStatus } from '../../realtime/realtime.service';
import { scheduleFastagDiscovery } from '../toll/fastag.service';

/**
 * Generalized vehicle management.
 *
 * This is the same `trucks` table the fleet module uses. Saarthi was built
 * truck-only, and renaming that table to `vehicles` would have meant a
 * destructive migration touching every fleet endpoint and the whole test
 * suite — so the row gained a `vehicleType` discriminator instead, and this
 * module is the type-aware surface over it. A truck created through
 * `/trucks` and a taxi created here are the same kind of thing, share the
 * same driver assignments, tracking, documents and telemetry, and appear
 * together on one live map.
 *
 * What this module adds over the truck surface:
 *
 *  * capability-driven validation, so a taxi is not asked for a payload
 *    capacity and a truck cannot omit one,
 *  * filtering by capability rather than by type, so business rules survive a
 *    new vehicle type being added,
 *  * the device/telemetry roll-up the truck summary has no concept of.
 */

export interface VehicleCapabilitySummary {
  type: VehicleType;
  label: string;
  capabilities: VehicleCapability[];
}

export interface VehicleDeviceSummary {
  deviceId: string;
  deviceIdentifier: string;
  serialNumber: string;
  provider: string;
  status: string;
  lastSeenAt: string | null;
  assignedAt: string;
}

export interface VehicleSummary {
  id: string;
  organizationId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  /** Body type. Meaningful for goods vehicles only. */
  truckType: string;
  typeLabel: string;
  capabilities: VehicleCapability[];
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  /** `null` when the vehicle type carries no freight. */
  capacityTons: number | null;
  /** `null` when the vehicle type carries no passengers. */
  passengerCapacity: number | null;
  airConditioned: boolean | null;
  fuelType: string;
  fuelEfficiency: number | null;
  status: string;
  verificationStatus: string;
  odometerKm: number;
  shareLocation: boolean;
  currentDriver: { id: string; name: string; overallScore: number | null } | null;
  currentTripId: string | null;
  lastLocation: {
    latitude: number;
    longitude: number;
    speedKph: number | null;
    heading: number | null;
    recordedAt: string;
  } | null;
  /** The telematics unit currently fitted, if any. */
  device: VehicleDeviceSummary | null;
  openTelemetryAlerts: number;
  documentHealth: { total: number; expired: number; expiringSoon: number; pending: number };
  notes: string | null;
  createdAt: string;
  archivedAt: string | null;
}

const vehicleInclude = {
  assignments: {
    where: { status: 'ACTIVE' as const },
    include: { driver: { include: { user: { select: { firstName: true, lastName: true } } } } },
    take: 1,
  },
  deviceAssignments: {
    where: { status: 'ACTIVE' as const },
    include: {
      device: {
        select: {
          id: true,
          deviceIdentifier: true,
          serialNumber: true,
          provider: true,
          status: true,
          lastSeenAt: true,
        },
      },
    },
    take: 1,
  },
} satisfies Prisma.TruckInclude;

type VehicleRecord = Prisma.TruckGetPayload<{ include: typeof vehicleInclude }>;

type DocumentHealth = VehicleSummary['documentHealth'];

async function documentHealthFor(vehicleIds: string[]): Promise<Map<string, DocumentHealth>> {
  const map = new Map<string, DocumentHealth>();
  if (vehicleIds.length === 0) return map;

  for (const id of vehicleIds) {
    map.set(id, { total: 0, expired: 0, expiringSoon: 0, pending: 0 });
  }

  const documents = await prisma.document.findMany({
    where: { ownerType: 'TRUCK', ownerId: { in: vehicleIds }, deletedAt: null },
    select: { ownerId: true, expiryDate: true, verificationStatus: true },
  });

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

async function openAlertCounts(vehicleIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (vehicleIds.length === 0) return map;

  const grouped = await prisma.telemetryAlert.groupBy({
    by: ['vehicleId'],
    where: { vehicleId: { in: vehicleIds }, status: 'OPEN' },
    _count: { _all: true },
  });
  for (const row of grouped) map.set(row.vehicleId, row._count._all);
  return map;
}

function toSummary(
  vehicle: VehicleRecord,
  health: DocumentHealth = { total: 0, expired: 0, expiringSoon: 0, pending: 0 },
  openAlerts = 0,
): VehicleSummary {
  const vehicleType = vehicle.vehicleType as VehicleType;
  const definition = vehicleTypeDefinition(vehicleType);
  const capabilities = definition.capabilities;
  const assignment = vehicle.assignments[0];
  const deviceAssignment = vehicle.deviceAssignments[0];

  // Report capacity only where the vehicle type can actually have it, so a
  // taxi shows "—" rather than a plausible-looking 0 tonnes.
  const carriesFreight = capabilities.includes(VehicleCapability.CARGO_CAPACITY);
  const carriesPassengers = capabilities.includes(VehicleCapability.PASSENGER_CAPACITY);

  return {
    id: vehicle.id,
    organizationId: vehicle.organizationId,
    registrationNumber: vehicle.registrationNumber,
    vehicleType,
    truckType: vehicle.truckType,
    typeLabel: definition.label,
    capabilities,
    manufacturer: vehicle.manufacturer,
    model: vehicle.model,
    year: vehicle.year,
    colour: vehicle.colour,
    capacityTons: carriesFreight ? vehicle.capacityTons : null,
    passengerCapacity: carriesPassengers ? vehicle.passengerCapacity : null,
    airConditioned: vehicle.airConditioned,
    fuelType: vehicle.fuelType,
    fuelEfficiency: vehicle.fuelEfficiency,
    status: vehicle.status,
    verificationStatus: vehicle.verificationStatus,
    odometerKm: vehicle.odometerKm,
    shareLocation: vehicle.shareLocation,
    currentDriver: assignment
      ? {
          id: assignment.driver.id,
          name: `${assignment.driver.user.firstName} ${assignment.driver.user.lastName}`.trim(),
          overallScore: assignment.driver.overallScore,
        }
      : null,
    currentTripId: vehicle.currentTripId,
    lastLocation:
      vehicle.lastLatitude !== null && vehicle.lastLongitude !== null && vehicle.lastLocationAt
        ? {
            latitude: vehicle.lastLatitude,
            longitude: vehicle.lastLongitude,
            speedKph: vehicle.lastSpeedKph,
            heading: vehicle.lastHeading,
            recordedAt: vehicle.lastLocationAt.toISOString(),
          }
        : null,
    device: deviceAssignment
      ? {
          deviceId: deviceAssignment.device.id,
          deviceIdentifier: deviceAssignment.device.deviceIdentifier,
          serialNumber: deviceAssignment.device.serialNumber,
          provider: deviceAssignment.device.provider,
          status: deviceAssignment.device.status,
          lastSeenAt: deviceAssignment.device.lastSeenAt?.toISOString() ?? null,
          assignedAt: deviceAssignment.assignedAt.toISOString(),
        }
      : null,
    openTelemetryAlerts: openAlerts,
    documentHealth: health,
    notes: vehicle.notes,
    createdAt: vehicle.createdAt.toISOString(),
    archivedAt: vehicle.archivedAt?.toISOString() ?? null,
  };
}

/** Vehicle types matching a capability filter, used by list queries. */
function typesForCapability(capability: 'FREIGHT' | 'PASSENGER' | 'TRAVEL'): VehicleType[] {
  switch (capability) {
    case 'FREIGHT':
      return FREIGHT_VEHICLE_TYPES;
    case 'PASSENGER':
      return PASSENGER_VEHICLE_TYPES;
    case 'TRAVEL':
      return TRAVEL_VEHICLE_TYPES;
  }
}

export async function listVehicles(
  auth: AuthContext,
  query: VehicleListQuery,
): Promise<Paginated<VehicleSummary>> {
  // Capability and explicit type filters intersect rather than override: asking
  // for "passenger vehicles" and "TRUCK" should return nothing, not every truck.
  const capabilityTypes = query.capability ? typesForCapability(query.capability) : null;
  const requestedTypes = query.vehicleType ? (query.vehicleType as VehicleType[]) : null;
  const typeFilter =
    capabilityTypes && requestedTypes
      ? requestedTypes.filter((type) => capabilityTypes.includes(type))
      : (capabilityTypes ?? requestedTypes);

  const where: Prisma.TruckWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId
      ? {}
      : { organizationId: auth.organizationId ?? '__none__' }),
    ...(query.includeArchived ? {} : { archivedAt: null }),
    ...(typeFilter ? { vehicleType: { in: typeFilter } } : {}),
    ...(query.status ? { status: { in: query.status as TruckStatus[] } } : {}),
    ...(query.verificationStatus
      ? { verificationStatus: { in: query.verificationStatus as VerificationStatus[] } }
      : {}),
    ...(query.driverId ? { currentDriverId: query.driverId } : {}),
    ...(query.minPassengerCapacity
      ? { passengerCapacity: { gte: query.minPassengerCapacity } }
      : {}),
    ...(query.hasDevice === undefined
      ? {}
      : query.hasDevice
        ? { deviceAssignments: { some: { status: 'ACTIVE' } } }
        : { deviceAssignments: { none: { status: 'ACTIVE' } } }),
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
        : query.sortBy === 'vehicleType'
          ? { vehicleType: query.sortOrder }
          : query.sortBy === 'lastLocationAt'
            ? { lastLocationAt: query.sortOrder }
            : { createdAt: query.sortOrder };

  const [total, vehicles] = await Promise.all([
    prisma.truck.count({ where }),
    prisma.truck.findMany({
      where,
      include: vehicleInclude,
      orderBy,
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const ids = vehicles.map((vehicle) => vehicle.id);
  const [health, alerts] = await Promise.all([documentHealthFor(ids), openAlertCounts(ids)]);

  return {
    items: vehicles.map((vehicle) =>
      toSummary(vehicle, health.get(vehicle.id), alerts.get(vehicle.id) ?? 0),
    ),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getVehicle(auth: AuthContext, vehicleId: string): Promise<VehicleSummary> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    include: vehicleInclude,
  });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const [health, alerts] = await Promise.all([
    documentHealthFor([vehicle.id]),
    openAlertCounts([vehicle.id]),
  ]);
  return toSummary(vehicle, health.get(vehicle.id), alerts.get(vehicle.id) ?? 0);
}

/**
 * Enforce the plan's fleet-size limit.
 *
 * Counts *all* vehicles, not just trucks: an operator running 5 trucks and 20
 * taxis is using 25 vehicles' worth of the platform, and letting passenger
 * vehicles bypass the limit would make the cap meaningless.
 */
async function assertVehicleLimit(auth: AuthContext, organizationId: string): Promise<void> {
  const max = auth.subscription?.limits.maxTrucks;
  if (max === null || max === undefined) return;

  const existing = await prisma.truck.count({ where: { organizationId, archivedAt: null } });
  if (existing >= max) {
    throw errors.planLimitReached(
      'maxTrucks',
      `Your ${auth.subscription?.planName ?? 'current'} plan covers ${max} vehicle${max === 1 ? '' : 's'}. ` +
        'Add a +1 vehicle top-up for this one vehicle, or upgrade the plan if the fleet is growing.',
    );
  }
}

export async function createVehicle(
  auth: AuthContext,
  organizationId: string,
  input: CreateVehicleInput,
): Promise<VehicleSummary> {
  await assertVehicleLimit(auth, organizationId);

  const problems = validateVehicleCapacities(input.vehicleType, input);
  if (problems.length > 0) throw errors.validation(problems[0]!);

  const existing = await prisma.truck.findUnique({
    where: { registrationNumber: input.registrationNumber },
  });
  if (existing) {
    throw errors.duplicate(
      `A vehicle with registration ${input.registrationNumber} is already registered on Saarthi.`,
      { fields: { registrationNumber: ['This registration number is already registered.'] } },
    );
  }

  const definition = vehicleTypeDefinition(input.vehicleType);
  const carriesFreight = definition.capabilities.includes(VehicleCapability.CARGO_CAPACITY);

  const vehicle = await prisma.truck.create({
    data: {
      organizationId,
      registrationNumber: input.registrationNumber,
      vehicleType: input.vehicleType,
      // Passenger vehicles have no meaningful body type, so the capability
      // model supplies one and the legacy column stays valid.
      truckType: resolveTruckType(input.vehicleType, input.truckType),
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      colour: input.colour ?? null,
      capacityTons: carriesFreight ? (input.capacityTons ?? 0) : 0,
      passengerCapacity: input.passengerCapacity ?? null,
      airConditioned: input.airConditioned ?? null,
      fuelType: input.fuelType,
      fuelEfficiency: input.fuelEfficiency ?? null,
      odometerKm: input.odometerKm,
      notes: input.notes ?? null,
      shareLocation: input.shareLocation,
      status: TruckStatus.AVAILABLE,
      verificationStatus: VerificationStatus.PENDING,
    },
    include: vehicleInclude,
  });

  await prisma.truckEvent.create({
    data: {
      truckId: vehicle.id,
      organizationId,
      type: 'CREATED',
      description: `${definition.label} ${vehicle.registrationNumber} added to the fleet.`,
      actorUserId: auth.user.id,
      metadata: { vehicleType: input.vehicleType },
    },
  });

  // A vehicle joining the fleet almost always has a tag on its windscreen
  // already, and asking an operator to type a 24-character identifier they do
  // not have is how the toll module stays empty. NETC resolves it from the
  // registration number, so Saarthi asks — in the background, because adding a
  // vehicle must not wait on a third party, and only for plans that include
  // the lookup.
  scheduleFastagDiscovery(auth, vehicle.id);

  return toSummary(vehicle);
}

export async function updateVehicle(
  auth: AuthContext,
  vehicleId: string,
  input: UpdateVehicleInput,
): Promise<VehicleSummary> {
  const existing = await prisma.truck.findUnique({ where: { id: vehicleId } });
  if (!existing) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, existing.organizationId, 'Vehicle');

  // Validate the *resulting* vehicle, not the patch: changing type from TRUCK
  // to TAXI without clearing the payload would otherwise leave an incoherent row.
  const nextType = (input.vehicleType ?? existing.vehicleType) as VehicleType;
  const definition = vehicleTypeDefinition(nextType);
  const carriesFreight = definition.capabilities.includes(VehicleCapability.CARGO_CAPACITY);
  const carriesPassengers = definition.capabilities.includes(VehicleCapability.PASSENGER_CAPACITY);

  const nextCapacityTons = carriesFreight
    ? (input.capacityTons ?? (existing.capacityTons || null))
    : null;
  const nextPassengerCapacity = carriesPassengers
    ? (input.passengerCapacity ?? existing.passengerCapacity)
    : null;

  const problems = validateVehicleCapacities(nextType, {
    capacityTons: nextCapacityTons,
    passengerCapacity: nextPassengerCapacity,
  });
  if (problems.length > 0) throw errors.validation(problems[0]!);

  const vehicle = await prisma.truck.update({
    where: { id: vehicleId },
    data: {
      ...(input.vehicleType ? { vehicleType: input.vehicleType } : {}),
      ...(input.vehicleType || input.truckType
        ? { truckType: resolveTruckType(nextType, input.truckType ?? undefined) }
        : {}),
      ...(input.registrationNumber ? { registrationNumber: input.registrationNumber } : {}),
      ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer ?? null } : {}),
      ...(input.model !== undefined ? { model: input.model ?? null } : {}),
      ...(input.year !== undefined ? { year: input.year ?? null } : {}),
      ...(input.colour !== undefined ? { colour: input.colour ?? null } : {}),
      capacityTons: nextCapacityTons ?? 0,
      passengerCapacity: nextPassengerCapacity,
      ...(input.airConditioned !== undefined ? { airConditioned: input.airConditioned } : {}),
      ...(input.fuelType ? { fuelType: input.fuelType } : {}),
      ...(input.fuelEfficiency !== undefined
        ? { fuelEfficiency: input.fuelEfficiency ?? null }
        : {}),
      ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      ...(input.shareLocation !== undefined ? { shareLocation: input.shareLocation } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    include: vehicleInclude,
  });

  if (input.status && input.status !== existing.status) {
    await broadcastTruckStatus({
      truckId: vehicle.id,
      organizationId: vehicle.organizationId,
      status: vehicle.status as TruckStatus,
      driverId: vehicle.currentDriverId,
      tripId: vehicle.currentTripId,
      updatedAt: vehicle.updatedAt.toISOString(),
    });
  }

  const [health, alerts] = await Promise.all([
    documentHealthFor([vehicle.id]),
    openAlertCounts([vehicle.id]),
  ]);
  return toSummary(vehicle, health.get(vehicle.id), alerts.get(vehicle.id) ?? 0);
}

/** The catalogue the vehicle form and filters are built from. */
export function vehicleTypeCatalogue(): VehicleCapabilitySummary[] {
  return Object.values(VehicleType).map((type) => ({
    type,
    label: vehicleTypeDefinition(type).label,
    capabilities: vehicleCapabilities(type),
  }));
}
