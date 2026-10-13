import {
  ACTIVE_TRIP_STATUSES,
  MAX_COMPARED_TRIPS,
  TRIP_CHAIN_METRES,
  TripStatus,
  TruckStatus,
  VehicleType,
  chainedLegs,
  haversineDistance,
  rechainedOrigins,
  shortestOrder,
  type LatLng,
  type LegDistance,
  type QueuedLeg,
  type TerminalQueuedTripView,
  type TerminalSessionView,
  type TerminalTripQueueView,
} from '@saarthi/shared';
import type { AuthContext } from '../../auth/context';
import { type Prisma, prisma } from '../../database/prisma';
import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { routingProvider } from '../../providers/routing';
import { readLiveState } from '../tracking/live-state.service';
import { promoteQueuedDriverTrip } from '../trips/trip-queue.service';
import { transitionTrip } from '../trips/trip.service';
import { startDispatchedTrip } from './dispatch.service';
import { profileForVehicle } from './navigation.service';
import { startTrip } from './session.service';
import type { SessionRecord } from './session.view';

/**
 * A driver's own trips on their vehicle, run one after another.
 *
 * The vehicle still carries one trip at a time — `trip-queue.service` keeps the
 * fleet's trip first and hands the vehicle on when a trip ends. This is the
 * driver's half: the queue as they see it, a shorter order when there is one,
 * reordering it, starting any of their trips rather than only the next, and
 * starting the next one the moment the last ends.
 *
 * Only the driver's own trips move. A trip the fleet dispatched is never
 * reordered, started out of turn or pushed back by anything here.
 */

const queueLogger = logger.child({ module: 'driver-trip-queue' });

/** A trip that has not set off: queued, or holding the vehicle and waiting for Start. */
const UNSTARTED: TripStatus[] = [TripStatus.DRAFT, TripStatus.ASSIGNED, TripStatus.LOADING];

/** `terminalCreateTripSchema` takes no longer a planned route than this. */
const MAX_ROUTE_POINTS = 2_000;

const QUEUE_SELECT = {
  id: true,
  reference: true,
  status: true,
  originAddress: true,
  originLatitude: true,
  originLongitude: true,
  destinationAddress: true,
  destinationLatitude: true,
  destinationLongitude: true,
  plannedDistanceKm: true,
  queuePosition: true,
  createdAt: true,
} as const;

type QueueTrip = Prisma.TripGetPayload<{ select: typeof QUEUE_SELECT }>;

/** Where the queue runs from, and what it runs behind. */
interface QueueStart {
  point: LatLng | null;
  /** The address the first trip would start from, when the queue starts at a trip's end. */
  label: string | null;
  behind: TerminalTripQueueView['behind'];
}

// ---------------------------------------------------------------------------
// Reading the queue
// ---------------------------------------------------------------------------

/** The driver's own trips on this vehicle that have not started, and a shorter order if there is one. */
export async function driverTripQueue(
  session: SessionRecord,
  position: LatLng | null,
): Promise<TerminalTripQueueView> {
  if (!session.driverId) return { behind: null, trips: [], suggestion: null };

  const [queue, start] = await Promise.all([
    driverQueue(session.vehicleId, session.driverId),
    queueStart(session.vehicleId, position),
  ]);
  const legs = queue.map(legOf);
  const chained = start.point ? chainedLegs(start.point, legs) : new Set<string>();

  return {
    behind: start.behind,
    trips: queue.map((trip, index): TerminalQueuedTripView => ({
      id: trip.id,
      reference: trip.reference,
      position: index + 1,
      fromLabel: trip.originAddress,
      toLabel: trip.destinationAddress,
      toLatitude: trip.destinationLatitude,
      toLongitude: trip.destinationLongitude,
      plannedDistanceKm: trip.plannedDistanceKm,
      upNext: trip.status !== TripStatus.DRAFT,
      chained: chained.has(trip.id),
    })),
    suggestion: start.point ? await suggestionFor(session.vehicleId, start.point, legs) : null,
  };
}

async function suggestionFor(
  vehicleId: string,
  start: LatLng,
  legs: QueuedLeg[],
): Promise<TerminalTripQueueView['suggestion']> {
  if (legs.length < 2 || legs.length > MAX_COMPARED_TRIPS) return null;

  const { distance, estimated } = await legDistances(vehicleId, [
    start,
    ...legs.flatMap((leg) => [leg.origin, leg.destination]),
  ]);
  const best = shortestOrder(start, legs, distance);
  if (!best) return null;

  return {
    order: best.order,
    currentKm: kilometres(best.currentMetres),
    suggestedKm: kilometres(best.suggestedMetres),
    savedKm: kilometres(best.savedMetres),
    estimated,
  };
}

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

/**
 * Put the driver's trips in their order.
 *
 * A trip that starts where the one before it ended moves with the order: it
 * now starts where its new predecessor ends, and is routed again from there.
 * A trip with its own pickup keeps it. The trip now first takes the vehicle
 * from whichever of the driver's trips was waiting for Start.
 */
export async function reorderDriverTrips(
  session: SessionRecord,
  input: { tripIds: string[]; latitude?: number; longitude?: number },
): Promise<TerminalTripQueueView> {
  const driverId = signedOnDriver(session);
  const position = positionFrom(input);
  const [queue, start] = await Promise.all([
    driverQueue(session.vehicleId, driverId),
    queueStart(session.vehicleId, position),
  ]);

  const byId = new Map(queue.map((trip) => [trip.id, trip]));
  const sameTrips =
    input.tripIds.length === queue.length &&
    new Set(input.tripIds).size === queue.length &&
    input.tripIds.every((id) => byId.has(id));
  if (!sameTrips) {
    throw errors.conflict('Your trips changed since this list was shown. Refresh and try again.');
  }

  const order = input.tripIds.map((id) => byId.get(id)!);
  const moved = start.point ? await movedStarts(session.vehicleId, start, queue, order) : [];
  const holder = queue.find((trip) => trip.status !== TripStatus.DRAFT) ?? null;
  const first = order[0]!;

  await prisma.$transaction(async (tx) => {
    for (const [index, trip] of order.entries()) {
      await tx.trip.update({ where: { id: trip.id }, data: { queuePosition: index } });
    }
    for (const change of moved) {
      await tx.trip.update({ where: { id: change.tripId }, data: change.data });
      await tx.tripEvent.create({
        data: {
          tripId: change.tripId,
          type: 'NOTE',
          description: `Now starts from ${change.data.originAddress}: the driver reordered their trips.`,
        },
      });
    }
    if (holder && holder.id !== first.id) {
      await handOver(tx, session.vehicleId, holder.id, first.id, 'Back in the queue: the driver put another trip first.');
    }
  });

  // A vehicle no trip holds is handed to the new first trip, as it would be when one ends.
  if (!holder) await promoteQueuedDriverTrip(session.vehicleId);

  return driverTripQueue(session, position);
}

/** The trips whose start moves with the new order, already routed from it. */
async function movedStarts(
  vehicleId: string,
  start: QueueStart,
  queue: QueueTrip[],
  order: QueueTrip[],
): Promise<{ tripId: string; data: Prisma.TripUpdateInput & { originAddress: string } }[]> {
  if (!start.point) return [];
  const chained = chainedLegs(start.point, queue.map(legOf));
  const origins = rechainedOrigins(start.point, order.map(legOf), chained);
  const byId = new Map(order.map((trip) => [trip.id, trip]));

  const moved = [];
  for (const trip of order) {
    const next = origins.get(trip.id);
    if (!next || haversineDistance(next.origin, legOf(trip).origin) <= TRIP_CHAIN_METRES) continue;
    const originAddress = next.after
      ? byId.get(next.after)!.destinationAddress
      : (start.label ?? (await placeName(next.origin)));
    moved.push({ tripId: trip.id, data: await startingFrom(vehicleId, trip, next.origin, originAddress) });
  }
  return moved;
}

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

/**
 * Take one of the driver's own trips that has not started off their queue.
 *
 * Cancelled rather than erased: the fleet's record keeps it, marked as removed
 * by the driver, as it keeps any trip that did not happen. The trip after it,
 * if it was chained to it, now starts where the removed one would have — so a
 * chain with a link taken out is still a chain. A trip the fleet dispatched is
 * not the driver's to remove and is never found here.
 */
export async function removeDriverTrip(
  session: SessionRecord,
  auth: AuthContext,
  tripId: string,
): Promise<TerminalTripQueueView> {
  const driverId = signedOnDriver(session);
  const queue = await driverQueue(session.vehicleId, driverId);
  const index = queue.findIndex((trip) => trip.id === tripId);
  if (index < 0) throw errors.notFound('Trip');

  const removed = queue[index]!;
  const next = queue[index + 1];
  if (next && haversineDistance(legOf(next).origin, legOf(removed).destination) <= TRIP_CHAIN_METRES) {
    const data = await startingFrom(session.vehicleId, next, legOf(removed).origin, removed.originAddress);
    await prisma.$transaction([
      prisma.trip.update({ where: { id: next.id }, data }),
      prisma.tripEvent.create({
        data: {
          tripId: next.id,
          type: 'NOTE',
          description: `Now starts from ${data.originAddress}: the driver removed the trip before it.`,
        },
      }),
    ]);
  }

  // The trip machine's own cancellation: a trip holding the vehicle frees it,
  // and the next in the driver's order is handed it.
  await transitionTrip(auth, tripId, { status: TripStatus.CANCELLED, note: 'Removed by the driver from the app.' });

  return driverTripQueue(session, null);
}

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

/**
 * Whether this trip may start now. Called before anything moves, so a refusal
 * leaves the driver's shift exactly as it was.
 */
export async function assertTripStartable(session: SessionRecord, tripId: string): Promise<void> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, truckId: session.vehicleId, adHoc: false },
    select: { id: true, status: true, driverCreated: true, driverId: true },
  });
  if (!trip) throw errors.notFound('Trip');
  if (!ACTIVE_TRIP_STATUSES.includes(trip.status as TripStatus) && trip.status !== TripStatus.DRAFT) {
    throw errors.conflict('This trip has already ended.');
  }
  if (trip.driverCreated && trip.driverId !== session.driverId) {
    throw errors.forbidden('This trip belongs to another driver.');
  }

  const holder = await heldTrip(session.vehicleId);
  if (!holder || holder.id === trip.id) return;
  if (!UNSTARTED.includes(holder.status as TripStatus)) {
    throw errors.conflict('Stop the trip you are on before starting another.');
  }
  if (!holder.driverCreated) {
    throw errors.conflict('Your fleet\'s trip comes first. Start it, or ask your fleet to change it.');
  }
}

/**
 * Hand the vehicle to this trip, so the Start that follows starts it — and,
 * for a trip that would have started where the one before it ends, start it
 * from where the vehicle actually is.
 */
export async function handVehicleTo(
  session: SessionRecord,
  tripId: string,
  position: LatLng | null,
): Promise<void> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: QUEUE_SELECT });
  if (!trip || !UNSTARTED.includes(trip.status as TripStatus)) return;

  if (session.driverId) {
    const [queue, start] = await Promise.all([
      driverQueue(session.vehicleId, session.driverId),
      queueStart(session.vehicleId, position),
    ]);
    const index = queue.findIndex((queued) => queued.id === tripId);
    const before = index > 0 ? legOf(queue[index - 1]!).destination : start.point;
    await startFromHere(session.vehicleId, trip, before, position);
  }

  const holder = await heldTrip(session.vehicleId);
  if (holder?.id === tripId) return;

  await prisma.$transaction(async (tx) => {
    if (holder) {
      await handOver(tx, session.vehicleId, holder.id, tripId, 'Back in the queue: the driver started another trip first.');
      return;
    }
    const claimed = await tx.truck.updateMany({
      where: { id: session.vehicleId, currentTripId: null, archivedAt: null },
      data: {
        status: TruckStatus.ASSIGNED,
        currentTripId: tripId,
        ...(session.driverId ? { currentDriverId: session.driverId } : {}),
      },
    });
    if (claimed.count === 0) return;
    await claim(tx, tripId, 'The driver chose this trip next.');
  });
}

/**
 * The trip just finished: start the driver's next one straight away — no
 * second slide to start what was always going to come next.
 *
 * `finished` is the trip that ended, and where it was going. The next trip, chained to it,
 * starts from where the vehicle is rather than from there — the two are the
 * same place unless the driver stopped short.
 *
 * Returns the session as it now stands, or null when there was nothing to start.
 */
export async function startNextDriverTrip(
  session: SessionRecord,
  auth: AuthContext,
  input: { latitude?: number; longitude?: number },
  finished: LatLng & { id: string },
): Promise<TerminalSessionView | null> {
  if (!session.driverId) return null;

  const held = await heldTrip(session.vehicleId);
  if (!held || held.id === finished.id) return null;
  if (!held.driverCreated || held.driverId !== session.driverId) return null;
  if (!UNSTARTED.includes(held.status as TripStatus)) return null;

  const next = await prisma.trip.findUnique({ where: { id: held.id }, select: QUEUE_SELECT });
  if (!next) return null;
  await startFromHere(session.vehicleId, next, finished, positionFrom(input));

  try {
    const view = await startTrip(session.id, {
      ...input,
      note: 'Started on its own: the trip before it ended.',
    });
    await startDispatchedTrip(session, auth, input);
    return view;
  } catch (error) {
    // The trip that ended has ended either way; the next one simply waits for Start.
    queueLogger.warn({ err: error, tripId: next.id }, 'Could not start the next queued trip');
    return null;
  }
}

/**
 * A trip that would have started where the trip before it ends, started
 * somewhere else: route it from here instead.
 *
 * A trip with its own pickup keeps it — the vehicle still has to go there.
 */
async function startFromHere(
  vehicleId: string,
  trip: QueueTrip,
  before: LatLng | null,
  here: LatLng | null,
): Promise<void> {
  if (!before || !here) return;
  const origin = legOf(trip).origin;
  if (haversineDistance(origin, before) > TRIP_CHAIN_METRES) return;
  if (haversineDistance(origin, here) <= TRIP_CHAIN_METRES) return;

  const data = await startingFrom(vehicleId, trip, here, await placeName(here));
  await prisma.$transaction([
    prisma.trip.update({ where: { id: trip.id }, data }),
    prisma.tripEvent.create({
      data: {
        tripId: trip.id,
        type: 'NOTE',
        description: `Now starts from ${data.originAddress}, where the driver set off.`,
        latitude: here.latitude,
        longitude: here.longitude,
      },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// The vehicle and its trips
// ---------------------------------------------------------------------------

/** The real trip holding the vehicle, if any. */
async function heldTrip(vehicleId: string) {
  const truck = await prisma.truck.findUnique({ where: { id: vehicleId }, select: { currentTripId: true } });
  if (!truck?.currentTripId) return null;
  return prisma.trip.findFirst({
    where: { id: truck.currentTripId, adHoc: false, status: { in: ACTIVE_TRIP_STATUSES } },
    select: {
      id: true,
      reference: true,
      status: true,
      driverCreated: true,
      driverId: true,
      destinationAddress: true,
      destinationLatitude: true,
      destinationLongitude: true,
    },
  });
}

/** The driver's trips that have not set off: the one holding the vehicle first, then their order. */
async function driverQueue(vehicleId: string, driverId: string): Promise<QueueTrip[]> {
  const trips = await prisma.trip.findMany({
    where: { truckId: vehicleId, driverId, driverCreated: true, adHoc: false, status: { in: UNSTARTED } },
    select: QUEUE_SELECT,
  });
  return trips.sort(runOrder);
}

function runOrder(a: QueueTrip, b: QueueTrip): number {
  const holdsA = a.status !== TripStatus.DRAFT;
  const holdsB = b.status !== TripStatus.DRAFT;
  if (holdsA !== holdsB) return holdsA ? -1 : 1;
  const positionA = a.queuePosition ?? Number.MAX_SAFE_INTEGER;
  const positionB = b.queuePosition ?? Number.MAX_SAFE_INTEGER;
  if (positionA !== positionB) return positionA - positionB;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Where the queue starts: the end of the trip the vehicle is on — under way,
 * or the fleet's, which always runs first — or else where the vehicle is.
 */
async function queueStart(vehicleId: string, position: LatLng | null): Promise<QueueStart> {
  const held = await heldTrip(vehicleId);
  // A driver trip still waiting for Start heads the queue; it is not something the queue runs behind.
  if (held && !(held.driverCreated && UNSTARTED.includes(held.status as TripStatus))) {
    return {
      point: { latitude: held.destinationLatitude, longitude: held.destinationLongitude },
      label: held.destinationAddress,
      behind: { reference: held.reference, toLabel: held.destinationAddress },
    };
  }
  const live = position ?? (await readLiveState(vehicleId).then((state) =>
    state ? { latitude: state.lat, longitude: state.lng } : null,
  ));
  return { point: live, label: null, behind: null };
}

/** Swap which of the driver's trips holds the vehicle, if it is still the one it was. */
async function handOver(
  tx: Prisma.TransactionClient,
  vehicleId: string,
  fromId: string,
  toId: string,
  note: string,
): Promise<void> {
  const swapped = await tx.truck.updateMany({
    where: { id: vehicleId, currentTripId: fromId },
    data: { currentTripId: toId },
  });
  if (swapped.count === 0) return;

  await tx.trip.update({ where: { id: fromId }, data: { status: TripStatus.DRAFT } });
  await tx.tripEvent.create({
    data: { tripId: fromId, type: 'STATUS_CHANGED', description: note, metadata: { to: TripStatus.DRAFT } as never },
  });
  await claim(tx, toId, 'The driver chose this trip next.');
}

async function claim(tx: Prisma.TransactionClient, tripId: string, note: string): Promise<void> {
  await tx.trip.update({ where: { id: tripId }, data: { status: TripStatus.ASSIGNED } });
  await tx.tripEvent.create({
    data: {
      tripId,
      type: 'ASSIGNED',
      description: note,
      metadata: { from: TripStatus.DRAFT, to: TripStatus.ASSIGNED } as never,
    },
  });
}

/** A new start for a trip, routed again from it. */
async function startingFrom(
  vehicleId: string,
  trip: QueueTrip,
  origin: LatLng,
  originAddress: string,
): Promise<Prisma.TripUpdateInput & { originAddress: string }> {
  const route = await plannedRoute(vehicleId, origin, legOf(trip).destination);
  return {
    originAddress,
    originLatitude: origin.latitude,
    originLongitude: origin.longitude,
    plannedRoute: route.geometry as never,
    plannedDistanceKm: route.distanceKm,
    plannedDurationMin: route.durationMin,
  };
}

/**
 * The road from one point to another, or a straight line when routing is not
 * to be had — a trip with a line for a plan still runs, and its trail says it
 * was planned without roads.
 */
async function plannedRoute(
  vehicleId: string,
  from: LatLng,
  to: LatLng,
): Promise<{ geometry: LatLng[]; distanceKm: number; durationMin: number | null }> {
  if (routingProvider) {
    try {
      const route = await routingProvider.route({ from, to, profile: await profileOf(vehicleId) });
      const stride = Math.ceil(route.geometry.length / MAX_ROUTE_POINTS);
      return {
        geometry: route.geometry
          .filter((_, index, all) => index % stride === 0 || index === all.length - 1)
          .map((point) => ({ latitude: point.latitude, longitude: point.longitude })),
        distanceKm: kilometres(route.distanceMeters),
        durationMin: Math.max(1, Math.round(route.durationSeconds / 60)),
      };
    } catch (error) {
      queueLogger.warn({ err: error }, 'No road route for a reordered trip; planning it as a straight line');
    }
  }
  return { geometry: [from, to], distanceKm: kilometres(haversineDistance(from, to)), durationMin: null };
}

/**
 * Road distance between any two of these points — one matrix request, cached,
 * or straight lines when routing is not configured or does not answer.
 */
async function legDistances(
  vehicleId: string,
  points: LatLng[],
): Promise<{ distance: LegDistance; estimated: boolean }> {
  const straight: LegDistance = (from, to) => haversineDistance(from, to);
  const keyOf = (point: LatLng): string => `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
  const unique = [...new Map(points.map((point) => [keyOf(point), point])).values()];
  if (!routingProvider || unique.length < 2) return { distance: straight, estimated: true };

  const profile = await profileOf(vehicleId);
  const key = cacheKeys.terminalTripMatrix(`${profile}:${unique.map(keyOf).join('|')}`);
  let matrix = await cache.get<(number | null)[][]>(key);
  if (!matrix) {
    try {
      matrix = await routingProvider.matrix(unique, profile);
      await cache.set(key, matrix, cacheTtl.terminalTripMatrix);
    } catch (error) {
      queueLogger.warn({ err: error }, 'No road distances for the trip queue; comparing straight lines');
      return { distance: straight, estimated: true };
    }
  }

  const index = new Map(unique.map((point, at) => [keyOf(point), at]));
  const road = matrix;
  const estimated = road.some((row, from) => row.some((cell, to) => from !== to && cell === null));
  return {
    distance: (from, to) => road[index.get(keyOf(from))!]?.[index.get(keyOf(to))!] ?? straight(from, to),
    estimated,
  };
}

async function profileOf(vehicleId: string) {
  const vehicle = await prisma.truck.findUnique({ where: { id: vehicleId }, select: { vehicleType: true } });
  return profileForVehicle((vehicle?.vehicleType as VehicleType) ?? VehicleType.TRUCK);
}

/** A name for a spot the driver set off from: the town, or the coordinates when it has none. */
async function placeName(at: LatLng): Promise<string> {
  const locality = await routingProvider?.reverseGeocode(at).catch(() => null);
  if (locality?.city) return `Near ${locality.city}`;
  return `${at.latitude.toFixed(4)}, ${at.longitude.toFixed(4)}`;
}

function legOf(trip: QueueTrip): QueuedLeg {
  return {
    id: trip.id,
    origin: { latitude: trip.originLatitude, longitude: trip.originLongitude },
    destination: { latitude: trip.destinationLatitude, longitude: trip.destinationLongitude },
  };
}

/** The driver's position from a request, when it carried one. */
export function positionFrom(input: { latitude?: number; longitude?: number }): LatLng | null {
  return input.latitude !== undefined && input.longitude !== undefined
    ? { latitude: input.latitude, longitude: input.longitude }
    : null;
}

function signedOnDriver(session: SessionRecord): string {
  if (!session.driverId) throw errors.forbidden('Sign on to this vehicle to change your trips.');
  return session.driverId;
}

function kilometres(metres: number): number {
  return Math.round(metres / 100) / 10;
}
