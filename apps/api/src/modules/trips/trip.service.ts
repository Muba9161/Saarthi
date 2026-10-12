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
  TerminalSessionStatus,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { notifyAsync, notifyOrganization } from '../notifications/notification.service';
import { broadcastTripEvent, broadcastTripUpdate, broadcastTruckStatus } from '../../realtime/realtime.service';
import { recordTripFuel } from './trip-fuel.service';
import { recalculateDriverScore, evaluateAndAwardAchievements } from '../drivers/driver.service';
import { releaseVehicleFromAdHocTrip } from '../terminal/adhoc-trip.service';
import { holdsRealTrip, promoteQueuedDriverTrip, yieldDriverTripToFleet } from './trip-queue.service';
import type { AuthContext } from '../../auth/context';
import { loadingBlockedReason } from '../marketplace-finance/order-finance.service';
import { onTripCompleted } from '../return-loads/backhaul.service';
import {
  decorate,
  routePoints,
  tripInclude,
  viewerParty,
  type TripRecord,
  type TripSummary,
} from './trip.view';

export type { TripSummary } from './trip.view';

/**
 * Trip lifecycle.
 *
 * The trip is where an order becomes a physical movement. Status changes are
 * validated against the shared state machine and then cascaded consistently:
 * the truck's status, the driver's availability and the order's status all
 * follow from the trip, so the three can never disagree.
 */

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
    items: await decorate(trips, viewerParty(auth)),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getTrip(auth: AuthContext, tripId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: tripInclude });
  if (!trip) throw errors.notFound('Trip');
  assertTripAccess(auth, trip);

  const [summary] = await decorate([trip], viewerParty(auth));
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
      reachedAt: stop.reachedAt?.toISOString() ?? null,
      leftAt: stop.leftAt?.toISOString() ?? null,
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

export interface CreateTripOptions {
  /**
   * The signed-on driver is raising this trip from the driver app. It queues
   * behind a fleet trip already open on the vehicle instead of being refused,
   * and the fleet — not the driver — is told about it.
   */
  driverCreated?: boolean;
}

export async function createTrip(
  auth: AuthContext,
  organizationId: string,
  input: CreateTripInput,
  options: CreateTripOptions = {},
): Promise<TripSummary> {
  const driverCreated = options.driverCreated === true;
  const truck = await prisma.truck.findUnique({ where: { id: input.truckId } });
  if (!truck || truck.organizationId !== organizationId) throw errors.notFound('Vehicle');
  if (truck.archivedAt) throw errors.businessRule('This vehicle is archived.');

  // A driver trip made while a real trip holds the vehicle waits its turn.
  const queued = driverCreated && (await holdsRealTrip(truck.currentTripId));

  if (!queued && !ASSIGNABLE_TRUCK_STATUSES.includes(truck.status as TruckStatus)) {
    throw errors.businessRule(
      `${truck.registrationNumber} is ${truck.status.toLowerCase().replace(/_/g, ' ')} and cannot start a new trip.`,
    );
  }
  if (truck.currentTripId && !queued) {
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
    const released =
      (await releaseVehicleFromAdHocTrip(
        input.truckId,
        'Closed automatically: the vehicle was dispatched on a new trip.',
      )) ||
      // The fleet comes first: a driver trip that has not moved goes back to
      // the queue rather than blocking the dispatch.
      (!driverCreated && (await yieldDriverTripToFleet(input.truckId, truck.currentTripId)));
    if (!released) {
      throw errors.conflict('This vehicle is already on an active trip.');
    }
  }

  const driverId = input.driverId ?? truck.currentDriverId;
  if (!driverId) {
    throw errors.businessRule('Assign a driver to this vehicle before creating a trip.');
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
        status: queued ? TripStatus.DRAFT : TripStatus.ASSIGNED,
        price: input.price ?? null,
        notes: input.notes ?? null,
        driverCreated,
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
          create: queued
            ? [
                { type: 'CREATED', description: 'Trip added by the driver.' },
                {
                  type: 'STATUS_CHANGED',
                  description: 'Queued: it starts once the trip on this vehicle is finished.',
                },
              ]
            : [
                {
                  type: 'CREATED',
                  description: driverCreated ? 'Trip added by the driver.' : 'Trip created.',
                },
                { type: 'ASSIGNED', description: 'Vehicle and driver assigned.' },
              ],
        },
      },
      include: tripInclude,
    });

    // A queued trip does not hold the vehicle yet; the trip it waits behind does.
    if (!queued) {
      await tx.truck.update({
        where: { id: input.truckId },
        data: { status: TruckStatus.ASSIGNED, currentTripId: created.id, currentDriverId: driverId },
      });
      await tx.driver.update({ where: { id: driverId }, data: { availability: 'ON_TRIP' } });
    }

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

  if (driverCreated) {
    // The driver made it, so the driver needs no telling — the office does.
    void notifyOrganization(organizationId, {
      type: NotificationType.TRIP_ASSIGNED,
      title: queued ? 'Driver queued a trip' : 'Driver added a trip',
      body: `${truck.registrationNumber} · ${trip.reference}: ${trip.originAddress} → ${trip.destinationAddress}`,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/trips/${trip.id}`,
    });
  } else {
    notifyAsync({
      userId: driver.userId,
      organizationId,
      type: NotificationType.TRIP_ASSIGNED,
      title: 'New trip assigned',
      body: `${trip.reference}: ${trip.originAddress} → ${trip.destinationAddress}`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/driver/trips/${trip.id}`,
    });
  }

  await broadcastTripUpdate({
    tripId: trip.id,
    organizationId,
    orderId,
    truckId: trip.truckId,
    driverId,
    status: trip.status,
    updatedAt: trip.updatedAt.toISOString(),
  });

  return (await decorate([trip], viewerParty(auth)))[0]!;
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

  /*
   * Re-pointing the job at another vehicle.
   *
   * Held to the same rules a fresh dispatch is — the vehicle has to be this
   * fleet's, usable, and not already carrying a live trip — and only before
   * departure, because telemetry, fuel and distance already banked against the
   * first vehicle cannot be moved with it.
   */
  const movingVehicle = Boolean(input.truckId && input.truckId !== trip.truckId);
  if (movingVehicle) {
    if (trip.status !== TripStatus.ASSIGNED && trip.status !== TripStatus.DRAFT) {
      throw errors.businessRule('The vehicle can only be changed before the trip starts.');
    }

    const truck = await prisma.truck.findUnique({ where: { id: input.truckId! } });
    if (!truck || truck.organizationId !== trip.organizationId) throw errors.notFound('Vehicle');
    if (truck.archivedAt) throw errors.businessRule('This vehicle is archived.');
    if (!ASSIGNABLE_TRUCK_STATUSES.includes(truck.status as TruckStatus)) {
      throw errors.businessRule(
        `${truck.registrationNumber} is ${truck.status.toLowerCase().replace(/_/g, ' ')} and cannot take this trip.`,
      );
    }
    if (truck.currentTripId && truck.currentTripId !== trip.id) {
      // Same reasoning as a fresh dispatch: a service run is not a reason to
      // refuse work, so it is closed out rather than standing in the way.
      const released = await releaseVehicleFromAdHocTrip(
        input.truckId!,
        'Closed automatically: the vehicle was dispatched on a new trip.',
      );
      if (!released) throw errors.conflict('This vehicle is already on an active trip.');
    }
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

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.trip.update({
      where: { id: tripId },
      data: {
        ...(movingVehicle ? { truckId: input.truckId } : {}),
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

    if (movingVehicle) {
      // Hand the job over: the vehicle that was holding it goes back to the
      // yard, and the new one picks it up. Guarded on `currentTripId` so a
      // vehicle already reassigned elsewhere is not freed by accident.
      await tx.truck.updateMany({
        where: { id: trip.truckId, currentTripId: trip.id },
        data: { status: TruckStatus.AVAILABLE, currentTripId: null },
      });
      await tx.truck.update({
        where: { id: input.truckId! },
        data: {
          status: TruckStatus.ASSIGNED,
          currentTripId: trip.id,
          ...(next.driverId ? { currentDriverId: next.driverId } : {}),
        },
      });
      await tx.tripEvent.create({
        data: {
          tripId: trip.id,
          type: 'ASSIGNED',
          description: 'Reassigned to another vehicle.',
        },
      });
    }

    return next;
  });

  return (await decorate([updated], viewerParty(auth)))[0]!;
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

/** When the vehicle's GPS shows it reached the destination, if it has. */
async function gpsArrivalAt(tripId: string): Promise<Date | null> {
  const destination = await prisma.tripStop.findFirst({
    where: { tripId, type: 'DESTINATION', reachedAt: { not: null } },
    select: { reachedAt: true },
  });
  return destination?.reachedAt ?? null;
}

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

  // A marketplace order is loaded only once the money for it is in: the
  // customer's 30% and the supplier's payment for the material.
  if (input.status === TripStatus.LOADING || input.status === TripStatus.STARTED) {
    const order = await prisma.order.findFirst({ where: { tripId }, select: { id: true } });
    const blocked = await loadingBlockedReason(order?.id ?? null);
    if (blocked) throw errors.businessRule(blocked);
  }

  const now = new Date();
  const isStart = input.status === TripStatus.STARTED;
  const isArrival = input.status === TripStatus.ARRIVED;
  const isComplete = input.status === TripStatus.COMPLETED;
  const isCancel = input.status === TripStatus.CANCELLED;

  /*
   * A queued (DRAFT) trip does not hold the vehicle. Cancelling it must not free
   * the vehicle from the trip it was waiting behind, and assigning it needs the
   * vehicle to be free first.
   */
  const waiting = trip.status === TripStatus.DRAFT;
  if (waiting && input.status === TripStatus.ASSIGNED) {
    const truck = await prisma.truck.findUnique({
      where: { id: trip.truckId },
      select: { currentTripId: true },
    });
    if (truck?.currentTripId && truck.currentTripId !== trip.id) {
      if (await holdsRealTrip(truck.currentTripId)) {
        throw errors.conflict(
          'This vehicle is still on another trip. The queued trip can start once that one is finished.',
        );
      }
      await releaseVehicleFromAdHocTrip(
        trip.truckId,
        'Closed automatically: a queued trip was assigned to the vehicle.',
      );
    }
  }
  const touchesVehicle = !(waiting && isCancel);

  /*
   * When the vehicle actually got there.
   *
   * The GPS time when it has one — the driver usually confirms a few minutes
   * after pulling in, and sometimes much later — so the arrival, the delay and
   * the stop all carry the real time rather than the moment of the tap.
   */
  const arrivedAt = isArrival ? ((await gpsArrivalAt(tripId)) ?? now) : now;

  let delayMinutes = trip.delayMinutes;
  if (isArrival && trip.plannedArrivalAt) {
    delayMinutes = Math.max(
      0,
      Math.round((arrivedAt.getTime() - trip.plannedArrivalAt.getTime()) / 60_000),
    );
  }
  // Another navigation app guides only while the vehicle is still on its way.
  const endsHandoff = (isArrival || isComplete || isCancel) && trip.externalNavigation !== null;

  const truckStatus = TRIP_STATUS_TO_TRUCK_STATUS[input.status];
  const orderStatus = TRIP_STATUS_TO_ORDER_STATUS[input.status];

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.trip.update({
      where: { id: tripId },
      data: {
        status: input.status,
        ...(isStart ? { actualStartAt: trip.actualStartAt ?? now } : {}),
        ...(isArrival ? { actualArrivalAt: arrivedAt, delayMinutes } : {}),
        ...(endsHandoff ? { externalNavigation: null, externalNavigationSince: null } : {}),
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

    if (truckStatus && touchesVehicle) {
      await tx.truck.update({
        where: { id: trip.truckId },
        data: {
          status: truckStatus,
          ...(isComplete || isCancel ? { currentTripId: null } : { currentTripId: tripId }),
        },
      });
    }

    /*
     * A trip can be finished from two places, and both have to agree.
     *
     * The terminal's own `completeTrip` returns the driver's session from
     * TRIP_ACTIVE to READY — still signed on to the vehicle, no longer driving.
     * A dispatcher closing the same trip from the web went through this service
     * instead, which never touched the session, so it stayed TRIP_ACTIVE for
     * ever: the driver's dashboard said "Trip under way" while the panel below
     * it said "No active trip", and nothing but signing off would clear it.
     *
     * Scoped to this vehicle's currently-driving session, so a dispatcher
     * closing an old trip cannot interrupt a driver who has since signed on and
     * started another one. `updateMany` matching nothing is the right outcome
     * there, not an error.
     */
    if ((isComplete || isCancel) && touchesVehicle) {
      await tx.terminalSession.updateMany({
        where: {
          vehicleId: trip.truckId,
          status: TerminalSessionStatus.TRIP_ACTIVE,
          ...(trip.driverId ? { driverId: trip.driverId } : {}),
        },
        data: { status: TerminalSessionStatus.READY, tripCompletedAt: now },
      });
    }

    if (trip.driverId && (isComplete || isCancel) && touchesVehicle) {
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
        data: { status: 'ARRIVED', actualArrival: arrivedAt },
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

  if (truckStatus && touchesVehicle) {
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

  // The owner is offered a backhaul for the way home, or a return leg closes
  // its backhaul. Never throws, so it cannot undo a completion.
  if (isComplete) await onTripCompleted(tripId);

  // The vehicle is free: a trip the driver queued behind this one is next.
  if ((isComplete || isCancel) && touchesVehicle) await promoteQueuedDriverTrip(trip.truckId);

  return (await decorate([updated], viewerParty(auth)))[0]!;
}

/** Trips currently in flight for a fleet — powers the live command centre. */
export async function activeTrips(organizationId: string): Promise<TripSummary[]> {
  const trips = await prisma.trip.findMany({
    where: { organizationId, status: { in: ACTIVE_TRIP_STATUSES } },
    include: tripInclude,
    orderBy: { actualStartAt: 'desc' },
    take: 200,
  });
  // The operating fleet's own live board.
  return decorate(trips, 'FLEET_OWNER');
}

/** The driver's own current trip, used by the driver app home screen. */
export async function currentTripForDriver(driverId: string): Promise<TripSummary | null> {
  const trip = await prisma.trip.findFirst({
    where: { driverId, status: { in: ACTIVE_TRIP_STATUSES } },
    include: tripInclude,
    orderBy: { createdAt: 'desc' },
  });
  if (!trip) return null;
  return (await decorate([trip], 'DRIVER'))[0]!;
}
