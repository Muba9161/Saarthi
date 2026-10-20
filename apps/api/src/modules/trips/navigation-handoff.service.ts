import { TripStatus, type ExternalNavigationApp } from '@saarthi/shared';
import type { AuthContext } from '../../auth/context';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';

/**
 * A driver handing the trip to Google Maps, or coming back to Saarthi's own
 * navigation (`app: null`).
 *
 * Recorded on the trip because that app picks its own roads and cannot tell
 * Saarthi which: while it is set, a stretch off the planned route that still
 * heads for the destination is an alternate road, not a deviation (see
 * `tracking/trip-route`). One write for every way a driver drives — the cab's
 * terminal and the owner app — so the timeline reads the same whichever was used.
 */

/** Record [app] on the trip; repeating the same answer changes nothing and adds nothing to the timeline. */
export async function recordNavigationHandoff(
  trip: { id: string; externalNavigation: ExternalNavigationApp | null },
  app: ExternalNavigationApp | null,
): Promise<void> {
  if (trip.externalNavigation === app) return;
  await prisma.$transaction([
    prisma.trip.update({
      where: { id: trip.id },
      data: { externalNavigation: app, externalNavigationSince: app ? new Date() : null },
    }),
    prisma.tripEvent.create({
      data: {
        tripId: trip.id,
        type: 'NAVIGATION_HANDOFF',
        description: app
          ? 'Driver is navigating with Google Maps. Saarthi keeps recording the route.'
          : "Driver is back on Saarthi's navigation.",
        metadata: { app },
      },
    }),
  ]);
}

/**
 * The same, from a signed-in app: only the trip's own driver, and only while
 * the trip is open — a finished trip's navigation is history, not a choice.
 */
export async function handOffTripNavigation(
  auth: AuthContext,
  tripId: string,
  app: ExternalNavigationApp | null,
): Promise<{ navigationHandoff: ExternalNavigationApp | null }> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, driverId: true, status: true, externalNavigation: true },
  });
  if (!trip || auth.driverId === null || trip.driverId !== auth.driverId) throw errors.notFound('Trip');
  if (trip.status === TripStatus.COMPLETED || trip.status === TripStatus.CANCELLED) {
    throw errors.conflict('This trip has ended.');
  }
  await recordNavigationHandoff({ id: trip.id, externalNavigation: trip.externalNavigation as ExternalNavigationApp | null }, app);
  return { navigationHandoff: app };
}
