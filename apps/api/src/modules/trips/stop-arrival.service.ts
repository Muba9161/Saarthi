import {
  MOVING_TRIP_STATUSES,
  TripStatus,
  nextStopVisit,
  type StopFix,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';

/**
 * Trip stops reached and left, from the vehicle's own GPS.
 *
 * Runs on every position recorded against a trip, whoever is navigating —
 * Saarthi, Google Maps or nobody — so the fleet has the real arrival time even
 * when the driver forgets to press Arrived. It records; it never marks a stop
 * arrived. The driver confirms that, and confirming takes this time rather
 * than the moment the button was pressed. See `stop-visit` for the rule.
 */

/**
 * Statuses whose stops are still being visited.
 *
 * Arrived and unloading are included: the vehicle is still at its destination,
 * and when it leaves is exactly the time the fleet wants for waiting charges.
 */
const VISITING: readonly TripStatus[] = [
  ...MOVING_TRIP_STATUSES,
  TripStatus.ARRIVED,
  TripStatus.UNLOADING,
];

/** Record what this position changes about the trip's stops. Returns the timeline events raised. */
export async function recordStopVisits(
  trip: { id: string; status: string },
  fix: StopFix,
): Promise<string[]> {
  if (!VISITING.includes(trip.status as TripStatus)) return [];

  const stops = await prisma.tripStop.findMany({
    where: { tripId: trip.id, leftAt: null, status: { not: 'SKIPPED' } },
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      reachingSince: true,
      reachedAt: true,
      leftAt: true,
    },
  });

  const events: string[] = [];
  for (const stop of stops) {
    const change = nextStopVisit(stop, fix);
    switch (change.kind) {
      case 'NONE':
        break;
      case 'REACHING':
        await prisma.tripStop.update({
          where: { id: stop.id },
          data: { reachingSince: change.reachingSince },
        });
        break;
      case 'NOT_REACHING':
        await prisma.tripStop.update({ where: { id: stop.id }, data: { reachingSince: null } });
        break;
      case 'REACHED':
        await prisma.$transaction([
          prisma.tripStop.update({
            where: { id: stop.id },
            data: { reachedAt: change.reachedAt, reachingSince: null },
          }),
          prisma.tripEvent.create({
            data: {
              tripId: trip.id,
              type: 'STOP_REACHED',
              description: `Reached ${stop.name}, by the vehicle's GPS.`,
              latitude: stop.latitude,
              longitude: stop.longitude,
              metadata: { stopId: stop.id },
              // When it happened, not when it was worked out two minutes later.
              createdAt: change.reachedAt,
            },
          }),
        ]);
        events.push('STOP_REACHED');
        break;
      case 'LEFT':
        await prisma.$transaction([
          prisma.tripStop.update({ where: { id: stop.id }, data: { leftAt: change.leftAt } }),
          prisma.tripEvent.create({
            data: {
              tripId: trip.id,
              type: 'STOP_LEFT',
              description: `Left ${stop.name} after ${change.minutesAtStop} min, by the vehicle's GPS.`,
              latitude: fix.position.latitude,
              longitude: fix.position.longitude,
              metadata: { stopId: stop.id, minutesAtStop: change.minutesAtStop },
              createdAt: change.leftAt,
            },
          }),
        ]);
        events.push('STOP_LEFT');
        break;
    }
  }
  return events;
}
