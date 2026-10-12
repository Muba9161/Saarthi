import {
  TripStatus,
  canCommunicate,
  communicationPartyForViewer,
  mayKnowCounterparty,
  type CommunicationParty,
  type ExternalNavigationApp,
  type LatLng,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { expenseTotalsByTrip } from '../expenses/expense.service';
import type { AuthContext } from '../../auth/context';

/**
 * How a trip is shown: the summary shape and the per-viewer projection.
 *
 * Kept apart from the lifecycle in `trip.service.ts` so the rules for who may
 * see a driver's phone or a customer's name live in one place, whichever
 * operation produced the rows.
 */

export interface TripSummary {
  id: string;
  reference: string;
  organizationId: string;
  status: TripStatus;
  truck: { id: string; registrationNumber: string; truckType: string; capacityTons: number } | null;
  driver: { id: string; name: string; phone: string | null; overallScore: number | null } | null;
  order: { id: string; reference: string; materialName: string; customerName: string } | null;
  originAddress: string;
  originLatitude: number;
  originLongitude: number;
  destinationAddress: string;
  destinationLatitude: number;
  destinationLongitude: number;
  plannedDistanceKm: number | null;
  actualDistanceKm: number;
  plannedDurationMin: number | null;
  actualDurationMin: number | null;
  plannedStartAt: string | null;
  actualStartAt: string | null;
  plannedArrivalAt: string | null;
  actualArrivalAt: string | null;
  etaAt: string | null;
  delayMinutes: number;
  progressPercent: number;
  price: number | null;
  expenses: number | null;
  /**
   * A journey the vehicle made on its own account.
   *
   * True for a run to a petrol pump, a workshop or a weighbridge that a terminal
   * opened because the driver navigated there with no dispatched trip against
   * the vehicle. Surfaced rather than hidden: a fleet reporting on delivered
   * work needs to be able to leave these out, and an owner looking at an
   * unexplained forty kilometres needs to be able to find them.
   */
  adHoc: boolean;
  /** The driver added this trip from the app; the fleet did not dispatch it. */
  driverCreated: boolean;
  /** The navigation app the driver is following this trip in, if not Saarthi's. */
  navigationHandoff: ExternalNavigationApp | null;
  /** Driving summary, written when the trip closed. Null while it is open. */
  topSpeedKph: number | null;
  averageSpeedKph: number | null;
  harshBrakingCount: number;
  harshAccelerationCount: number;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  currentLocation: {
    latitude: number;
    longitude: number;
    speedKph: number | null;
    heading: number | null;
    recordedAt: string;
  } | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export const tripInclude = {
  order: {
    select: {
      id: true,
      reference: true,
      materialName: true,
      customerOrganizationId: true,
      supplierOrganizationId: true,
    },
  },
} satisfies Prisma.TripInclude;

export type TripRecord = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

export function routePoints(trip: { plannedRoute: Prisma.JsonValue | null }): LatLng[] {
  if (!Array.isArray(trip.plannedRoute)) return [];
  return (trip.plannedRoute as unknown as LatLng[]).filter(
    (point) =>
      point &&
      typeof point.latitude === 'number' &&
      typeof point.longitude === 'number',
  );
}

export function progressOf(trip: TripRecord): number {
  if (trip.status === TripStatus.COMPLETED) return 100;
  if (!trip.plannedDistanceKm || trip.plannedDistanceKm <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((trip.actualDistanceKm / trip.plannedDistanceKm) * 100)));
}

/** The party a signed-in caller reads a trip as. */
export function viewerParty(auth: AuthContext): CommunicationParty {
  return communicationPartyForViewer({
    isPlatformAdmin: auth.isPlatformAdmin,
    organizationType: auth.organization?.type,
  });
}

/**
 * What a trip spent beyond fuel: the office's own figure plus the driver's
 * slips. Null only when neither exists, so "nothing recorded" is not shown as
 * a spend of zero.
 */
function tripExpenses(trip: { expenses: Prisma.Decimal | null }, slips: number): number | null {
  if (trip.expenses === null && slips === 0) return null;
  return Number(trip.expenses ?? 0) + slips;
}

/**
 * Shape trip rows for one viewer. A customer following a delivery sees the
 * truck and the driver's name but never the driver's phone, and a Seller
 * whose goods are on board is not told who the customer is.
 */
export async function decorate(trips: TripRecord[], viewer: CommunicationParty): Promise<TripSummary[]> {
  const mayCallDriver = canCommunicate(viewer, 'DRIVER');
  const mayKnowCustomer = mayKnowCounterparty(viewer, 'CUSTOMER');

  const truckIds = [...new Set(trips.map((trip) => trip.truckId))];
  const driverIds = [
    ...new Set(trips.map((trip) => trip.driverId).filter((id): id is string => Boolean(id))),
  ];
  const customerOrgIds = [
    ...new Set(
      trips
        .map((trip) => trip.order?.customerOrganizationId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [trucks, drivers, organizations, slipTotals] = await Promise.all([
    prisma.truck.findMany({ where: { id: { in: truckIds } } }),
    driverIds.length > 0
      ? prisma.driver.findMany({
          where: { id: { in: driverIds } },
          include: { user: { select: { firstName: true, lastName: true, phone: true } } },
        })
      : Promise.resolve([]),
    customerOrgIds.length > 0
      ? prisma.organization.findMany({
          where: { id: { in: customerOrgIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    expenseTotalsByTrip(trips.map((trip) => trip.id)),
  ]);

  const truckMap = new Map(trucks.map((truck) => [truck.id, truck]));
  const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));
  const orgMap = new Map(organizations.map((organization) => [organization.id, organization.name]));

  return trips.map((trip) => {
    const truck = truckMap.get(trip.truckId);
    const driver = trip.driverId ? driverMap.get(trip.driverId) : undefined;

    return {
      id: trip.id,
      reference: trip.reference,
      organizationId: trip.organizationId,
      status: trip.status,
      truck: truck
        ? {
            id: truck.id,
            registrationNumber: truck.registrationNumber,
            truckType: truck.truckType,
            capacityTons: truck.capacityTons,
          }
        : null,
      driver: driver
        ? {
            id: driver.id,
            name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
            phone: mayCallDriver ? driver.user.phone : null,
            overallScore: driver.overallScore,
          }
        : null,
      order: trip.order
        ? {
            id: trip.order.id,
            reference: trip.order.reference,
            materialName: trip.order.materialName,
            customerName: mayKnowCustomer
              ? (orgMap.get(trip.order.customerOrganizationId) ?? 'Customer')
              : 'Saarthi customer',
          }
        : null,
      originAddress: trip.originAddress,
      originLatitude: trip.originLatitude,
      originLongitude: trip.originLongitude,
      destinationAddress: trip.destinationAddress,
      destinationLatitude: trip.destinationLatitude,
      destinationLongitude: trip.destinationLongitude,
      plannedDistanceKm: trip.plannedDistanceKm,
      actualDistanceKm: Number(trip.actualDistanceKm.toFixed(1)),
      plannedDurationMin: trip.plannedDurationMin,
      actualDurationMin: trip.actualDurationMin,
      plannedStartAt: trip.plannedStartAt?.toISOString() ?? null,
      actualStartAt: trip.actualStartAt?.toISOString() ?? null,
      plannedArrivalAt: trip.plannedArrivalAt?.toISOString() ?? null,
      actualArrivalAt: trip.actualArrivalAt?.toISOString() ?? null,
      etaAt: trip.etaAt?.toISOString() ?? null,
      delayMinutes: trip.delayMinutes,
      progressPercent: progressOf(trip),
      price: trip.price ? Number(trip.price) : null,
      expenses: tripExpenses(trip, slipTotals.get(trip.id)?.total ?? 0),
      adHoc: trip.adHoc,
      driverCreated: trip.driverCreated,
      navigationHandoff: trip.externalNavigation,
      topSpeedKph: trip.topSpeedKph,
      averageSpeedKph: trip.averageSpeedKph,
      harshBrakingCount: trip.harshBrakingCount,
      harshAccelerationCount: trip.harshAccelerationCount,
      startOdometerKm: trip.startOdometerKm,
      endOdometerKm: trip.endOdometerKm,
      currentLocation:
        truck?.lastLatitude !== null &&
        truck?.lastLongitude !== null &&
        truck?.lastLocationAt &&
        truck
          ? {
              latitude: truck.lastLatitude!,
              longitude: truck.lastLongitude!,
              speedKph: truck.lastSpeedKph,
              heading: truck.lastHeading,
              recordedAt: truck.lastLocationAt.toISOString(),
            }
          : null,
      notes: trip.notes,
      createdAt: trip.createdAt.toISOString(),
      updatedAt: trip.updatedAt.toISOString(),
    };
  });
}
