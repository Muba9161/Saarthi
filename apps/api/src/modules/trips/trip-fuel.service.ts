import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';

/**
 * What a trip actually cost in fuel.
 *
 * A fleet manages diesel, not kilometres, and until now Saarthi could tell them
 * how far a truck went and nothing about what it burned getting there. The
 * engine has been reporting consumption all along; this is what turns a stream
 * of instantaneous litres-per-hour into the one number an owner acts on.
 *
 * **Integrated, not averaged.** Consumption is a rate, so the litres burned
 * between two readings is the rate multiplied by the time between them. Taking a
 * plain mean of the samples would weight a reading taken during a two-minute
 * traffic stop the same as one during a two-second gear change, and on a stop-go
 * city run that is the difference between a plausible figure and a fictional
 * one.
 *
 * **Absent beats zero.** A vehicle that never reported a fuel rate produces
 * null, not 0 L. Most of the fleet is in that position, and a trip showing zero
 * consumption would drag every average built on it in the flattering direction —
 * which is exactly the kind of quietly wrong number that gets believed.
 */

const fuelLogger = logger.child({ module: 'trip-fuel' });

/**
 * The longest gap two readings may span and still be integrated across.
 *
 * A terminal reports every few seconds while it is running. A gap of an hour
 * means it was off — parked overnight, out of signal, the driver on a break —
 * and carrying the last known rate across that gap would invent a tankful. The
 * gap is skipped rather than estimated: some of the trip's fuel goes unmeasured,
 * which the result says by being lower, and that is the honest failure.
 */
const MAX_GAP_SECONDS = 300;

export interface TripFuelSummary {
  /** Litres burned across the readings that carried a rate. */
  litres: number;
  /** Kilometres per litre, or null when the trip covered no distance. */
  economyKmpl: number | null;
  /** How much of the trip had a fuel reading, 0-1. Honesty about coverage. */
  coverage: number;
}

/**
 * Integrate the fuel a trip consumed.
 *
 * Returns null when the vehicle reported no consumption at all — which is not a
 * failure, just a vehicle whose ECU does not expose the reading.
 */
export async function summariseTripFuel(input: {
  vehicleId: string;
  startedAt: Date;
  endedAt: Date;
  distanceKm: number;
}): Promise<TripFuelSummary | null> {
  const readings = await prisma.telemetryReading.findMany({
    where: {
      vehicleId: input.vehicleId,
      recordedAt: { gte: input.startedAt, lte: input.endedAt },
      // Simulated frames are excluded outright. A fabricated consumption figure
      // becoming a fleet's fuel report is section 19's whole concern.
      simulated: false,
    },
    orderBy: { recordedAt: 'asc' },
    select: { recordedAt: true, fuelRate: true },
  });

  if (readings.length < 2) return null;

  let litres = 0;
  let measuredSeconds = 0;

  for (let index = 1; index < readings.length; index += 1) {
    const previous = readings[index - 1];
    const current = readings[index];
    if (previous === undefined || current === undefined) continue;

    // The rate at the *start* of the interval is what applied across it. Using
    // the later one would attribute a burst of acceleration to the quiet minute
    // that preceded it.
    const rate = previous.fuelRate;
    if (rate === null || rate <= 0) continue;

    const seconds = (current.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000;
    if (seconds <= 0 || seconds > MAX_GAP_SECONDS) continue;

    litres += (rate * seconds) / 3600;
    measuredSeconds += seconds;
  }

  if (litres <= 0) return null;

  const totalSeconds = (input.endedAt.getTime() - input.startedAt.getTime()) / 1000;
  const coverage = totalSeconds > 0 ? Math.min(1, measuredSeconds / totalSeconds) : 0;

  return {
    litres: Number(litres.toFixed(2)),
    economyKmpl:
      input.distanceKm > 0.5 ? Number((input.distanceKm / litres).toFixed(2)) : null,
    coverage: Number(coverage.toFixed(2)),
  };
}

/**
 * Work out a completed trip's fuel and store it on the trip.
 *
 * Deliberately best-effort. A trip is complete whether or not its fuel could be
 * worked out, and a failure here must never leave a driver unable to finish a
 * journey — so it is called after the completion transaction rather than inside
 * it, and a thrown error is logged and dropped.
 */
export async function recordTripFuel(tripId: string): Promise<void> {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        truckId: true,
        actualStartAt: true,
        actualArrivalAt: true,
        actualDistanceKm: true,
      },
    });

    // Both ends have to be real. A trip completed without ever departing has no
    // window to integrate over, and inventing one from `createdAt` would sweep
    // in whatever the vehicle was doing while it sat in the yard.
    if (!trip?.actualStartAt || !trip.actualArrivalAt) return;

    const summary = await summariseTripFuel({
      vehicleId: trip.truckId,
      startedAt: trip.actualStartAt,
      endedAt: trip.actualArrivalAt,
      distanceKm: trip.actualDistanceKm,
    });

    if (!summary) return;

    /*
     * Below half coverage the figure is not worth publishing.
     *
     * A trip where the terminal was off for most of the journey produces a
     * small, confident-looking number that is simply wrong — and a fleet
     * comparing drivers on it would draw the opposite conclusion to the truth.
     */
    if (summary.coverage < 0.5) {
      fuelLogger.debug(
        { tripId, coverage: summary.coverage },
        'Trip fuel not recorded: too little of the journey was measured',
      );
      return;
    }

    await prisma.trip.update({
      where: { id: tripId },
      data: {
        fuelLitres: summary.litres,
        fuelEconomyKmpl: summary.economyKmpl,
      },
    });

    fuelLogger.info(
      { tripId, litres: summary.litres, kmpl: summary.economyKmpl },
      'Trip fuel recorded',
    );
  } catch (error) {
    fuelLogger.warn({ err: error, tripId }, 'Trip fuel could not be worked out');
  }
}
