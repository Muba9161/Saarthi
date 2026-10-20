import {
  describeVehicle,
  VehicleCapability,
  vehicleTypeDefinition,
  type SharedVehicleView,
  type VehicleType,
} from '@saarthi/shared';
import type { Prisma } from '../../database/prisma';

/**
 * What a shared person sees of a vehicle — an explicit allowlist.
 *
 * Built from its own narrow projection rather than from the owner's vehicle
 * summary, so a field added to the owner's screen tomorrow (a cost, a loan)
 * cannot leak onto a shared one by accident. The card's own figures — payload
 * or seats, and how the papers stand as counts — are named here on purpose, so
 * a shared vehicle's card reads like the owner's.
 */
export const vehicleViewInclude = {
  assignments: {
    where: { status: 'ACTIVE' as const },
    take: 1,
    select: { driver: { select: { user: { select: { firstName: true, lastName: true } } } } },
  },
} satisfies Prisma.TruckInclude;

type ShareWithVehicle = Prisma.VehicleShareGetPayload<{
  include: { vehicle: { include: typeof vehicleViewInclude } };
}>;

const NO_PAPERS: SharedVehicleView['documentHealth'] = { total: 0, expired: 0, expiringSoon: 0, pending: 0 };

export function sharedVehicleView(
  share: ShareWithVehicle,
  ownerName: string,
  documentHealth: SharedVehicleView['documentHealth'] = NO_PAPERS,
): SharedVehicleView {
  const { vehicle } = share;
  const driver = vehicle.assignments[0]?.driver.user;
  const vehicleType = vehicle.vehicleType as VehicleType;
  const definition = vehicleTypeDefinition(vehicleType);
  // Capacity only where the type can have it, as the owner's card shows it.
  const carriesFreight = definition.capabilities.includes(VehicleCapability.CARGO_CAPACITY);
  const carriesPassengers = definition.capabilities.includes(VehicleCapability.PASSENGER_CAPACITY);
  const kind = describeVehicle({ vehicleType, category: vehicle.category, truckType: vehicle.truckType });
  return {
    shareId: share.id,
    vehicleId: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    vehicleType,
    typeLabel: definition.label,
    truckType: vehicle.truckType,
    category: vehicle.category,
    categoryLabel: kind.kindLabel,
    manufacturer: vehicle.manufacturer,
    model: vehicle.model,
    status: vehicle.status,
    odometerKm: vehicle.odometerKm,
    capacityTons: carriesFreight ? vehicle.capacityTons : null,
    passengerCapacity: carriesPassengers ? vehicle.passengerCapacity : null,
    documentHealth,
    ownerName,
    currentDriverName: driver ? `${driver.firstName} ${driver.lastName}`.trim() : null,
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
    sharedSince: (share.respondedAt ?? share.invitedAt).toISOString(),
  };
}
