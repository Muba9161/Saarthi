import { vehicleTypeDefinition, type SharedVehicleView, type VehicleType } from '@saarthi/shared';
import type { Prisma } from '../../database/prisma';

/**
 * What a shared person sees of a vehicle — an explicit allowlist.
 *
 * Built from its own narrow projection rather than from the owner's vehicle
 * summary, so a field added to the owner's screen tomorrow (a cost, a loan, a
 * document count) cannot leak onto a shared one by accident.
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

export function sharedVehicleView(share: ShareWithVehicle, ownerName: string): SharedVehicleView {
  const { vehicle } = share;
  const driver = vehicle.assignments[0]?.driver.user;
  return {
    shareId: share.id,
    vehicleId: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    vehicleType: vehicle.vehicleType as VehicleType,
    typeLabel: vehicleTypeDefinition(vehicle.vehicleType as VehicleType).label,
    manufacturer: vehicle.manufacturer,
    model: vehicle.model,
    status: vehicle.status,
    odometerKm: vehicle.odometerKm,
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
