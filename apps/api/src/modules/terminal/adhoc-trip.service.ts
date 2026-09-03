import {
  NotificationPriority,
  NotificationType,
  TripStatus,
  distanceKm,
  pathLength,
  type AdHocTripSummary,
  type AdHocTripView,
  type FinishAdHocTripInput,
  type LatLng,
  type StartAdHocTripInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { broadcastTripEvent, broadcastTripUpdate } from '../../realtime/realtime.service';
import { notifyOrganization } from '../notifications/notification.service';
import { applyOdometer } from '../vehicles/odometer.service';
import type { SessionRecord } from './session.view';

/**
 * Trips nobody dispatched.
 *
 * The gap this closes is simple to state and was expensive to leave open: a
 * driver whose vehicle has no assigned trip still drives it. They fetch diesel,
 * they take it to a workshop, they cross a weighbridge — and every one of those
 * runs covered real distance, at real speeds, with real braking, and produced
 * no record whatsoever. The odometer moved and nothing said so; the fleet's
 * distance figures were short by however far its vehicles wandered between
 * jobs.
 *
 * So the terminal opens a trip when the driver chooses a destination from the
 * nearby-services list, and closes it when the vehicle gets there.
 *
 * **It is a real `Trip`.** Not a parallel "service run" table, and this is the
 * single most important decision in the file. `ingestLocation` already computes
 * distance covered, promotes a started trip to in-transit, raises harsh-braking
 * and speeding events against the driver's score and broadcasts progress to the
 * fleet map — but only for a vehicle with a `currentTripId`. Giving the run a
 * trip row means every one of those behaviours arrives for free and stays
 * correct, where a second kind of movement would have to be taught to the
 * tracking pipeline, the analytics, the driver score and the dashboard one at a
 * time, and would drift out of step with the first kind within a release.
 *
 * What the flag on the row buys is the ability to tell the two apart afterwards:
 * a fleet reporting on delivered work does not want the diesel run in the
 * numbers, and — the operational half — `createTrip` closes an open service run
 * rather than refusing a dispatch because the truck was "already on a trip"
 * while it queued at a pump.
 */

const adHocLogger = logger.child({ module: 'terminal-adhoc-trip' });

/**
 * How close counts as arrived.
 *
 * Generous on purpose. A petrol pump is mapped as a point somewhere on a
 * forecourt, a workshop as a point on a building, and a truck parks where it
 * fits — thirty metres from the pin is normal and eighty is not unusual. The
 * terminal is the one that decides arrival for the driver's benefit; this is the
 * server's own backstop for a run the terminal never closed.
 */
const ARRIVAL_RADIUS_METERS = 120;

/**
 * A service run left open longer than any of them last.
 *
 * A terminal that lost power at a pump, or a tablet unplugged mid-run, would
 * otherwise leave a trip open against the vehicle for ever — and a vehicle with
 * an open trip cannot be dispatched. Anything past this is closed on the next
 * touch rather than waiting for a sweep job.
 */
const STALE_RUN_MS = 12 * 60 * 60 * 1000;

type TripRow = Awaited<ReturnType<typeof prisma.trip.findFirst>>;

function toView(trip: NonNullable<TripRow>): AdHocTripView {
  return {
    id: trip.id,
    reference: trip.reference,
    status: trip.status,
    destinationName: trip.destinationAddress,
    destinationLatitude: trip.destinationLatitude,
    destinationLongitude: trip.destinationLongitude,
    plannedDistanceKm: trip.plannedDistanceKm,
    actualDistanceKm: trip.actualDistanceKm,
    startedAt: (trip.actualStartAt ?? trip.createdAt).toISOString(),
    startOdometerKm: trip.startOdometerKm,
  };
}

/**
 * The trip reference.
 *
 * Deliberately the same `TR-` series as a dispatched trip rather than a
 * separate one. A driver reading a reference to a controller over a phone
 * should not have to explain which of two numbering schemes they are looking
 * at, and the `adHoc` flag already carries the distinction for anything that
 * needs it.
 *
 * `count()` is racy under concurrency — two runs opening in the same
 * millisecond would compute the same number — so a collision on the unique
 * index is retried rather than surfaced. This mirrors `nextReference` in
 * `trip.service.ts`; the retry is here because a terminal opening a trip
 * unattended has nobody to press the button again.
 */
async function nextReference(attempt = 0): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.trip.count();
  return `TR-${year}-${String(count + 1 + attempt).padStart(5, '0')}`;
}

/** The service run currently open on a vehicle, if there is one. */
export async function openAdHocTripForVehicle(vehicleId: string): Promise<TripRow> {
  return prisma.trip.findFirst({
    where: {
      truckId: vehicleId,
      adHoc: true,
      status: { in: [TripStatus.STARTED, TripStatus.IN_TRANSIT, TripStatus.ARRIVED] },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Close a service run that has been open too long to be real.
 *
 * Called on the paths that would otherwise be blocked by one. Returns true when
 * something was closed, so the caller can proceed as though the vehicle were
 * free — which, twelve hours after the driver set off for a petrol pump, it is.
 */
async function closeIfStale(trip: NonNullable<TripRow>): Promise<boolean> {
  const startedAt = trip.actualStartAt ?? trip.createdAt;
  if (Date.now() - startedAt.getTime() < STALE_RUN_MS) return false;

  await settle(trip, {
    status: TripStatus.COMPLETED,
    reason: 'Closed automatically: the terminal never reported arriving.',
    summary: null,
    position: null,
  });
  adHocLogger.info({ tripId: trip.id }, 'Stale service run closed');
  return true;
}

/**
 * Release a vehicle from an open service run so a real trip can be dispatched.
 *
 * Exported for `createTrip`, which used to refuse outright when a truck had a
 * `currentTripId`. With service runs in play that refusal would fire whenever a
 * dispatcher assigned work to a vehicle whose driver had nipped out for diesel
 * — a new failure mode created by this feature, and one the fleet could do
 * nothing about from the dashboard. Closing the run instead is both what the
 * dispatcher meant and what actually happened on the road.
 */
export async function releaseVehicleFromAdHocTrip(
  vehicleId: string,
  reason: string,
): Promise<boolean> {
  const open = await openAdHocTripForVehicle(vehicleId);
  if (!open) return false;

  await settle(open, {
    status: TripStatus.COMPLETED,
    reason,
    summary: null,
    position: null,
  });
  return true;
}

/**
 * Open a trip for a run to a nearby service.
 *
 * Idempotent per destination: a driver who taps the same pump twice, or whose
 * terminal retried through a dropped connection, gets the trip that is already
 * open rather than a second one. A driver who picks a *different* destination
 * mid-run gets the first run closed and a new one opened, because that is what
 * changing your mind about where you are going is.
 *
 * Returns null — never an error — when the vehicle already has a dispatched
 * trip. The whole feature is "record the journeys that would otherwise go
 * unrecorded", and a vehicle on a real trip is already being recorded. Failing
 * here would break navigation for the ordinary case to serve the exceptional
 * one.
 */
export async function startAdHocTrip(
  session: SessionRecord,
  input: StartAdHocTripInput,
): Promise<AdHocTripView | null> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: session.vehicleId },
    select: {
      id: true,
      organizationId: true,
      registrationNumber: true,
      currentTripId: true,
      currentDriverId: true,
      odometerKm: true,
      archivedAt: true,
    },
  });
  if (!vehicle) throw errors.notFound('Vehicle');
  if (vehicle.archivedAt) return null;

  const found = await openAdHocTripForVehicle(vehicle.id);
  // A run older than any real one is a terminal that lost power mid-journey.
  // Closed here rather than by a sweep, because this is the moment it is in the
  // way: the vehicle is about to set off somewhere else.
  const existing = found && (await closeIfStale(found)) ? null : found;

  if (existing) {
    const sameDestination =
      distanceKm(
        {
          latitude: existing.destinationLatitude,
          longitude: existing.destinationLongitude,
        },
        { latitude: input.toLatitude, longitude: input.toLongitude },
      ) * 1000 <
      ARRIVAL_RADIUS_METERS;

    // Same place, still going: hand back the run that is already open rather
    // than opening a second one against the same journey.
    if (sameDestination) return toView(existing);

    await settle(existing, {
      status: TripStatus.CANCELLED,
      reason: 'The driver chose a different destination.',
      summary: null,
      position: { latitude: input.fromLatitude, longitude: input.fromLongitude },
    });
  }

  // A dispatched trip is already recording this journey. Nothing to add.
  if (vehicle.currentTripId && !existing) {
    const dispatched = await prisma.trip.findUnique({
      where: { id: vehicle.currentTripId },
      select: { id: true, adHoc: true, status: true },
    });
    if (dispatched && !dispatched.adHoc) return null;
  }

  const origin: LatLng = { latitude: input.fromLatitude, longitude: input.fromLongitude };
  const destination: LatLng = { latitude: input.toLatitude, longitude: input.toLongitude };
  const route = (input.route ?? [origin, destination]) as LatLng[];

  const plannedDistance =
    input.plannedDistanceKm ??
    (route.length > 2 ? pathLength(route) / 1000 : distanceKm(origin, destination));

  const now = new Date();
  const created = await createWithReference(async (reference) =>
    prisma.$transaction(async (tx) => {
      const trip = await tx.trip.create({
        data: {
          reference,
          organizationId: vehicle.organizationId,
          truckId: vehicle.id,
          driverId: session.driverId,
          adHoc: true,
          originAddress: input.originName ?? 'Where the vehicle set off',
          originLatitude: input.fromLatitude,
          originLongitude: input.fromLongitude,
          destinationAddress: input.destinationName,
          destinationLatitude: input.toLatitude,
          destinationLongitude: input.toLongitude,
          plannedRoute: route as never,
          plannedDistanceKm: Number(plannedDistance.toFixed(2)),
          plannedDurationMin:
            input.plannedDurationMinutes ?? Math.max(1, Math.round((plannedDistance / 40) * 60)),
          // STARTED, not ASSIGNED: the vehicle is already moving. The tracking
          // pipeline promotes it to IN_TRANSIT on the first fix above 5 km/h,
          // exactly as it does for a dispatched trip.
          status: TripStatus.STARTED,
          actualStartAt: now,
          plannedStartAt: now,
          startOdometerKm: input.odometerKm ?? vehicle.odometerKm,
          createdById: session.driverUserId,
          notes: input.service
            ? `Service run started from the terminal (${input.service}).`
            : 'Service run started from the terminal.',
          stops: {
            create: [
              {
                type: 'ORIGIN',
                name: input.originName ?? 'Setting off',
                latitude: input.fromLatitude,
                longitude: input.fromLongitude,
                sequence: 0,
                status: 'DEPARTED',
                actualArrival: now,
              },
              {
                type: 'DESTINATION',
                name: input.destinationName,
                latitude: input.toLatitude,
                longitude: input.toLongitude,
                sequence: 1,
                status: 'PENDING',
              },
            ],
          },
          events: {
            create: [
              {
                type: 'CREATED',
                description: `Service run to ${input.destinationName}, started from the terminal.`,
                latitude: input.fromLatitude,
                longitude: input.fromLongitude,
                actorUserId: session.driverUserId,
              },
              {
                type: 'DEPARTED',
                description: 'Vehicle set off.',
                latitude: input.fromLatitude,
                longitude: input.fromLongitude,
              },
            ],
          },
        },
      });

      /*
       * The truck points at the run, but its *status* is left alone.
       *
       * `currentTripId` is what makes the tracking pipeline attribute positions,
       * distance and harsh-driving events to this journey, and without it the
       * whole exercise records nothing. `status`, on the other hand, is what the
       * fleet reads to decide whether a vehicle can take work — and a truck that
       * showed as ASSIGNED because its driver went for diesel would drop out of
       * dispatch for reasons nobody could see from the dashboard.
       */
      await tx.truck.update({
        where: { id: vehicle.id },
        data: {
          currentTripId: trip.id,
          ...(vehicle.currentDriverId ? {} : { currentDriverId: session.driverId }),
        },
      });

      return trip;
    }),
  );

  await broadcastTripUpdate({
    tripId: created.id,
    organizationId: created.organizationId,
    orderId: null,
    truckId: created.truckId,
    driverId: created.driverId,
    status: created.status,
    updatedAt: created.updatedAt.toISOString(),
  });

  adHocLogger.info(
    {
      tripId: created.id,
      vehicleId: vehicle.id,
      destination: input.destinationName,
      plannedDistanceKm: created.plannedDistanceKm,
    },
    'Service run opened from a terminal',
  );

  return toView(created);
}

/**
 * Close the run, with what it added up to.
 *
 * Called on arrival and on the driver cancelling navigation. Both keep the
 * figures: a cancelled run is still a journey the vehicle made, and throwing
 * away its distance because the driver changed their mind would reintroduce
 * exactly the gap this whole file exists to close. Only the closing status
 * differs, so a fleet can tell "went and came back" from "set off and turned
 * around".
 */
export async function finishAdHocTrip(
  session: SessionRecord,
  input: FinishAdHocTripInput,
): Promise<AdHocTripView | null> {
  const trip = input.tripId
    ? await prisma.trip.findFirst({
        where: { id: input.tripId, truckId: session.vehicleId, adHoc: true },
      })
    : await openAdHocTripForVehicle(session.vehicleId);

  if (!trip) return null;

  // Already closed — a retried request, or the driver cancelling a run the
  // arrival check had just completed. Idempotent, not an error.
  if (
    trip.status === TripStatus.COMPLETED ||
    trip.status === TripStatus.CANCELLED
  ) {
    return toView(trip);
  }

  const summary: AdHocTripSummary = {
    distanceKm: input.distanceKm ?? null,
    topSpeedKph: input.topSpeedKph ?? null,
    averageSpeedKph: input.averageSpeedKph ?? null,
    harshBrakingCount: input.harshBrakingCount,
    harshAccelerationCount: input.harshAccelerationCount,
    odometerKm: input.odometerKm ?? null,
  };

  const settled = await settle(trip, {
    status: input.cancelled ? TripStatus.CANCELLED : TripStatus.COMPLETED,
    reason:
      input.reason ??
      (input.cancelled
        ? 'The driver stopped navigating before arriving.'
        : `Arrived at ${trip.destinationAddress}.`),
    summary,
    position:
      input.latitude !== undefined && input.longitude !== undefined
        ? { latitude: input.latitude, longitude: input.longitude }
        : null,
  });

  return toView(settled);
}

/**
 * Write the ending.
 *
 * One path for every way a run can finish — arrival, cancellation, a stale run
 * swept up, a dispatcher needing the vehicle — because the bookkeeping is the
 * same in all four and the version that had four copies of it would eventually
 * have four different ideas about whether to release `currentTripId`.
 */
async function settle(
  trip: NonNullable<TripRow>,
  options: {
    status: typeof TripStatus.COMPLETED | typeof TripStatus.CANCELLED;
    reason: string;
    summary: AdHocTripSummary | null;
    position: LatLng | null;
  },
): Promise<NonNullable<TripRow>> {
  const now = new Date();
  const startedAt = trip.actualStartAt ?? trip.createdAt;
  const durationMin = Math.max(1, Math.round((now.getTime() - startedAt.getTime()) / 60_000));

  /*
   * The longer of the two distances, not the terminal's.
   *
   * The tracking pipeline measures from the fixes it received; the terminal
   * measures from the fixes it took, including the ones it was still holding in
   * its buffer when this request went out. They measure the same journey with
   * different gaps, and the shorter figure is the one that missed something.
   */
  const measured = Math.max(trip.actualDistanceKm, options.summary?.distanceKm ?? 0);

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.trip.update({
      where: { id: trip.id },
      data: {
        status: options.status,
        actualArrivalAt: options.status === TripStatus.COMPLETED ? now : null,
        actualDurationMin: durationMin,
        actualDistanceKm: Number(measured.toFixed(2)),
        etaAt: null,
        ...(options.summary
          ? {
              topSpeedKph: options.summary.topSpeedKph,
              averageSpeedKph: options.summary.averageSpeedKph,
              harshBrakingCount: options.summary.harshBrakingCount,
              harshAccelerationCount: options.summary.harshAccelerationCount,
            }
          : {}),
        ...(options.status === TripStatus.CANCELLED
          ? { cancellationReason: options.reason }
          : {}),
      },
    });

    await tx.tripStop.updateMany({
      where: { tripId: trip.id, type: 'DESTINATION' },
      data:
        options.status === TripStatus.COMPLETED
          ? { status: 'ARRIVED', actualArrival: now }
          : { status: 'SKIPPED' },
    });

    await tx.tripEvent.create({
      data: {
        tripId: trip.id,
        type: options.status === TripStatus.COMPLETED ? 'ARRIVED' : 'CANCELLED',
        description: options.reason,
        latitude: options.position?.latitude ?? null,
        longitude: options.position?.longitude ?? null,
        metadata: options.summary
          ? {
              distanceKm: Number(measured.toFixed(2)),
              topSpeedKph: options.summary.topSpeedKph,
              averageSpeedKph: options.summary.averageSpeedKph,
              harshBrakingCount: options.summary.harshBrakingCount,
              harshAccelerationCount: options.summary.harshAccelerationCount,
            }
          : undefined,
      },
    });

    // Release the vehicle, but only from *this* run. `updateMany` with the trip
    // id in the predicate means a truck that has since been given a real trip
    // is left pointing at it rather than being cleared out from under the
    // dispatcher.
    await tx.truck.updateMany({
      where: { id: trip.truckId, currentTripId: trip.id },
      data: { currentTripId: null },
    });

    return next;
  });

  /*
   * The odometer, last and outside the transaction.
   *
   * Deliberately not folded into the writes above: the odometer belongs to the
   * *vehicle*, not to this trip, and it must land whether or not anything else
   * here succeeded. `applyOdometer` is also where the monotonic rule lives, and
   * having exactly one place that can move a vehicle's odometer is what keeps a
   * reinstalled terminal from winding back a service interval.
   *
   * Only the terminal's *absolute* reading is offered, never the run's distance.
   * `ingestLocation` has already advanced the odometer fix by fix while this run
   * was open, so adding the total again at the end would count every kilometre
   * twice. `applyOdometer` returns the vehicle's figure either way, which is
   * what the trip records as its closing reading.
   */
  const endOdometer = await applyOdometer({
    vehicleId: trip.truckId,
    odometerKm: options.summary?.odometerKm ?? null,
    reason: 'terminal-service-run',
  });

  if (endOdometer !== null) {
    await prisma.trip.update({
      where: { id: trip.id },
      data: { endOdometerKm: endOdometer },
    });
  }

  await broadcastTripUpdate({
    tripId: updated.id,
    organizationId: updated.organizationId,
    orderId: null,
    truckId: updated.truckId,
    driverId: updated.driverId,
    status: updated.status,
    updatedAt: updated.updatedAt.toISOString(),
  });

  await broadcastTripEvent(
    {
      tripId: updated.id,
      eventId: `${updated.id}-${options.status}-${now.getTime()}`,
      type: options.status === TripStatus.COMPLETED ? 'ARRIVED' : 'CANCELLED',
      description: options.reason,
      latitude: options.position?.latitude ?? null,
      longitude: options.position?.longitude ?? null,
      createdAt: now.toISOString(),
    },
    updated.organizationId,
  );

  /*
   * Told to the fleet, quietly.
   *
   * NORMAL rather than HIGH: a vehicle fetching diesel is not an incident, and
   * a fleet that gets a high-priority alert every time a driver visits a pump
   * stops reading the high-priority alerts that matter. It is here at all
   * because an unexplained 40 km on a vehicle's odometer is exactly the thing an
   * owner wants to be able to look up afterwards.
   */
  if (options.status === TripStatus.COMPLETED && measured >= 1) {
    void notifyOrganization(updated.organizationId, {
      type: NotificationType.TRIP_COMPLETED,
      title: 'Service run recorded',
      body: `${updated.reference}: ${measured.toFixed(1)} km to ${updated.destinationAddress}.`,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/trips/${updated.id}`,
    });
  }

  return updated;
}

/** Retry a reference collision rather than failing an unattended write. */
async function createWithReference<T>(
  create: (reference: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await create(await nextReference(attempt));
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string }).code;
      if (code !== 'P2002') throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : errors.internal('Could not allocate a trip reference.');
}

