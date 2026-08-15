import {
  SimulationStatus,
  TrackingSource,
  TripStatus,
  destinationPoint,
  pathLength,
  pointAtDistance,
  type LatLng,
  type SimulationControlInput,
  type SimulationTuneInput,
  type StartSimulationInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { ingestLocation } from '../tracking/tracking.service';
import { broadcastSimulationUpdate } from '../../realtime/realtime.service';
import type { AuthContext } from '../../auth/context';

/**
 * Mock GPS simulator.
 *
 * This is a real engine, not a canned animation: it advances a truck along a
 * polyline in wall-clock time, generates realistic speed/heading/noise, and
 * pushes every position through the *same* tracking pipeline that production
 * GPS hardware will use. Swapping in a real provider therefore changes nothing
 * downstream — the dashboard, ETA maths and alerts are already driven by the
 * normalised event.
 *
 * Guarded by DEMO_MODE: the routes that reach it refuse to run in production.
 */

const simulatorLogger = logger.child({ module: 'simulator' });

interface Behaviours {
  randomStops: boolean;
  stopProbability: number;
  speedVariance: number;
  gpsNoiseMeters: number;
  poorConnectivity: boolean;
  /** Simulated minutes still to be "waited out" at a stop. */
  pendingDelayMinutes?: number;
}

const DEFAULT_BEHAVIOURS: Behaviours = {
  randomStops: false,
  stopProbability: 0.02,
  speedVariance: 0.2,
  gpsNoiseMeters: 8,
  poorConnectivity: false,
};

function parseBehaviours(raw: Prisma.JsonValue | null): Behaviours {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_BEHAVIOURS };
  return { ...DEFAULT_BEHAVIOURS, ...(raw as Partial<Behaviours>) };
}

function parseRoute(raw: Prisma.JsonValue): LatLng[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown as LatLng[]).filter(
    (point) => point && typeof point.latitude === 'number' && typeof point.longitude === 'number',
  );
}

/** Deterministic-ish jitter that still looks organic. */
function jitter(magnitude: number): number {
  return (Math.random() - 0.5) * 2 * magnitude;
}

export interface SimulationSummary {
  id: string;
  truckId: string;
  registrationNumber: string;
  tripId: string | null;
  tripReference: string | null;
  status: SimulationStatus;
  progressPercent: number;
  progressMeters: number;
  routeDistanceKm: number;
  baseSpeedKph: number;
  speedMultiplier: number;
  deviationActive: boolean;
  behaviours: Behaviours;
  startedAt: string | null;
  lastTickAt: string | null;
  completedAt: string | null;
}

type SimulationRecord = Prisma.SimulationGetPayload<Record<string, never>>;

async function toSummary(simulation: SimulationRecord): Promise<SimulationSummary> {
  const [truck, trip] = await Promise.all([
    prisma.truck.findUnique({
      where: { id: simulation.truckId },
      select: { registrationNumber: true },
    }),
    simulation.tripId
      ? prisma.trip.findUnique({ where: { id: simulation.tripId }, select: { reference: true } })
      : Promise.resolve(null),
  ]);

  const totalMeters = simulation.routeDistanceKm * 1000;

  return {
    id: simulation.id,
    truckId: simulation.truckId,
    registrationNumber: truck?.registrationNumber ?? 'Unknown',
    tripId: simulation.tripId,
    tripReference: trip?.reference ?? null,
    status: simulation.status as SimulationStatus,
    progressPercent:
      totalMeters > 0
        ? Math.min(100, Math.round((simulation.progressMeters / totalMeters) * 100))
        : 0,
    progressMeters: Math.round(simulation.progressMeters),
    routeDistanceKm: Number(simulation.routeDistanceKm.toFixed(1)),
    baseSpeedKph: simulation.baseSpeedKph,
    speedMultiplier: simulation.speedMultiplier,
    deviationActive: simulation.deviationActive,
    behaviours: parseBehaviours(simulation.behaviours),
    startedAt: simulation.startedAt?.toISOString() ?? null,
    lastTickAt: simulation.lastTickAt?.toISOString() ?? null,
    completedAt: simulation.completedAt?.toISOString() ?? null,
  };
}

function assertDemoMode(): void {
  if (!config.demo.enabled) throw errors.demoDisabled();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function startSimulation(
  auth: AuthContext,
  organizationId: string,
  input: StartSimulationInput,
): Promise<SimulationSummary> {
  assertDemoMode();

  const truck = await prisma.truck.findUnique({ where: { id: input.truckId } });
  if (!truck || (!auth.isPlatformAdmin && truck.organizationId !== organizationId)) {
    throw errors.notFound('Truck');
  }

  const trip = input.tripId
    ? await prisma.trip.findUnique({ where: { id: input.tripId } })
    : truck.currentTripId
      ? await prisma.trip.findUnique({ where: { id: truck.currentTripId } })
      : null;

  let route: LatLng[] = input.route ?? [];
  if (route.length < 2 && trip) route = parseRoute(trip.plannedRoute ?? []);
  if (route.length < 2 && trip) {
    route = [
      { latitude: trip.originLatitude, longitude: trip.originLongitude },
      { latitude: trip.destinationLatitude, longitude: trip.destinationLongitude },
    ];
  }
  if (route.length < 2) {
    throw errors.validation(
      'A route is required. Select a trip with a planned route, or supply route points.',
    );
  }

  // One simulation per truck at a time.
  await prisma.simulation.updateMany({
    where: {
      truckId: input.truckId,
      status: { in: [SimulationStatus.RUNNING, SimulationStatus.PAUSED] },
    },
    data: { status: SimulationStatus.STOPPED, stoppedAt: new Date() },
  });

  const simulation = await prisma.simulation.create({
    data: {
      organizationId: truck.organizationId,
      truckId: input.truckId,
      tripId: trip?.id ?? null,
      status: SimulationStatus.RUNNING,
      route: route as never,
      routeDistanceKm: Number((pathLength(route) / 1000).toFixed(2)),
      progressMeters: 0,
      baseSpeedKph: input.baseSpeedKph,
      speedMultiplier: input.speedMultiplier,
      behaviours: { ...DEFAULT_BEHAVIOURS, ...(input.behaviours ?? {}) } as never,
      startedAt: new Date(),
      lastTickAt: new Date(),
      createdById: auth.user.id,
    },
  });

  // Starting the simulator on an assigned trip also starts the trip, so the
  // demo mirrors what a driver tapping "Start" would do.
  if (trip && trip.status === TripStatus.ASSIGNED) {
    await prisma.trip.update({
      where: { id: trip.id },
      data: { status: TripStatus.STARTED, actualStartAt: trip.actualStartAt ?? new Date() },
    });
    await prisma.truck.update({
      where: { id: truck.id },
      data: { status: 'ON_TRIP', currentTripId: trip.id },
    });
  }

  simulatorLogger.info(
    { simulationId: simulation.id, truckId: truck.id, tripId: trip?.id },
    'Simulation started',
  );

  const summary = await toSummary(simulation);
  await broadcastSimulationUpdate(
    {
      simulationId: summary.id,
      truckId: summary.truckId,
      tripId: summary.tripId,
      status: summary.status,
      progressPercent: summary.progressPercent,
      speedMultiplier: summary.speedMultiplier,
      updatedAt: new Date().toISOString(),
    },
    truck.organizationId,
  );

  return summary;
}

export async function controlSimulation(
  auth: AuthContext,
  simulationId: string,
  input: SimulationControlInput,
): Promise<SimulationSummary> {
  assertDemoMode();

  const simulation = await prisma.simulation.findUnique({ where: { id: simulationId } });
  if (!simulation) throw errors.notFound('Simulation');
  if (!auth.isPlatformAdmin && simulation.organizationId !== auth.organizationId) {
    throw errors.notFound('Simulation');
  }

  const now = new Date();
  const data: Prisma.SimulationUpdateInput = {};

  switch (input.action) {
    case 'PAUSE':
      if (simulation.status !== SimulationStatus.RUNNING) {
        throw errors.businessRule('Only a running simulation can be paused.');
      }
      data.status = SimulationStatus.PAUSED;
      data.pausedAt = now;
      break;
    case 'RESUME':
      if (simulation.status !== SimulationStatus.PAUSED) {
        throw errors.businessRule('Only a paused simulation can be resumed.');
      }
      data.status = SimulationStatus.RUNNING;
      data.pausedAt = null;
      data.lastTickAt = now;
      break;
    case 'STOP':
      data.status = SimulationStatus.STOPPED;
      data.stoppedAt = now;
      break;
    case 'RESET':
      data.status = SimulationStatus.IDLE;
      data.progressMeters = 0;
      data.deviationActive = false;
      data.startedAt = null;
      data.stoppedAt = null;
      data.completedAt = null;
      data.lastTickAt = null;
      break;
  }

  const updated = await prisma.simulation.update({ where: { id: simulationId }, data });
  const summary = await toSummary(updated);

  await broadcastSimulationUpdate(
    {
      simulationId: summary.id,
      truckId: summary.truckId,
      tripId: summary.tripId,
      status: summary.status,
      progressPercent: summary.progressPercent,
      speedMultiplier: summary.speedMultiplier,
      updatedAt: now.toISOString(),
    },
    simulation.organizationId,
  );

  return summary;
}

export async function tuneSimulation(
  auth: AuthContext,
  simulationId: string,
  input: SimulationTuneInput,
): Promise<SimulationSummary> {
  assertDemoMode();

  const simulation = await prisma.simulation.findUnique({ where: { id: simulationId } });
  if (!simulation) throw errors.notFound('Simulation');
  if (!auth.isPlatformAdmin && simulation.organizationId !== auth.organizationId) {
    throw errors.notFound('Simulation');
  }

  const behaviours = parseBehaviours(simulation.behaviours);
  if (input.delayMinutes) {
    behaviours.pendingDelayMinutes = (behaviours.pendingDelayMinutes ?? 0) + input.delayMinutes;
  }

  const updated = await prisma.simulation.update({
    where: { id: simulationId },
    data: {
      ...(input.baseSpeedKph !== undefined ? { baseSpeedKph: input.baseSpeedKph } : {}),
      ...(input.speedMultiplier !== undefined ? { speedMultiplier: input.speedMultiplier } : {}),
      ...(input.deviate !== undefined ? { deviationActive: input.deviate } : {}),
      ...(input.delayMinutes ? { behaviours: behaviours as never } : {}),
    },
  });

  return toSummary(updated);
}

export async function listSimulations(
  auth: AuthContext,
  organizationId: string,
): Promise<SimulationSummary[]> {
  const simulations = await prisma.simulation.findMany({
    where: auth.isPlatformAdmin && !auth.organizationId ? {} : { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return Promise.all(simulations.map((simulation) => toSummary(simulation)));
}

export async function getSimulation(
  auth: AuthContext,
  simulationId: string,
): Promise<SimulationSummary> {
  const simulation = await prisma.simulation.findUnique({ where: { id: simulationId } });
  if (!simulation) throw errors.notFound('Simulation');
  if (!auth.isPlatformAdmin && simulation.organizationId !== auth.organizationId) {
    throw errors.notFound('Simulation');
  }
  return toSummary(simulation);
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Advance one simulation by the elapsed wall-clock time. Returns `true` when
 * the simulation reached the end of its route.
 */
async function tickSimulation(simulation: SimulationRecord): Promise<boolean> {
  const route = parseRoute(simulation.route);
  if (route.length < 2) {
    await prisma.simulation.update({
      where: { id: simulation.id },
      data: { status: SimulationStatus.STOPPED, stoppedAt: new Date() },
    });
    return true;
  }

  const now = new Date();
  const lastTick = simulation.lastTickAt ?? now;
  const elapsedSeconds = Math.max(0.5, (now.getTime() - lastTick.getTime()) / 1000);

  const behaviours = parseBehaviours(simulation.behaviours);
  const totalMeters = simulation.routeDistanceKm * 1000;

  // Hold position while an injected delay is being served.
  if (behaviours.pendingDelayMinutes && behaviours.pendingDelayMinutes > 0) {
    const servedMinutes = (elapsedSeconds * simulation.speedMultiplier) / 60;
    const remaining = Math.max(0, behaviours.pendingDelayMinutes - servedMinutes);
    await prisma.simulation.update({
      where: { id: simulation.id },
      data: {
        lastTickAt: now,
        behaviours: { ...behaviours, pendingDelayMinutes: remaining } as never,
      },
    });

    const holdPoint = pointAtDistance(route, simulation.progressMeters);
    await ingestLocation(
      {
        truckId: simulation.truckId,
        latitude: holdPoint.position.latitude,
        longitude: holdPoint.position.longitude,
        speedKph: 0,
        heading: holdPoint.heading,
        accuracy: 6,
        timestamp: now,
        source: TrackingSource.MOCK,
        ...(simulation.tripId ? { tripId: simulation.tripId } : {}),
      },
      { simulated: true },
    );
    return false;
  }

  // A random stop: the truck idles for this tick.
  const stopped =
    behaviours.randomStops && Math.random() < behaviours.stopProbability * elapsedSeconds;

  const varianceFactor = 1 + jitter(behaviours.speedVariance);
  const speedKph = stopped ? 0 : Math.max(0, simulation.baseSpeedKph * varianceFactor);

  const advanceMeters = stopped
    ? 0
    : (speedKph / 3.6) * elapsedSeconds * simulation.speedMultiplier;

  const nextProgress = Math.min(totalMeters, simulation.progressMeters + advanceMeters);
  const point = pointAtDistance(route, nextProgress);

  // Deviation pushes the truck sideways off the corridor to exercise alerts.
  let position = point.position;
  if (simulation.deviationActive) {
    position = destinationPoint(position, (point.heading + 90) % 360, 1200);
  }

  // GPS noise so the trail is not unrealistically perfect.
  if (behaviours.gpsNoiseMeters > 0) {
    position = destinationPoint(position, Math.random() * 360, Math.random() * behaviours.gpsNoiseMeters);
  }

  const completed = nextProgress >= totalMeters - 1;

  await prisma.simulation.update({
    where: { id: simulation.id },
    data: {
      progressMeters: nextProgress,
      lastTickAt: now,
      ...(completed
        ? { status: SimulationStatus.COMPLETED, completedAt: now }
        : {}),
    },
  });

  // Poor connectivity drops the occasional packet, exactly as a real device would.
  const dropPacket = behaviours.poorConnectivity && Math.random() < 0.25;
  if (!dropPacket) {
    await ingestLocation(
      {
        truckId: simulation.truckId,
        latitude: position.latitude,
        longitude: position.longitude,
        speedKph: Number(speedKph.toFixed(1)),
        heading: Math.round(point.heading),
        accuracy: Number((4 + Math.random() * 8).toFixed(1)),
        timestamp: now,
        source: TrackingSource.MOCK,
        ...(simulation.tripId ? { tripId: simulation.tripId } : {}),
      },
      { simulated: true },
    );
  }

  if (completed && simulation.tripId) {
    const trip = await prisma.trip.findUnique({ where: { id: simulation.tripId } });
    if (
      trip &&
      ([TripStatus.IN_TRANSIT, TripStatus.STARTED, TripStatus.DELAYED] as TripStatus[]).includes(
        trip.status as TripStatus,
      )
    ) {
      // Reaching the destination marks arrival; a human still confirms unloading
      // and completion, so the operational record stays honest.
      const delayMinutes = trip.plannedArrivalAt
        ? Math.max(0, Math.round((now.getTime() - trip.plannedArrivalAt.getTime()) / 60_000))
        : 0;

      await prisma.trip.update({
        where: { id: trip.id },
        data: { status: TripStatus.ARRIVED, actualArrivalAt: now, delayMinutes },
      });
      await prisma.tripEvent.create({
        data: {
          tripId: trip.id,
          type: 'ARRIVED',
          description: 'Vehicle reached the destination.',
          latitude: position.latitude,
          longitude: position.longitude,
        },
      });
      await prisma.tripStop.updateMany({
        where: { tripId: trip.id, type: 'DESTINATION' },
        data: { status: 'ARRIVED', actualArrival: now },
      });
    }
  }

  if (completed) {
    simulatorLogger.info({ simulationId: simulation.id }, 'Simulation completed');
    await broadcastSimulationUpdate(
      {
        simulationId: simulation.id,
        truckId: simulation.truckId,
        tripId: simulation.tripId,
        status: SimulationStatus.COMPLETED,
        progressPercent: 100,
        speedMultiplier: simulation.speedMultiplier,
        updatedAt: now.toISOString(),
      },
      simulation.organizationId,
    );
  }

  return completed;
}

let engineTimer: NodeJS.Timeout | null = null;
let ticking = false;

/** Runs one pass over every RUNNING simulation. Exposed for tests. */
export async function runSimulationTick(): Promise<number> {
  if (ticking) return 0;
  ticking = true;
  try {
    const running = await prisma.simulation.findMany({
      where: { status: SimulationStatus.RUNNING },
      take: 100,
    });

    let advanced = 0;
    for (const simulation of running) {
      try {
        await tickSimulation(simulation);
        advanced += 1;
      } catch (error) {
        simulatorLogger.error(
          { err: error, simulationId: simulation.id },
          'Simulation tick failed; stopping this simulation',
        );
        await prisma.simulation.update({
          where: { id: simulation.id },
          data: { status: SimulationStatus.STOPPED, stoppedAt: new Date() },
        });
      }
    }
    return advanced;
  } finally {
    ticking = false;
  }
}

export function startSimulationEngine(): void {
  if (!config.demo.enabled) {
    simulatorLogger.info('Demo mode disabled — GPS simulator engine not started');
    return;
  }
  if (engineTimer) return;

  engineTimer = setInterval(() => {
    void runSimulationTick();
  }, config.demo.simulatorTickMs);
  engineTimer.unref?.();

  simulatorLogger.info({ tickMs: config.demo.simulatorTickMs }, 'GPS simulator engine started');
}

export function stopSimulationEngine(): void {
  if (engineTimer) {
    clearInterval(engineTimer);
    engineTimer = null;
  }
}
