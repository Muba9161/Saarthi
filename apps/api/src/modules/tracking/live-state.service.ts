import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { logger } from '../../lib/logger';

/**
 * Live vehicle state.
 *
 * The last known position of every moving vehicle is the hottest read in the
 * product: a dashboard with forty trucks open asks for it constantly, and every
 * one of those reads used to be a relational query with two joins. It is also
 * the most disposable data in the product — superseded within seconds, and
 * always re-derivable from the telemetry that produced it.
 *
 * So it lives in the cache with a TTL, and PostgreSQL keeps the durable trail.
 * The TTL doubles as the heartbeat: a key that has expired means nothing has
 * been heard from that vehicle recently, which is exactly what "offline" means
 * here. Absence *is* the signal, rather than a flag somebody has to remember to
 * clear.
 */

const liveLogger = logger.child({ module: 'tracking:live' });

export interface LiveVehicleState {
  vehicleId: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  /** ISO timestamp of the reading itself, not of the write. */
  timestamp: string;
  deviceStatus: 'ONLINE' | 'STALE' | 'OFFLINE';
  source: string;
  /** True when the figures came from a simulator rather than a real device. */
  simulated: boolean;
}

/**
 * Record where a vehicle is now.
 *
 * Best-effort by design: a cache write failure must never fail the ingest that
 * produced it, because the durable record has already been written.
 */
export async function writeLiveState(state: LiveVehicleState): Promise<void> {
  try {
    await cache.set(cacheKeys.vehicleLive(state.vehicleId), state, cacheTtl.liveState);
  } catch (error) {
    liveLogger.warn({ err: error, vehicleId: state.vehicleId }, 'Live state write failed');
  }
}

/** The vehicle's last known state, or `null` when nothing recent is held. */
export async function readLiveState(vehicleId: string): Promise<LiveVehicleState | null> {
  return cache.get<LiveVehicleState>(cacheKeys.vehicleLive(vehicleId));
}

/**
 * Live state for several vehicles.
 *
 * Missing entries are simply absent from the map rather than present as null:
 * a caller merging this over database rows wants "no fresher value", and an
 * explicit null would invite overwriting a good stored position with nothing.
 */
export async function readLiveStates(
  vehicleIds: string[],
): Promise<Map<string, LiveVehicleState>> {
  const found = new Map<string, LiveVehicleState>();
  if (vehicleIds.length === 0) return found;

  const results = await Promise.all(
    vehicleIds.map(async (vehicleId) => [vehicleId, await readLiveState(vehicleId)] as const),
  );

  for (const [vehicleId, state] of results) {
    if (state) found.set(vehicleId, state);
  }
  return found;
}

export async function clearLiveState(vehicleId: string): Promise<void> {
  await cache.delete(cacheKeys.vehicleLive(vehicleId));
}

/**
 * How fresh a reading is, in the terms the UI uses.
 *
 * A separate function from the TTL because they answer different questions:
 * the TTL decides when Saarthi stops holding the value at all, this decides
 * when it stops presenting it as current.
 */
export function freshnessOf(timestamp: string, now: Date = new Date()): LiveVehicleState['deviceStatus'] {
  const age = now.getTime() - new Date(timestamp).getTime();
  if (age <= 60_000) return 'ONLINE';
  if (age <= 5 * 60_000) return 'STALE';
  return 'OFFLINE';
}
