import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';

/**
 * The one place a vehicle's odometer moves.
 *
 * Before this, `trucks.odometerKm` was written by four unrelated callers — a
 * pre-trip checklist, a maintenance record, a service-history import, a
 * terminal trip event — each with its own idea of whether the new figure should
 * be trusted. Two of them guarded against the reading going backwards and two
 * did not, which meant a terminal reinstalled on a truck, or a workshop typing a
 * reading from the wrong vehicle, could wind the clock back and quietly reset
 * every service interval that hangs off it.
 *
 * More to the point: **nothing at all moved it while the vehicle was driving.**
 * The gateway stored an odometer on each telemetry reading and the tracking
 * pipeline measured distance per trip, but the vehicle's own figure — the one
 * the fleet list shows, the one maintenance-due is computed from, the one a
 * resale valuation quotes, the one the assistant answers with — only changed
 * when somebody filled in a form. A truck could cover forty thousand kilometres
 * and still read whatever it read on the day it was added.
 *
 * Two rules, and they are the whole module:
 *
 *  * **It never goes backwards.** A lower figure is not a correction; it is a
 *    mistake, a different vehicle, or a device that has been reset. A genuine
 *    correction is a deliberate act by a person and belongs on the vehicle edit
 *    form where somebody is accountable for it — not on an ingestion path that
 *    runs thousands of times a day.
 *
 *  * **An implausible jump is refused.** GPS glitches teleport; so does a
 *    mistyped reading. Anything that would add more than a long day's driving in
 *    one step is logged and dropped, because an odometer that has jumped to
 *    900,000 km is worse than one that is slightly stale — it takes a vehicle
 *    permanently out of every maintenance and valuation calculation, and there
 *    is no automated path back.
 *
 * Both rules are enforced *inside the database statement* rather than around it.
 * Two sources reporting the same vehicle at once — a terminal flushing a buffer
 * while a fitted tracker reports — would otherwise both read the old figure and
 * both write their own increment, losing one.
 */

const odometerLogger = logger.child({ module: 'odometer' });

/**
 * The most a single update may add.
 *
 * A long day at motorway speeds, with room to spare. Its job is to catch a
 * glitch or a typo, not to police driving hours — anything above this did not
 * happen in one step, whatever produced it.
 */
const MAX_SINGLE_ADVANCE_KM = 1_500;

/**
 * Below this, do not write.
 *
 * A parked vehicle produces a metre or two of GPS wander per fix. Left
 * unfiltered that is roughly a kilometre a day of odometer on a truck that has
 * not moved, and a row update on every position for the privilege. The tracking
 * pipeline already suppresses sub-threshold movement; this is the second net.
 */
const MIN_ADVANCE_KM = 0.02;

/**
 * The ceiling on any odometer, authoritative or not.
 *
 * Five million kilometres is beyond the life of any road vehicle, so a reading
 * past it is a decode error rather than a well-travelled truck. It is the only
 * bound an ECU reading is held to, because the vehicle is the authority on its
 * own mileage and every tighter check would be second-guessing it.
 */
const MAX_PLAUSIBLE_ODOMETER_KM = 5_000_000;

export interface OdometerUpdate {
  vehicleId: string;
  /**
   * An absolute reading, when something actually measured one.
   *
   * From an ECU over OBD, from a workshop, or from a driver typing what the dash
   * says. Takes precedence over `addKm`, because a measured total beats an
   * accumulated one that has been drifting since the last fix went missing.
   */
  odometerKm?: number | null;
  /** Distance to add, when all that is known is how far the vehicle moved. */
  addKm?: number | null;
  /**
   * The vehicle stated this itself, and it replaces whatever Saarthi held.
   *
   * Only an ECU reading over OBD earns this. Everything else — a workshop note,
   * a driver reading the dash, distance accumulated from GPS — is an estimate or
   * a transcription, and those stay monotonic so a typo cannot wind a truck's
   * mileage backwards.
   *
   * An ECU total is different in kind. It is the odometer, not an opinion about
   * it, and the figure it corrects is usually the rough number somebody typed at
   * onboarding. Without this flag that correction is refused as an implausible
   * jump — a vehicle registered at 50,000 km reporting a true 128,450 is 78,450
   * away from the stored value, and the guard designed to catch a corrupt frame
   * was instead rejecting the only reliable reading in the system.
   */
  authoritative?: boolean;
  /** Who moved it, for the log. Never shown to a driver. */
  reason: string;
}

/**
 * Apply a reading, and return the vehicle's odometer afterwards.
 *
 * Returns the *current* figure whether or not this call changed it, so a caller
 * recording "the odometer at the end of this trip" gets the truth rather than
 * what it hoped to write. Null only when the vehicle is gone.
 */
export async function applyOdometer(update: OdometerUpdate): Promise<number | null> {
  const absolute = update.odometerKm ?? null;

  if (absolute !== null && Number.isFinite(absolute)) {
    return applyAbsolute(
      update.vehicleId,
      absolute,
      update.reason,
      update.authoritative ?? false,
    );
  }

  const add = update.addKm ?? 0;
  if (!Number.isFinite(add) || add < MIN_ADVANCE_KM) {
    return currentOdometer(update.vehicleId);
  }
  if (add > MAX_SINGLE_ADVANCE_KM) {
    odometerLogger.warn(
      { vehicleId: update.vehicleId, add, reason: update.reason },
      'Odometer increment refused: implausible jump',
    );
    return currentOdometer(update.vehicleId);
  }

  return applyIncrement(update.vehicleId, add);
}

/**
 * Add distance the vehicle covered.
 *
 * The hot path — this runs for every GPS fix from every source — so it is one
 * statement and no read. `increment` compiles to `SET "odometerKm" =
 * "odometerKm" + $1`, which the database applies atomically: two fixes landing
 * at once both land, where a read-then-write would silently drop one during a
 * buffer replay.
 *
 * It cannot move the figure backwards. The caller's bounds have already
 * established that the increment is positive and plausible.
 */
async function applyIncrement(vehicleId: string, addKm: number): Promise<number | null> {
  try {
    const updated = await prisma.truck.update({
      where: { id: vehicleId },
      data: { odometerKm: { increment: round(addKm) } },
      select: { odometerKm: true },
    });
    return updated.odometerKm;
  } catch (error) {
    // The vehicle was deleted between the position arriving and this write.
    // Not worth failing an ingestion whose reading is already stored.
    if ((error as { code?: string }).code === 'P2025') return null;
    throw error;
  }
}

/**
 * Adopt a reading something actually measured.
 *
 * Both rules live in the predicate: `gt` refuses anything at or below what the
 * vehicle already reads, and `lt` refuses an implausible leap. A row matching
 * neither is left exactly as it was, and the caller is told the real figure
 * rather than the one it proposed — which is how a terminal moved to a different
 * truck learns that vehicle's mileage instead of overwriting it.
 */
async function applyAbsolute(
  vehicleId: string,
  odometerKm: number,
  reason: string,
  authoritative: boolean,
): Promise<number | null> {
  const proposed = round(odometerKm);

  /*
   * An authoritative reading is bounded by physics, not by the stored value.
   *
   * The monotonic window below is the right guard for a transcription: it stops
   * a mistyped figure winding a truck's mileage backwards, and stops a corrupt
   * frame adding a hundred thousand kilometres. Applied to an ECU reading it
   * does the opposite of its job — the vehicle's own total is precisely the
   * thing that should overrule an estimate, in whichever direction the estimate
   * was wrong.
   */
  if (authoritative) {
    if (proposed < 0 || proposed > MAX_PLAUSIBLE_ODOMETER_KM) {
      odometerLogger.warn(
        { vehicleId, proposed, reason },
        'Odometer reading refused: outside any plausible range',
      );
      return currentOdometer(vehicleId);
    }

    const before = await currentOdometer(vehicleId);
    await prisma.truck.update({
      where: { id: vehicleId },
      data: { odometerKm: proposed },
    });

    // Logged at info, not debug: a correction of any size is worth being able
    // to find later, and a *downward* one is worth being able to explain.
    if (before !== null && Math.abs(proposed - before) > MAX_SINGLE_ADVANCE_KM) {
      odometerLogger.info(
        { vehicleId, before, proposed, reason },
        'Odometer corrected from the vehicle own reading',
      );
    }

    await invalidateVehicleCaches(vehicleId);
    return proposed;
  }

  const written = await prisma.truck.updateMany({
    where: {
      id: vehicleId,
      odometerKm: { lt: proposed, gt: proposed - MAX_SINGLE_ADVANCE_KM },
    },
    data: { odometerKm: proposed },
  });

  if (written.count === 0) {
    const current = await currentOdometer(vehicleId);
    if (current !== null && proposed - current > MAX_SINGLE_ADVANCE_KM) {
      odometerLogger.warn(
        { vehicleId, current, proposed, reason },
        'Odometer reading refused: implausible jump',
      );
    }
    return current;
  }

  // A measured reading is rare — an ECU frame, a checklist, a workshop, a
  // terminal's four-minutely report — so the rollups that quote the odometer are
  // dropped here rather than on the per-fix path, where the change is small and
  // the cache's own minute-long TTL is a perfectly good bound on staleness.
  await invalidateVehicleCaches(vehicleId);

  odometerLogger.debug({ vehicleId, odometerKm: proposed, reason }, 'Odometer reading adopted');
  return proposed;
}

async function currentOdometer(vehicleId: string): Promise<number | null> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: { odometerKm: true },
  });
  return vehicle?.odometerKm ?? null;
}

/** Metres, not millimetres. Any more precision is noise dressed as accuracy. */
function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/**
 * Drop the rollups that quote this vehicle's odometer.
 *
 * Only those, not the whole vehicle prefix: the live-position key lives under
 * the same prefix and is on the fleet map's hot path, and clearing it every time
 * a truck moved would trade a stale odometer for a map that hits the database on
 * every poll.
 *
 * Best-effort. A cache that cannot be reached is a stale service summary for a
 * minute, and failing an odometer update over it would be the wrong trade.
 */
async function invalidateVehicleCaches(vehicleId: string): Promise<void> {
  await Promise.all([
    cache.delete(cacheKeys.vehicleSummary(vehicleId)).catch(() => undefined),
    cache.delete(cacheKeys.vehicleServiceSummary(vehicleId)).catch(() => undefined),
  ]);
}
