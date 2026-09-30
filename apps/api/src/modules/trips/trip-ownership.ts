import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';

/**
 * A trip id that arrived in a request, checked before it is written onto
 * another record — a fill-up, a toll crossing, a position.
 *
 * Without this a caller could name any trip by id and attach their own record
 * to another fleet's journey: inflating its fuel and toll costs, or moving its
 * ETA and status. The trip must be this vehicle's, on this account. Reported
 * as not-found so a trip id says nothing about whether it exists elsewhere.
 *
 * Its own file, with nothing but the database behind it, so the modules that
 * write those records can use it without importing the trip service.
 */
export async function assertTripOnVehicle(
  tripId: string,
  vehicleId: string,
  organizationId: string,
): Promise<void> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { truckId: true, organizationId: true },
  });
  if (!trip || trip.truckId !== vehicleId || trip.organizationId !== organizationId) {
    throw errors.notFound('Trip');
  }
}
