import {
  ACTIVE_TRIP_STATUSES,
  TripStatus,
  tripStateMachine,
  type LatLng,
  type TerminalTripStopView,
  type TerminalTripView,
} from '@saarthi/shared';
import type { AuthContext } from '../../auth/context';
import { type Prisma, prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { transitionTrip } from '../trips/trip.service';
import type { SessionRecord } from './session.view';

/**
 * The work the fleet gave this vehicle, delivered to the vehicle.
 *
 * The missing half of dispatch. `createTrip` has always written the trip
 * against the vehicle — status, driver, `currentTripId`, the lot — and the
 * tracking pipeline has always attributed the vehicle's positions to it. What
 * never existed was a way for the terminal to *hear* about it: the one
 * `/state` payload the app renders every screen from carries the vehicle, the
 * session, the driver and the tablet's health, and no job. So a dispatcher
 * assigned a trip, rang the driver to tell them where to go, and then watched
 * the trip sit at ASSIGNED and nought per cent for the rest of its life because
 * nothing on the vehicle could move it on.
 *
 * This module is both directions of that link:
 *
 *  * [dispatchedTripForSession] — what the terminal is meant to be doing.
 *  * [startDispatchedTrip] and [completeDispatchedTrip] — the terminal's own
 *    trip buttons moving the real `Trip` record, so the fleet's screen follows
 *    the vehicle rather than the other way round.
 *
 * **A dispatch belongs to the vehicle, not to the phone in it.** The trip is
 * found by vehicle, because that is where `currentTripId` lives and where every
 * telemetry frame is already attributed. A driver who took a vehicle over
 * mid-shift is driving the job that vehicle was given, and hiding it because
 * the paperwork names a colleague would leave them with a blank screen and a
 * telephone call. The view says whose name is on it instead.
 *
 * Saarthi is not a lorry platform. The Prisma model is still called `Truck`,
 * but a fleet's vehicles are taxis, buses, vans, tempos and auto-rickshaws as
 * readily as they are trucks, and nothing in this module may assume otherwise —
 * the field name is history, not a constraint.
 */

const dispatchLogger = logger.child({ module: 'terminal-dispatch' });

/** Statuses in which the driver has set off and "Complete" is the next word. */
const UNDERWAY_TRIP_STATUSES: TripStatus[] = [
  TripStatus.STARTED,
  TripStatus.IN_TRANSIT,
  TripStatus.DELAYED,
  TripStatus.EMERGENCY,
  TripStatus.ARRIVED,
  TripStatus.UNLOADING,
];

/** Statuses from which the terminal's Start button legitimately departs. */
const STARTABLE_TRIP_STATUSES: TripStatus[] = [TripStatus.ASSIGNED, TripStatus.LOADING];

/**
 * The states a terminal may route a trip *through* on its way somewhere.
 *
 * The trip machine has no STARTED → COMPLETED edge, and rightly: a journey that
 * was never recorded as arriving anywhere has no `actualArrivalAt`, so its
 * duration and its delay are both unanswerable. A driver pressing Complete in
 * the vehicle has finished — that is what the word means to them — so the missing
 * steps are walked and each one recorded as a real transition with its own
 * event, rather than the status being written straight across.
 *
 * What is deliberately absent is the whole point of having a list. DELAYED,
 * EMERGENCY, SUSPENDED and CANCELLED are all reachable from a moving trip and
 * every one of them would be a *claim* — that a vehicle was late, in trouble,
 * or stood down — invented by a server looking for a route through a graph. A
 * driver pressing Complete said none of those things. So the walk is confined
 * to the ordinary progression of a journey, and if that cannot reach the target
 * the trip is left where it is and the refusal is logged.
 */
const WALKABLE_TRIP_STATUSES: TripStatus[] = [
  TripStatus.LOADING,
  TripStatus.STARTED,
  TripStatus.IN_TRANSIT,
  TripStatus.ARRIVED,
  TripStatus.UNLOADING,
  TripStatus.COMPLETED,
];

/**
 * The shortest honest route through the trip machine, or null if there is none.
 *
 * Breadth-first over `tripStateMachine.transitions`, which is the same table
 * the API validates every write against — so this cannot drift from the rules
 * it is walking. The *from* status may be anything a trip is actually in; every
 * step of the path must be one of [WALKABLE_TRIP_STATUSES].
 */
function pathTo(from: TripStatus, to: TripStatus): TripStatus[] | null {
  if (from === to) return [];

  const seen = new Set<TripStatus>([from]);
  const queue: { status: TripStatus; path: TripStatus[] }[] = [{ status: from, path: [] }];

  while (queue.length > 0) {
    const { status, path } = queue.shift()!;
    for (const next of tripStateMachine.transitions[status] ?? []) {
      if (seen.has(next) || !WALKABLE_TRIP_STATUSES.includes(next)) continue;
      const extended = [...path, next];
      if (next === to) return extended;
      seen.add(next);
      queue.push({ status: next, path: extended });
    }
  }

  return null;
}

const dispatchInclude = {
  stops: { orderBy: { sequence: 'asc' } },
  order: { select: { reference: true } },
} satisfies Prisma.TripInclude;

type DispatchRecord = Prisma.TripGetPayload<{ include: typeof dispatchInclude }>;

/**
 * The dispatcher's polyline, filtered to points that are actually points.
 *
 * `plannedRoute` is a JSON column, so a trip imported or edited by hand can
 * hold anything at all. A malformed entry reaching the driver is a marker
 * dropped in the Gulf of Guinea, so the shape is checked here rather than
 * trusted.
 */
function routePoints(plannedRoute: Prisma.JsonValue | null): LatLng[] {
  if (!Array.isArray(plannedRoute)) return [];
  return (plannedRoute as unknown as LatLng[]).filter(
    (point) =>
      point &&
      typeof point.latitude === 'number' &&
      typeof point.longitude === 'number' &&
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude),
  );
}

function toStopView(stop: DispatchRecord['stops'][number]): TerminalTripStopView {
  return {
    id: stop.id,
    type: String(stop.type),
    name: stop.name,
    address: stop.address,
    latitude: stop.latitude,
    longitude: stop.longitude,
    sequence: stop.sequence,
    status: String(stop.status),
    plannedArrival: stop.plannedArrival?.toISOString() ?? null,
  };
}

function toView(trip: DispatchRecord, signedInDriverId: string): TerminalTripView {
  const planned = trip.plannedDistanceKm;

  return {
    id: trip.id,
    reference: trip.reference,
    status: String(trip.status),
    originAddress: trip.originAddress,
    originLatitude: trip.originLatitude,
    originLongitude: trip.originLongitude,
    destinationAddress: trip.destinationAddress,
    destinationLatitude: trip.destinationLatitude,
    destinationLongitude: trip.destinationLongitude,
    plannedRoute: routePoints(trip.plannedRoute),
    plannedDistanceKm: planned,
    actualDistanceKm: trip.actualDistanceKm,
    // The same calculation the fleet's own trip list shows, so a driver and a
    // dispatcher reading the two screens over the telephone see one number.
    progressPercent:
      trip.status === TripStatus.COMPLETED
        ? 100
        : planned && planned > 0
          ? Math.max(0, Math.min(100, Math.round((trip.actualDistanceKm / planned) * 100)))
          : 0,
    plannedStartAt: trip.plannedStartAt?.toISOString() ?? null,
    plannedArrivalAt: trip.plannedArrivalAt?.toISOString() ?? null,
    etaAt: trip.etaAt?.toISOString() ?? null,
    delayMinutes: trip.delayMinutes,
    stops: trip.stops.map(toStopView),
    notes: trip.notes,
    orderReference: trip.order?.reference ?? null,
    underway: UNDERWAY_TRIP_STATUSES.includes(trip.status as TripStatus),
    assignedToSignedInDriver: trip.driverId === signedInDriverId,
  };
}

/**
 * Find the dispatched trip open against a vehicle.
 *
 * `adHoc: false` is the load-bearing clause. A service run to a filling station
 * occupies `currentTripId` exactly as a dispatch does — that is what makes the
 * tracking pipeline record it — and presenting one here would have the terminal
 * offer to navigate a driver to the pump they are already standing at, and put
 * a Complete button in front of a journey the fleet never asked for.
 */
async function openDispatchFor(vehicleId: string): Promise<DispatchRecord | null> {
  return prisma.trip.findFirst({
    where: {
      truckId: vehicleId,
      adHoc: false,
      status: { in: ACTIVE_TRIP_STATUSES },
    },
    // Newest first. A fleet that left an old trip open by mistake should not be
    // able to send a driver to last week's destination.
    orderBy: { createdAt: 'desc' },
    include: dispatchInclude,
  });
}

/** What this terminal has been dispatched to do, if anything. */
export async function dispatchedTripForSession(
  session: SessionRecord,
): Promise<TerminalTripView | null> {
  const trip = await openDispatchFor(session.vehicleId);
  return trip ? toView(trip, session.driverId) : null;
}

/**
 * Walk the dispatched trip to a status, and never let that break the terminal.
 *
 * Two things are going on, and both matter.
 *
 * **The walk.** The terminal has two buttons and the trip machine has ten
 * states, so
 * "the driver has finished" is rarely one transition. Each step is a real
 * `transitionTrip` call rather than a status written across — which is what
 * makes `actualStartAt`, `actualArrivalAt`, the delay against the planned
 * arrival, the vehicle's status, the order's status and the trip's own event
 * timeline all come out right. Only the last step carries the driver's note;
 * the intermediate ones keep the machine's own description, because an event
 * reading "Trip completed from the terminal" against a move to IN_TRANSIT would
 * be a lie in the timeline a fleet reads afterwards.
 *
 * **The swallowing.** Every caller is a driver who has just pressed a button on
 * a phone in a moving vehicle. If the machine refuses — a dispatcher cancelled
 * the job thirty seconds ago, a trip is somewhere this path cannot honestly walk
 * from — the right outcome is a logged warning and a driver whose own session
 * still works. Throwing would mean a driver unable to end their shift because of
 * a record they cannot see and did not write.
 */
async function walk(
  auth: AuthContext,
  trip: { id: string; status: TripStatus },
  target: TripStatus,
  input: { note?: string; latitude?: number; longitude?: number },
): Promise<boolean> {
  const path = pathTo(trip.status, target);
  if (path === null) {
    dispatchLogger.warn(
      { tripId: trip.id, from: trip.status, to: target },
      'No honest route through the trip machine from where this trip stands.',
    );
    return false;
  }

  for (const [index, status] of path.entries()) {
    const last = index === path.length - 1;
    try {
      await transitionTrip(auth, trip.id, {
        status,
        ...(last && input.note ? { note: input.note } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      });
    } catch (error) {
      dispatchLogger.warn(
        { err: error, tripId: trip.id, status, target },
        'Could not move the dispatched trip from the terminal.',
      );
      return false;
    }
  }

  return true;
}

/**
 * The driver set off.
 *
 * Called after the terminal's own session has gone TRIP_ACTIVE, so the safety
 * check has already been enforced by the session service and a driver who has
 * not completed it never reaches this.
 *
 * Returns the trip as it now stands, or null when there was no dispatch to
 * move — a driver starting a shift on a vehicle with no assigned work is the
 * ordinary case, not a fault.
 */
export async function startDispatchedTrip(
  session: SessionRecord,
  auth: AuthContext,
  input: { latitude?: number; longitude?: number },
): Promise<TerminalTripView | null> {
  const trip = await openDispatchFor(session.vehicleId);
  if (!trip) return null;

  if (STARTABLE_TRIP_STATUSES.includes(trip.status as TripStatus)) {
    await walk(
      auth,
      { id: trip.id, status: trip.status as TripStatus },
      TripStatus.STARTED,
      { note: 'Driver set off from the terminal.', ...input },
    );
  }

  return dispatchedTripForSession(session);
}

/**
 * The driver finished.
 *
 * Two transitions rather than one where the trip never recorded an arrival —
 * see [NEEDS_ARRIVAL_TRIP_STATUSES]. A trip still sitting at ASSIGNED is left
 * alone: the driver signed on, ended their shift and never set off, and closing
 * the fleet's job on their behalf would lose work nobody cancelled.
 */
export async function completeDispatchedTrip(
  session: SessionRecord,
  auth: AuthContext,
  input: { latitude?: number; longitude?: number },
): Promise<TerminalTripView | null> {
  const trip = await openDispatchFor(session.vehicleId);
  if (!trip) return null;

  const status = trip.status as TripStatus;
  if (STARTABLE_TRIP_STATUSES.includes(status)) return toView(trip, session.driverId);

  await walk(
    auth,
    { id: trip.id, status },
    TripStatus.COMPLETED,
    { note: 'Trip completed from the terminal.', ...input },
  );

  return dispatchedTripForSession(session);
}
