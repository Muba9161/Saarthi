import {
  ACTIVE_TRIP_STATUSES,
  ASSIGNABLE_TRUCK_STATUSES,
  NotificationPriority,
  NotificationType,
  OrderStatus,
  TRIP_STATUS_TO_ORDER_STATUS,
  TRIP_STATUS_TO_TRUCK_STATUS,
  TripStatus,
  TruckStatus,
  VerificationStatus,
  buildPaginationMeta,
  distanceKm,
  pathLength,
  tripStateMachine,
  type CreateTripInput,
  type LatLng,
  type Paginated,
  type TripListQuery,
  type TripTransitionInput,
  type UpdateTripInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { notifyAsync, notifyOrganization } from '../notifications/notification.service';
import { broadcastTripEvent, broadcastTripUpdate, broadcastTruckStatus } from '../../realtime/realtime.service';
import { recordTripFuel } from './trip-fuel.service';
import { recalculateDriverScore, evaluateAndAwardAchievements } from '../drivers/driver.service';
import { releaseVehicleFromAdHocTrip } from '../terminal/adhoc-trip.service';
import type { AuthContext } from '../../auth/context';

/**
 * Trip lifecycle.
 *
 * The trip is where an order becomes a physical movement. Status changes are
 * validated against the shared state machine and then cascaded consistently:
 * the truck's status, the driver's availability and the order's status all
 * follow from the trip, so the three can never disagree.
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

const tripInclude = {
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

type TripRecord = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

function routePoints(trip: { plannedRoute: Prisma.JsonValue | null }): LatLng[] {
  if (!Array.isArray(trip.plannedRoute)) return [];
  return (trip.plannedRoute as unknown as LatLng[]).filter(
    (point) =>
      point &&
      typeof point.latitude === 'number' &&
      typeof point.longitude === 'number',
  );
}

function progressOf(trip: TripRecord): number {
  if (trip.status === TripStatus.COMPLETED) return 100;
  if (!trip.plannedDistanceKm || trip.plannedDistanceKm <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((trip.actualDistanceKm / trip.plannedDistanceKm) * 100)));
}

async function decorate(trips: TripRecord[]): Promise<TripSummary[]> {
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

  const [trucks, drivers, organizations] = await Promise.all([
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
            phone: driver.user.phone,
            overallScore: driver.overallScore,
          }
        : null,
      order: trip.order
        ? {
            id: trip.order.id,
            reference: trip.order.reference,
            materialName: trip.order.materialName,
            customerName: orgMap.get(trip.order.customerOrganizationId) ?? 'Customer',
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
      expenses: trip.expenses ? Number(trip.expenses) : null,
      adHoc: trip.adHoc,
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

/** Parties allowed to see a trip: the operating fleet, its driver, the order's customer/supplier. */
function assertTripAccess(auth: AuthContext, trip: TripRecord): void {
  if (auth.isPlatformAdmin) return;
  if (auth.organizationId === trip.organizationId) return;
  if (auth.driverId && trip.driverId === auth.driverId) return;
  if (
    trip.order &&
    auth.organizationId &&
    [trip.order.customerOrganizationId, trip.order.supplierOrganizationId].includes(
      auth.organizationId,
    )
  ) {
    return;
  }
  throw errors.notFound('Trip');
}

async function nextReference(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.trip.count();
  return `TR-${year}-${String(count + 1).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listTrips(
  auth: AuthContext,
  query: TripListQuery,
): Promise<Paginated<TripSummary>> {
  const scope: Prisma.TripWhereInput = auth.isPlatformAdmin && !auth.organizationId
    ? {}
    : auth.driverId
      ? {
          OR: [
            { organizationId: auth.organizationId ?? '__none__' },
            { driverId: auth.driverId },
          ],
        }
      : {
          OR: [
            { organizationId: auth.organizationId ?? '__none__' },
            { order: { customerOrganizationId: auth.organizationId ?? '__none__' } },
            { order: { supplierOrganizationId: auth.organizationId ?? '__none__' } },
          ],
        };

  const where: Prisma.TripWhereInput = {
    AND: [
      scope,
      {
        ...(query.status ? { status: { in: query.status as TripStatus[] } } : {}),
        ...(query.activeOnly ? { status: { in: ACTIVE_TRIP_STATUSES } } : {}),
        ...(query.truckId ? { truckId: query.truckId } : {}),
        ...(query.driverId ? { driverId: query.driverId } : {}),
        ...(query.orderId ? { order: { id: query.orderId } } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
        ...(query.search
          ? {
              OR: [
                { reference: { contains: query.search, mode: 'insensitive' } },
                { originAddress: { contains: query.search, mode: 'insensitive' } },
                { destinationAddress: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    ],
  };

  const orderBy: Prisma.TripOrderByWithRelationInput =
    query.sortBy === 'plannedStartAt'
      ? { plannedStartAt: query.sortOrder }
      : query.sortBy === 'status'
        ? { status: query.sortOrder }
        : { createdAt: query.sortOrder };

  const [total, trips] = await Promise.all([
    prisma.trip.count({ where }),
    prisma.trip.findMany({
      where,
      include: tripInclude,
      orderBy,
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  return {
    items: await decorate(trips),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getTrip(auth: AuthContext, tripId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: tripInclude });
  if (!trip) throw errors.notFound('Trip');
  assertTripAccess(auth, trip);

  const [summary] = await decorate([trip]);
  const [events, stops] = await Promise.all([
    prisma.tripEvent.findMany({ where: { tripId }, orderBy: { createdAt: 'asc' }, take: 300 }),
    prisma.tripStop.findMany({ where: { tripId }, orderBy: { sequence: 'asc' } }),
  ]);

  return {
    ...summary!,
    plannedRoute: routePoints(trip),
    allowedTransitions: tripStateMachine.nextStates(trip.status),
    stops: stops.map((stop) => ({
      id: stop.id,
      type: stop.type,
      name: stop.name,
      address: stop.address,
      latitude: stop.latitude,
      longitude: stop.longitude,
      sequence: stop.sequence,
      plannedArrival: stop.plannedArrival?.toISOString() ?? null,
      actualArrival: stop.actualArrival?.toISOString() ?? null,
      actualDeparture: stop.actualDeparture?.toISOString() ?? null,
      status: stop.status,
    })),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      description: event.description,
      latitude: event.latitude,
      longitude: event.longitude,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function createTrip(
  auth: AuthContext,
  organizationId: string,
  input: CreateTripInput,
): Promise<TripSummary> {
  const truck = await prisma.truck.findUnique({ where: { id: input.truckId } });
  if (!truck || truck.organizationId !== organizationId) throw errors.notFound('Truck');
  if (truck.archivedAt) throw errors.businessRule('This truck is archived.');
  if (!ASSIGNABLE_TRUCK_STATUSES.includes(truck.status as TruckStatus)) {
    throw errors.businessRule(
      `${truck.registrationNumber} is ${truck.status.toLowerCase().replace(/_/g, ' ')} and cannot start a new trip.`,
    );
  }
  if (truck.currentTripId) {
    /*
     * A service run is not a reason to refuse a dispatch.
     *
     * Terminals open an ad-hoc trip when a driver navigates to a petrol pump or
     * a workshop, and that trip occupies `currentTripId` exactly as a real one
     * does — which is what makes the tracking pipeline record it. Refusing here
     * would mean a dispatcher could not assign work to a vehicle whose driver
     * had gone for diesel, with nothing on the dashboard to explain why. So the
     * run is closed and the dispatch proceeds; the distance it covered is
     * already banked on its own trip.
     */
    const released = await releaseVehicleFromAdHocTrip(
      input.truckId,
      'Closed automatically: the vehicle was dispatched on a new trip.',
    );
    if (!released) {
      throw errors.conflict('This truck is already on an active trip.');
    }
  }

  const driverId = input.driverId ?? truck.currentDriverId;
  if (!driverId) {
    throw errors.businessRule('Assign a driver to this truck before creating a trip.');
  }

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver || driver.organizationId !== organizationId) throw errors.notFound('Driver');
  if (driver.verificationStatus !== VerificationStatus.VERIFIED) {
    throw errors.businessRule('This driver has not completed verification yet.');
  }

  let orderId: string | null = null;
  if (input.orderId) {
    const order = await prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw errors.notFound('Order');
    if (order.tripId) throw errors.conflict('This order already has a trip.');
    if (order.fleetOrganizationId && order.fleetOrganizationId !== organizationId) {
      throw errors.forbidden('This order was awarded to a different fleet.');
    }
    orderId = order.id;
  }

  const route: LatLng[] =
    input.plannedRoute ??
    ([
      { latitude: input.origin.latitude, longitude: input.origin.longitude },
      { latitude: input.destination.latitude, longitude: input.destination.longitude },
    ] as LatLng[]);

  const plannedDistance =
    route.length > 2
      ? pathLength(route) / 1000
      : distanceKm(
          { latitude: input.origin.latitude, longitude: input.origin.longitude },
          { latitude: input.destination.latitude, longitude: input.destination.longitude },
        );

  const trip = await prisma.$transaction(async (tx) => {
    const created = await tx.trip.create({
      data: {
        reference: await nextReference(),
        organizationId,
        truckId: input.truckId,
        driverId,
        originAddress: input.origin.addressLine,
        originLatitude: input.origin.latitude,
        originLongitude: input.origin.longitude,
        destinationAddress: input.destination.addressLine,
        destinationLatitude: input.destination.latitude,
        destinationLongitude: input.destination.longitude,
        plannedRoute: route as never,
        plannedDistanceKm: Number(plannedDistance.toFixed(1)),
        plannedDurationMin: Math.round((plannedDistance / 45) * 60),
        plannedStartAt: input.plannedStartAt ?? null,
        plannedArrivalAt: input.plannedArrivalAt ?? null,
        etaAt: input.plannedArrivalAt ?? null,
        status: TripStatus.ASSIGNED,
        price: input.price ?? null,
        notes: input.notes ?? null,
        createdById: auth.user.id,
        stops: {
          create: [
            {
              type: 'ORIGIN',
              name: input.origin.label ?? input.origin.addressLine,
              address: input.origin.addressLine,
              latitude: input.origin.latitude,
              longitude: input.origin.longitude,
              sequence: 0,
              plannedArrival: input.plannedStartAt ?? null,
              status: 'PENDING',
            },
            {
              type: 'DESTINATION',
              name: input.destination.label ?? input.destination.addressLine,
              address: input.destination.addressLine,
              latitude: input.destination.latitude,
              longitude: input.destination.longitude,
              sequence: 1,
              plannedArrival: input.plannedArrivalAt ?? null,
              status: 'PENDING',
            },
          ],
        },
        events: {
          create: [
            { type: 'CREATED', description: 'Trip created.' },
            { type: 'ASSIGNED', description: 'Truck and driver assigned.' },
          ],
        },
      },
      include: tripInclude,
    });

    await tx.truck.update({
      where: { id: input.truckId },
      data: { status: TruckStatus.ASSIGNED, currentTripId: created.id, currentDriverId: driverId },
    });
    await tx.driver.update({ where: { id: driverId }, data: { availability: 'ON_TRIP' } });

    if (orderId) {
      await tx.order.update({
        where: { id: orderId },
        data: {
          tripId: created.id,
          fleetOrganizationId: organizationId,
          assignedTruckId: input.truckId,
          assignedDriverId: driverId,
          status: OrderStatus.ASSIGNED,
        },
      });
    }

    return created;
  });

  notifyAsync({
    userId: driver.userId,
    organizationId,
    type: NotificationType.TRIP_ASSIGNED,
    title: 'New trip assigned',
    body: `${trip.reference}: ${trip.originAddress} → ${trip.destinationAddress}`,
    priority: NotificationPriority.HIGH,
    actionUrl: `/driver/trips/${trip.id}`,
  });

  await broadcastTripUpdate({
    tripId: trip.id,
    organizationId,
    orderId,
    truckId: trip.truckId,
    driverId,
    status: trip.status,
    updatedAt: trip.updatedAt.toISOString(),
  });

  return (await decorate([trip]))[0]!;
}

export async function updateTrip(
  auth: AuthContext,
  tripId: string,
  input: UpdateTripInput,
): Promise<TripSummary> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: tripInclude });
  if (!trip) throw errors.notFound('Trip');
  if (!auth.isPlatformAdmin && trip.organizationId !== auth.organizationId) {
    throw errors.notFound('Trip');
  }
  if (([TripStatus.COMPLETED, TripStatus.CANCELLED] as TripStatus[]).includes(trip.status)) {
    throw errors.businessRule('A completed or cancelled trip can no longer be edited.');
  }

  if (input.driverId && input.driverId !== trip.driverId) {
    const driver = await prisma.driver.findUnique({ where: { id: input.driverId } });
    if (!driver || driver.organizationId !== trip.organizationId) throw errors.notFound('Driver');
    if (driver.verificationStatus !== VerificationStatus.VERIFIED) {
      throw errors.businessRule('This driver has not completed verification yet.');
    }
    if (trip.status !== TripStatus.ASSIGNED && trip.status !== TripStatus.DRAFT) {
      throw errors.businessRule('The driver can only be changed before the trip starts.');
    }
  }

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: {
      ...(input.driverId !== undefined ? { driverId: input.driverId } : {}),
      ...(input.plannedStartAt !== undefined ? { plannedStartAt: input.plannedStartAt } : {}),
      ...(input.plannedArrivalAt !== undefined
        ? { plannedArrivalAt: input.plannedArrivalAt, etaAt: input.plannedArrivalAt }
        : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: tripInclude,
  });

  return (await decorate([updated]))[0]!;
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

export async function transitionTrip(
  auth: AuthContext,
  tripId: string,
  input: TripTransitionInput,
): Promise<TripSummary> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: tripInclude });
  if (!trip) throw errors.notFound('Trip');

  // A driver may drive their own trip; otherwise fleet management is required.
  const isTripDriver = auth.driverId !== null && trip.driverId === auth.driverId;
  if (!auth.isPlatformAdmin && !isTripDriver && trip.organizationId !== auth.organizationId) {
    throw errors.notFound('Trip');
  }

  const check = tripStateMachine.assertTransition(trip.status, input.status);
  if (!check.allowed) throw errors.invalidTransition(check.reason!);

  const now = new Date();
  const isStart = input.status === TripStatus.STARTED;
  const isArrival = input.status === TripStatus.ARRIVED;
  const isComplete = input.status === TripStatus.COMPLETED;
  const isCancel = input.status === TripStatus.CANCELLED;

  let delayMinutes = trip.delayMinutes;
  if (isArrival && trip.plannedArrivalAt) {
    delayMinutes = Math.max(
      0,
      Math.round((now.getTime() - trip.plannedArrivalAt.getTime()) / 60_000),
    );
  }

  const truckStatus = TRIP_STATUS_TO_TRUCK_STATUS[input.status];
  const orderStatus = TRIP_STATUS_TO_ORDER_STATUS[input.status];

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.trip.update({
      where: { id: tripId },
      data: {
        status: input.status,
        ...(isStart ? { actualStartAt: trip.actualStartAt ?? now } : {}),
        ...(isArrival ? { actualArrivalAt: now, delayMinutes } : {}),
        ...(isComplete
          ? {
              actualArrivalAt: trip.actualArrivalAt ?? now,
              actualDurationMin: trip.actualStartAt
                ? Math.round((now.getTime() - trip.actualStartAt.getTime()) / 60_000)
                : null,
            }
          : {}),
        ...(isCancel ? { cancellationReason: input.note ?? 'Cancelled.' } : {}),
      },
      include: tripInclude,
    });

    await tx.tripEvent.create({
      data: {
        tripId,
        type: isStart
          ? 'DEPARTED'
          : isArrival
            ? 'ARRIVED'
            : isComplete
              ? 'COMPLETED'
              : isCancel
                ? 'CANCELLED'
                : 'STATUS_CHANGED',
        description:
          input.note ?? `Trip moved from ${trip.status} to ${input.status}.`,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        metadata: { from: trip.status, to: input.status } as never,
        actorUserId: auth.user.id,
      },
    });

    if (truckStatus) {
      await tx.truck.update({
        where: { id: trip.truckId },
        data: {
          status: truckStatus,
          ...(isComplete || isCancel ? { currentTripId: null } : { currentTripId: tripId }),
        },
      });
    }

    if (trip.driverId && (isComplete || isCancel)) {
      await tx.driver.update({
        where: { id: trip.driverId },
        data: {
          availability: 'AVAILABLE',
          ...(isComplete
            ? {
                totalTrips: { increment: 1 },
                totalDistanceKm: { increment: next.actualDistanceKm },
              }
            : {}),
        },
      });
    }

    if (isArrival) {
      await tx.tripStop.updateMany({
        where: { tripId, type: 'DESTINATION' },
        data: { status: 'ARRIVED', actualArrival: now },
      });
    }
    if (isStart) {
      await tx.tripStop.updateMany({
        where: { tripId, type: 'ORIGIN' },
        data: { status: 'DEPARTED', actualDeparture: now, actualArrival: now },
      });
    }

    if (trip.order && orderStatus) {
      await tx.order.update({
        where: { id: trip.order.id },
        data: {
          status: orderStatus,
          ...(orderStatus === OrderStatus.DELIVERED ? { deliveredAt: now } : {}),
        },
      });
    }
    if (trip.order && isCancel) {
      await tx.order.update({
        where: { id: trip.order.id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: now,
          cancellationReason: input.note ?? 'Trip cancelled by the fleet.',
        },
      });
    }

    // Completing the trip records the timeliness signal on the driver's score.
    if (isComplete && trip.driverId) {
      const onTime = delayMinutes === 0;
      await tx.driverScoreEvent.create({
        data: {
          driverId: trip.driverId,
          eventType: onTime ? 'TRIP_COMPLETED_ON_TIME' : 'TRIP_COMPLETED_LATE',
          category: 'TIMELINESS',
          points: onTime ? 3 : -4,
          reason: onTime
            ? `Trip ${trip.reference} delivered on time.`
            : `Trip ${trip.reference} arrived ${delayMinutes} minutes late.`,
          sourceType: 'TRIP',
          sourceId: tripId,
        },
      });
    }

    return next;
  });

  if (isComplete) {
    /*
     * What the journey cost in fuel, worked out from the engine's own readings.
     *
     * Outside the transaction on purpose. It reads a window of telemetry, which
     * is a heavier query than anything in the completion path, and a trip must
     * complete whether or not its fuel can be established — a driver at the end
     * of a shift cannot be blocked by a reporting figure.
     */
    await recordTripFuel(tripId);
  }

  if (isComplete && trip.driverId) {
    await recalculateDriverScore(trip.driverId);
    await evaluateAndAwardAchievements(trip.driverId);
  }

  await broadcastTripUpdate({
    tripId,
    organizationId: trip.organizationId,
    orderId: trip.order?.id ?? null,
    truckId: trip.truckId,
    driverId: trip.driverId,
    status: input.status,
    updatedAt: updated.updatedAt.toISOString(),
  });

  await broadcastTripEvent(
    {
      tripId,
      eventId: `${tripId}-${Date.now()}`,
      type: input.status,
      description: input.note ?? `Trip is now ${input.status.toLowerCase().replace(/_/g, ' ')}.`,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      createdAt: now.toISOString(),
    },
    trip.organizationId,
  );

  if (truckStatus) {
    await broadcastTruckStatus({
      truckId: trip.truckId,
      organizationId: trip.organizationId,
      status: truckStatus,
      driverId: trip.driverId,
      tripId: isComplete || isCancel ? null : tripId,
      updatedAt: now.toISOString(),
    });
  }

  // Keep the customer informed at the moments that matter to them.
  if (trip.order && (isStart || isComplete || isArrival)) {
    void notifyOrganization(trip.order.customerOrganizationId, {
      type: isStart
        ? NotificationType.TRIP_STARTED
        : isComplete
          ? NotificationType.ORDER_DELIVERED
          : NotificationType.TRIP_COMPLETED,
      title: isStart
        ? 'Your delivery is on the way'
        : isArrival
          ? 'Your delivery has arrived'
          : 'Delivery completed',
      body: `${trip.order.reference}: ${trip.originAddress} → ${trip.destinationAddress}`,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/orders/${trip.order.id}`,
    });
  }

  return (await decorate([updated]))[0]!;
}

/** Trips currently in flight for a fleet — powers the live command centre. */
export async function activeTrips(organizationId: string): Promise<TripSummary[]> {
  const trips = await prisma.trip.findMany({
    where: { organizationId, status: { in: ACTIVE_TRIP_STATUSES } },
    include: tripInclude,
    orderBy: { actualStartAt: 'desc' },
    take: 200,
  });
  return decorate(trips);
}

/** The driver's own current trip, used by the driver app home screen. */
export async function currentTripForDriver(driverId: string): Promise<TripSummary | null> {
  const trip = await prisma.trip.findFirst({
    where: { driverId, status: { in: ACTIVE_TRIP_STATUSES } },
    include: tripInclude,
    orderBy: { createdAt: 'desc' },
  });
  if (!trip) return null;
  return (await decorate([trip]))[0]!;
}
