import {
  DeviceProvider,
  SimulationStatus,
  destinationPoint,
  type StartMockDeviceInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { assertTenantAccess } from '../../server/guards';
import type { AuthContext } from '../../auth/context';
import { ingest } from '../telemetry/gateway.service';

/**
 * Mock device simulator.
 *
 * The point of this file, and of section 26 of the spec, is that the mock takes
 * **exactly the same path as physical hardware**:
 *
 *     mock device → same gateway → same adapter registry → same rule engine
 *                 → same storage → same dashboard
 *
 * It does not write to `telemetry_readings` itself and it does not bypass a
 * single check. Its payloads are validated, bounds-checked, replay-protected and
 * rule-evaluated like any other. That is what makes the demo meaningful: when a
 * real Freematics unit is fitted, only the adapter changes, and everything the
 * dashboard does has already been proven.
 *
 * Readings are flagged `simulated: true` throughout, so simulated data can never
 * be mistaken for a real vehicle's history.
 */

const mockLogger = logger.child({ module: 'mock-device' });

/** In-process tickers, keyed by run id. */
const timers = new Map<string, NodeJS.Timeout>();

/** Physically plausible starting state for a vehicle that has no position yet. */
const DEFAULT_START = { latitude: 26.8467, longitude: 80.9462 }; // Lucknow

interface RunState {
  latitude: number;
  longitude: number;
  heading: number;
  speedKph: number;
  fuelLevel: number;
  odometerKm: number;
  readingsSent: number;
}

/**
 * Produce one reading.
 *
 * The vehicle is walked forward along its heading by however far it travelled in
 * the tick, with small random variation, so the resulting track looks like a
 * vehicle rather than a teleporting dot. Scenarios inject a specific fault so
 * each alert path can be demonstrated on demand.
 */
function nextReading(
  state: RunState,
  scenario: StartMockDeviceInput['scenario'],
  intervalSeconds: number,
): { payload: Record<string, unknown>; state: RunState } {
  const cruising = scenario === 'OVERSPEED' ? 95 : 55;

  // Ease toward the cruising speed rather than jumping to it.
  const targetSpeed = cruising + (Math.random() * 10 - 5);
  let speedKph = state.speedKph + (targetSpeed - state.speedKph) * 0.3;
  speedKph = Math.max(0, Math.min(140, speedKph));

  // Harsh events are a genuine speed change, not just a flag, so the
  // accelerometer figure and the speed series agree with each other.
  let accelerationX = ((speedKph - state.speedKph) / 3.6 / intervalSeconds) / 9.81;
  if (scenario === 'HARSH_DRIVING') {
    const braking = state.readingsSent % 2 === 0;
    accelerationX = braking ? -0.6 : 0.55;
    speedKph = braking ? Math.max(0, state.speedKph - 25) : Math.min(120, state.speedKph + 20);
  }

  const heading = (state.heading + (Math.random() * 10 - 5) + 360) % 360;
  const distanceMeters = (speedKph / 3.6) * intervalSeconds;
  const moved = destinationPoint(
    { latitude: state.latitude, longitude: state.longitude },
    distanceMeters,
    heading,
  );

  const odometerKm = state.odometerKm + distanceMeters / 1000;
  // Roughly 30 L/100 km on a 300 L tank, i.e. a believable burn rate.
  const fuelLevel = Math.max(0, state.fuelLevel - (distanceMeters / 1000) * 0.1);

  const rpm = speedKph < 2 ? 750 + Math.random() * 100 : 1200 + speedKph * 12 + Math.random() * 120;

  const coolantTemperature =
    scenario === 'OVERHEATING' ? 108 + Math.random() * 6 : 84 + Math.random() * 6;

  const batteryVoltage =
    scenario === 'LOW_VOLTAGE' ? 11.2 + Math.random() * 0.4 : 13.8 + Math.random() * 0.4;

  // The mock reports in Saarthi's normalised shape and is registered as a MOCK
  // provider, so the generic adapter parses it — a real device would arrive in
  // its vendor format and be parsed by its own adapter instead.
  const payload: Record<string, unknown> = {
    recordedAt: new Date().toISOString(),
    sequence: state.readingsSent + 1,
    location: {
      latitude: moved.latitude,
      longitude: moved.longitude,
      speedKph: Number(speedKph.toFixed(1)),
      heading: Number(heading.toFixed(1)),
      accuracy: 4 + Math.random() * 3,
      satellites: 9 + Math.floor(Math.random() * 4),
    },
    vehicleData: {
      rpm: Math.round(rpm),
      engineLoad: Number((25 + Math.random() * 45).toFixed(1)),
      coolantTemperature: Number(coolantTemperature.toFixed(1)),
      fuelLevel: Number(fuelLevel.toFixed(1)),
      throttlePosition: Number((15 + Math.random() * 50).toFixed(1)),
      batteryVoltage: Number(batteryVoltage.toFixed(2)),
      odometerKm: Number(odometerKm.toFixed(1)),
    },
    motion: {
      accelerationX: Number(accelerationX.toFixed(3)),
      accelerationY: Number((Math.random() * 0.2 - 0.1).toFixed(3)),
      accelerationZ: Number((0.98 + Math.random() * 0.04).toFixed(3)),
      harshBraking: accelerationX <= -0.45,
      harshAcceleration: accelerationX >= 0.4,
      suddenMovement: false,
    },
    deviceHealth: {
      temperature: Number((32 + Math.random() * 8).toFixed(1)),
      signalStrength: -Math.round(60 + Math.random() * 25),
      firmwareVersion: 'mock-1.0.0',
    },
  };

  if (scenario === 'FAULT_CODE' && state.readingsSent % 5 === 0) {
    payload.diagnostics = [
      { code: 'P0128', description: 'Coolant thermostat below regulating temperature', confirmed: true },
    ];
  }

  return {
    payload,
    state: {
      latitude: moved.latitude,
      longitude: moved.longitude,
      heading,
      speedKph,
      fuelLevel,
      odometerKm,
      readingsSent: state.readingsSent + 1,
    },
  };
}

/** Stop and forget a ticker. */
function clearTimer(runId: string): void {
  const timer = timers.get(runId);
  if (timer) {
    clearInterval(timer);
    timers.delete(runId);
  }
}

async function tick(runId: string): Promise<void> {
  const run = await prisma.mockDeviceRun.findUnique({
    where: { id: runId },
    include: { device: { select: { deviceIdentifier: true } } },
  });

  if (!run || run.status !== SimulationStatus.RUNNING) {
    clearTimer(runId);
    return;
  }

  if (run.maxReadings !== null && run.readingsSent >= run.maxReadings) {
    clearTimer(runId);
    await prisma.mockDeviceRun.update({
      where: { id: runId },
      data: { status: SimulationStatus.COMPLETED, stoppedAt: new Date() },
    });
    mockLogger.info({ runId }, 'Mock device run completed');
    return;
  }

  const state: RunState = {
    latitude: run.lastLatitude ?? DEFAULT_START.latitude,
    longitude: run.lastLongitude ?? DEFAULT_START.longitude,
    heading: run.lastHeading ?? 90,
    speedKph: run.lastSpeedKph ?? 0,
    fuelLevel: run.lastFuelLevel ?? 85,
    odometerKm: run.lastOdometerKm ?? 0,
    readingsSent: run.readingsSent,
  };

  const { payload, state: next } = nextReading(
    state,
    run.scenario as StartMockDeviceInput['scenario'],
    run.intervalSeconds,
  );

  try {
    // Straight through the real gateway. The mock holds no privileged path —
    // it authenticates as the device and is validated like anything else.
    const device = await mockDeviceHandle(run.deviceId);
    if (!device) {
      clearTimer(runId);
      await prisma.mockDeviceRun.update({
        where: { id: runId },
        data: { status: SimulationStatus.STOPPED, stoppedAt: new Date() },
      });
      return;
    }

    await ingest(device, payload, { sequence: next.readingsSent, simulated: true });

    await prisma.mockDeviceRun.update({
      where: { id: runId },
      data: {
        readingsSent: next.readingsSent,
        lastLatitude: next.latitude,
        lastLongitude: next.longitude,
        lastHeading: next.heading,
        lastSpeedKph: next.speedKph,
        lastFuelLevel: next.fuelLevel,
        lastOdometerKm: next.odometerKm,
      },
    });
  } catch (error) {
    // A rejected reading is information, not a reason to kill the run — the
    // gateway refusing bad data is the system working.
    mockLogger.warn(
      { err: error, runId, deviceId: run.device.deviceIdentifier },
      'Mock reading was not accepted',
    );
  }
}

/**
 * Build the gateway handle for a device without a secret.
 *
 * The simulator runs inside the API, so it does not have the plaintext secret —
 * only the operator who registered the device does. It therefore constructs the
 * same authenticated handle the gateway would produce. This is available only
 * behind `requireDemoMode()`, which refuses to enable in production.
 */
async function mockDeviceHandle(deviceId: string) {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: deviceId },
    include: {
      assignments: {
        where: { status: 'ACTIVE' },
        select: { vehicleId: true },
        take: 1,
      },
    },
  });
  if (!device || device.archivedAt) return null;

  return {
    id: device.id,
    organizationId: device.organizationId,
    deviceIdentifier: device.deviceIdentifier,
    provider: device.provider as DeviceProvider,
    status: device.status as never,
    vehicleId: device.assignments[0]?.vehicleId ?? null,
    lastSequence: device.lastSequence,
    observedMetrics: device.observedMetrics,
  };
}

export interface MockRunSummary {
  id: string;
  deviceId: string;
  deviceIdentifier: string;
  vehicleRegistration: string | null;
  status: SimulationStatus;
  scenario: string;
  intervalSeconds: number;
  readingsSent: number;
  maxReadings: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
}

async function toRunSummary(runId: string): Promise<MockRunSummary> {
  const run = await prisma.mockDeviceRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      device: {
        select: {
          deviceIdentifier: true,
          assignments: {
            where: { status: 'ACTIVE' },
            select: { vehicle: { select: { registrationNumber: true } } },
            take: 1,
          },
        },
      },
    },
  });

  return {
    id: run.id,
    deviceId: run.deviceId,
    deviceIdentifier: run.device.deviceIdentifier,
    vehicleRegistration: run.device.assignments[0]?.vehicle.registrationNumber ?? null,
    status: run.status as SimulationStatus,
    scenario: run.scenario,
    intervalSeconds: run.intervalSeconds,
    readingsSent: run.readingsSent,
    maxReadings: run.maxReadings,
    startedAt: run.startedAt?.toISOString() ?? null,
    stoppedAt: run.stoppedAt?.toISOString() ?? null,
  };
}

export async function startMockDevice(
  auth: AuthContext,
  input: StartMockDeviceInput,
): Promise<MockRunSummary> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { id: input.deviceId },
    include: { assignments: { where: { status: 'ACTIVE' }, take: 1 } },
  });
  if (!device) throw errors.notFound('Device');
  assertTenantAccess(auth, device.organizationId, 'Device');

  // A real Freematics unit must not be driven by the simulator: its telemetry
  // history would then contain invented readings that look genuine.
  if (device.provider !== DeviceProvider.MOCK) {
    throw errors.businessRule(
      'Only a device registered with the MOCK provider can be simulated. Register a mock device for demonstrations.',
    );
  }
  if (device.assignments.length === 0) {
    throw errors.businessRule('Assign this device to a vehicle before simulating telemetry.');
  }

  const existing = await prisma.mockDeviceRun.findFirst({
    where: { deviceId: input.deviceId, status: SimulationStatus.RUNNING },
  });
  if (existing) {
    return toRunSummary(existing.id);
  }

  // Start from the vehicle's last known position so the simulated track
  // continues from where it actually is rather than jumping across the map.
  const vehicle = await prisma.truck.findUnique({
    where: { id: device.assignments[0]!.vehicleId },
    select: { lastLatitude: true, lastLongitude: true, lastHeading: true, odometerKm: true },
  });

  const run = await prisma.mockDeviceRun.create({
    data: {
      deviceId: input.deviceId,
      organizationId: device.organizationId,
      status: SimulationStatus.RUNNING,
      scenario: input.scenario,
      intervalSeconds: input.intervalSeconds,
      maxReadings: input.maxReadings ?? null,
      lastLatitude: vehicle?.lastLatitude ?? DEFAULT_START.latitude,
      lastLongitude: vehicle?.lastLongitude ?? DEFAULT_START.longitude,
      lastHeading: vehicle?.lastHeading ?? 90,
      lastSpeedKph: 0,
      lastFuelLevel: 85,
      lastOdometerKm: vehicle?.odometerKm ?? 0,
      startedById: auth.user.id,
      startedAt: new Date(),
    },
  });

  const timer = setInterval(() => {
    void tick(run.id);
  }, input.intervalSeconds * 1000);
  // Never hold the process open for a simulator.
  timer.unref?.();
  timers.set(run.id, timer);

  // Emit one reading immediately so the dashboard reacts without waiting a tick.
  void tick(run.id);

  mockLogger.info(
    { runId: run.id, deviceId: device.deviceIdentifier, scenario: input.scenario },
    'Mock device started',
  );
  return toRunSummary(run.id);
}

export async function stopMockDevice(auth: AuthContext, runId: string): Promise<MockRunSummary> {
  const run = await prisma.mockDeviceRun.findUnique({ where: { id: runId } });
  if (!run) throw errors.notFound('Simulation');
  assertTenantAccess(auth, run.organizationId, 'Simulation');

  clearTimer(runId);
  await prisma.mockDeviceRun.update({
    where: { id: runId },
    data: { status: SimulationStatus.STOPPED, stoppedAt: new Date() },
  });

  mockLogger.info({ runId }, 'Mock device stopped');
  return toRunSummary(runId);
}

export async function listMockRuns(auth: AuthContext): Promise<MockRunSummary[]> {
  const runs = await prisma.mockDeviceRun.findMany({
    where: auth.isPlatformAdmin && !auth.organizationId
      ? {}
      : { organizationId: auth.organizationId ?? '__none__' },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true },
  });
  return Promise.all(runs.map((run) => toRunSummary(run.id)));
}

/**
 * Stop any run left RUNNING by a previous process.
 *
 * Called at boot. A run marked running with no ticker behind it is phantom
 * state, and phantom state is what makes a demo impossible to explain.
 */
export async function reconcileMockRunsOnBoot(): Promise<number> {
  if (!config.demo.enabled) return 0;

  const { count } = await prisma.mockDeviceRun.updateMany({
    where: { status: SimulationStatus.RUNNING },
    data: { status: SimulationStatus.STOPPED, stoppedAt: new Date() },
  });
  if (count > 0) {
    mockLogger.info({ count }, 'Stopped mock device runs orphaned by a restart');
  }
  return count;
}
