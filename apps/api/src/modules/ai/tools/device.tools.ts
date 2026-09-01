import { z } from 'zod';
import {
  DEVICE_HEARTBEAT_TIMEOUT_SECONDS,
  Feature,
  Permission,
  TelemetryMetric,
  distanceKm,
} from '@saarthi/shared';
import { prisma } from '../../../database/prisma';
import { readDeviceStatus } from '../../devices/device-status.service';
import { ResultBasis, type AiTool, type ToolResult } from './tool.types';

/**
 * Device and test-drive tools.
 *
 * Section 41 of the device specification asks for questions like "summarise
 * this vehicle's trip", "how fast did it travel", "did the device lose
 * connection" — and is explicit that the model must use real Saarthi results
 * and never invent data. These tools are how that holds: the model gets an
 * answer computed here from stored readings, labelled with what kind of
 * statement it is, and told what the query could not see.
 *
 * Two things about this file are load-bearing.
 *
 * **Simulated values are separated, always.** A phone standing in for fitted
 * hardware sends a real position alongside an invented RPM. If a summary folded
 * the two together, an owner would read "peak RPM 2,900" and take it as a
 * measurement of their engine. So every figure derived from a simulated metric
 * is reported under its own heading, and the caveats say so in words the model
 * is instructed to relay.
 *
 * **Gaps are reported, not smoothed.** The most dangerous answer here is a
 * confident summary of a drive the device only witnessed half of. A window with
 * no readings is a fact about the data, and it is returned as one.
 */

const result = <T>(
  data: T,
  options: {
    basis?: ResultBasis;
    references?: ToolResult['references'];
    caveats?: string[];
    recordCount?: number;
  } = {},
): ToolResult<T> => ({
  data,
  basis: options.basis ?? ResultBasis.SOURCE_DATA,
  references: options.references ?? [],
  caveats: options.caveats ?? [],
  recordCount: options.recordCount ?? 1,
});

/** Load a vehicle inside the caller's tenant, or refuse in words. */
async function loadVehicle(organizationId: string, vehicleId: string) {
  const vehicle = await prisma.truck.findFirst({
    where: { id: vehicleId, organizationId },
    select: { id: true, registrationNumber: true, vehicleType: true },
  });
  if (!vehicle) throw new Error('No vehicle with that id in your fleet.');
  return vehicle;
}

/** Bound every window, so one question cannot scan a year of telemetry. */
const windowArgs = z.object({
  vehicleId: z.string().uuid().describe('The vehicle to analyse, as a Saarthi id.'),
  hours: z
    .number()
    .int()
    .min(1)
    .max(168)
    .default(24)
    .describe('How far back to look, in hours. Maximum one week.'),
});

const MAX_READINGS = 5_000;

export const DEVICE_TOOLS: AiTool[] = [
  {
    name: 'list_vehicle_devices',
    description:
      'List the devices fitted to a vehicle — telematics units, cameras and phones running the Saarthi Device app — with what each one is currently reporting about itself.',
    input: z.object({
      vehicleId: z.string().uuid().describe('The vehicle to look up, as a Saarthi id.'),
    }),
    permissions: [Permission.DEVICES_READ],
    feature: Feature.HARDWARE_CONNECTIVITY,
    category: 'vehicle',
    cacheTtlSeconds: 15,
    handler: async ({ organizationId }, input) => {
      const { vehicleId } = input as { vehicleId: string };
      const vehicle = await loadVehicle(organizationId, vehicleId);

      const assignments = await prisma.deviceAssignment.findMany({
        where: { vehicleId, status: 'ACTIVE' },
        include: {
          device: {
            select: {
              id: true,
              deviceIdentifier: true,
              provider: true,
              deviceType: true,
              role: true,
              status: true,
              lastSeenAt: true,
              lastTelemetryAt: true,
              lastHeartbeatAt: true,
              batteryPercent: true,
              networkType: true,
            },
          },
        },
      });

      const devices = await Promise.all(
        assignments.map(async (assignment) => {
          const live = await readDeviceStatus(assignment.device.id);
          return {
            deviceId: assignment.device.id,
            deviceIdentifier: assignment.device.deviceIdentifier,
            provider: assignment.device.provider,
            deviceType: assignment.device.deviceType,
            role: assignment.device.role,
            status: assignment.device.status,
            fittedSince: assignment.assignedAt.toISOString(),
            lastTelemetryAt: assignment.device.lastTelemetryAt?.toISOString() ?? null,
            lastHeartbeatAt: assignment.device.lastHeartbeatAt?.toISOString() ?? null,
            // The live snapshot when there is one, the stored summary when the
            // device has gone quiet. Which of the two answered is stated, so
            // the model does not describe a stale figure as current.
            batteryPercent: live?.batteryPercent ?? assignment.device.batteryPercent,
            networkType: live?.networkType ?? assignment.device.networkType,
            healthIsLive: live !== null,
          };
        }),
      );

      return result(
        { vehicle: vehicle.registrationNumber, devices },
        {
          references: [
            { type: 'vehicle', id: vehicle.id, label: vehicle.registrationNumber },
          ],
          recordCount: devices.length,
          caveats:
            devices.length === 0
              ? ['No devices are currently fitted to this vehicle.']
              : devices.some((device) => !device.healthIsLive)
                ? [
                    'Some figures are the last stored values rather than live readings, because those devices have not reported recently.',
                  ]
                : [],
        },
      );
    },
  },

  {
    name: 'summarise_vehicle_drive',
    description:
      "Summarise how a vehicle moved over a period: distance, duration, maximum and average speed, time spent moving, and how much of the period the device actually covered. Use this to answer questions about a test drive or a day's running.",
    input: windowArgs,
    permissions: [Permission.TELEMETRY_READ],
    feature: Feature.TELEMETRY_HISTORY,
    category: 'vehicle',
    cacheTtlSeconds: 60,
    handler: async ({ organizationId }, input) => {
      const { vehicleId, hours } = input as { vehicleId: string; hours: number };
      const vehicle = await loadVehicle(organizationId, vehicleId);
      const since = new Date(Date.now() - hours * 3_600_000);

      const readings = await prisma.telemetryReading.findMany({
        where: {
          vehicleId,
          organizationId,
          recordedAt: { gte: since },
          metrics: { has: TelemetryMetric.LOCATION },
        },
        select: {
          latitude: true,
          longitude: true,
          speedKph: true,
          recordedAt: true,
          simulated: true,
        },
        orderBy: { recordedAt: 'asc' },
        take: MAX_READINGS,
      });

      const caveats: string[] = [];

      if (readings.length === 0) {
        return result(
          {
            vehicle: vehicle.registrationNumber,
            windowHours: hours,
            readingCount: 0,
            summary: 'No positions were recorded for this vehicle in the period.',
          },
          {
            references: [{ type: 'vehicle', id: vehicle.id, label: vehicle.registrationNumber }],
            recordCount: 0,
            caveats: [
              'There is no location data for this window, so nothing can be said about how the vehicle moved. That may mean the vehicle did not move, or that no device was reporting.',
            ],
          },
        );
      }

      if (readings.length >= MAX_READINGS) {
        caveats.push(
          `Only the first ${MAX_READINGS} readings in this window were analysed, so the figures cover part of the period rather than all of it.`,
        );
      }

      let distanceTravelledKm = 0;
      let maxSpeedKph = 0;
      let speedSum = 0;
      let speedSamples = 0;
      let movingSeconds = 0;
      let stationarySeconds = 0;
      /** Gaps long enough that the device was plainly not reporting. */
      const gaps: { from: string; to: string; minutes: number }[] = [];
      const GAP_THRESHOLD_MS = 5 * 60_000;

      for (let index = 1; index < readings.length; index += 1) {
        const previous = readings[index - 1]!;
        const current = readings[index]!;
        const elapsedMs = current.recordedAt.getTime() - previous.recordedAt.getTime();

        if (elapsedMs > GAP_THRESHOLD_MS) {
          gaps.push({
            from: previous.recordedAt.toISOString(),
            to: current.recordedAt.toISOString(),
            minutes: Math.round(elapsedMs / 60_000),
          });
          // Not counted as either moving or stationary: nobody knows what the
          // vehicle did while nothing was watching, and guessing would be the
          // whole failure this tool exists to avoid.
          continue;
        }

        distanceTravelledKm += distanceKm(
          { latitude: previous.latitude!, longitude: previous.longitude! },
          { latitude: current.latitude!, longitude: current.longitude! },
        );

        const speed = current.speedKph;
        if (speed !== null) {
          if (speed > maxSpeedKph) maxSpeedKph = speed;
          speedSum += speed;
          speedSamples += 1;
          if (speed > 3) movingSeconds += elapsedMs / 1000;
          else stationarySeconds += elapsedMs / 1000;
        }
      }

      const first = readings[0]!;
      const last = readings[readings.length - 1]!;
      const observedMinutes = Math.round(
        (last.recordedAt.getTime() - first.recordedAt.getTime()) / 60_000,
      );
      const gapMinutes = gaps.reduce((sum, gap) => sum + gap.minutes, 0);

      if (gaps.length > 0) {
        caveats.push(
          `The device stopped reporting ${gaps.length} time(s), for ${gapMinutes} minutes in total. Distance and moving time exclude those gaps and are therefore lower bounds.`,
        );
      }
      if (readings.some((reading) => reading.simulated)) {
        caveats.push(
          'Some of these positions came from the simulator rather than a real device.',
        );
      }
      if (speedSamples === 0) {
        caveats.push('No speed was reported with these positions, so speed figures are unavailable.');
      }

      return result(
        {
          vehicle: vehicle.registrationNumber,
          windowHours: hours,
          firstReadingAt: first.recordedAt.toISOString(),
          lastReadingAt: last.recordedAt.toISOString(),
          observedMinutes,
          reportingGapMinutes: gapMinutes,
          distanceTravelledKm: Number(distanceTravelledKm.toFixed(2)),
          maxSpeedKph: speedSamples > 0 ? Number(maxSpeedKph.toFixed(1)) : null,
          averageSpeedKph:
            speedSamples > 0 ? Number((speedSum / speedSamples).toFixed(1)) : null,
          movingMinutes: Math.round(movingSeconds / 60),
          stationaryMinutes: Math.round(stationarySeconds / 60),
          readingCount: readings.length,
        },
        {
          // Computed by Saarthi from stored readings — a calculation, not a
          // stored fact, and the model is required to say so.
          basis: ResultBasis.RULE_RESULT,
          references: [{ type: 'vehicle', id: vehicle.id, label: vehicle.registrationNumber }],
          recordCount: readings.length,
          caveats,
        },
      );
    },
  },

  {
    name: 'check_device_connectivity',
    description:
      'Report whether a vehicle\'s device kept its connection over a period: how long it was silent, when the gaps were, and what it last said about its own battery and network.',
    input: windowArgs,
    permissions: [Permission.DEVICES_READ],
    feature: Feature.HARDWARE_CONNECTIVITY,
    category: 'vehicle',
    cacheTtlSeconds: 30,
    handler: async ({ organizationId }, input) => {
      const { vehicleId, hours } = input as { vehicleId: string; hours: number };
      const vehicle = await loadVehicle(organizationId, vehicleId);
      const since = new Date(Date.now() - hours * 3_600_000);

      const assignment = await prisma.deviceAssignment.findFirst({
        where: { vehicleId, status: 'ACTIVE' },
        include: {
          device: {
            select: {
              id: true,
              deviceIdentifier: true,
              provider: true,
              status: true,
              lastHeartbeatAt: true,
              lastTelemetryAt: true,
              batteryPercent: true,
              networkType: true,
              bufferedEvents: true,
            },
          },
        },
      });

      if (!assignment) {
        return result(
          { vehicle: vehicle.registrationNumber, device: null },
          {
            references: [{ type: 'vehicle', id: vehicle.id, label: vehicle.registrationNumber }],
            recordCount: 0,
            caveats: ['No device is currently fitted to this vehicle.'],
          },
        );
      }

      const events = await prisma.deviceEvent.findMany({
        where: {
          deviceId: assignment.device.id,
          createdAt: { gte: since },
          eventType: { in: ['OFFLINE', 'ONLINE', 'HEARTBEAT_MISSED', 'REJECTED_PAYLOAD'] },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });

      const live = await readDeviceStatus(assignment.device.id);
      const silentSeconds = assignment.device.lastHeartbeatAt
        ? Math.floor((Date.now() - assignment.device.lastHeartbeatAt.getTime()) / 1000)
        : null;

      const caveats: string[] = [];
      if (!assignment.device.lastHeartbeatAt) {
        caveats.push(
          'This device does not report a heartbeat, so connectivity can only be inferred from when it last sent telemetry.',
        );
      }
      if (live === null && assignment.device.lastHeartbeatAt) {
        caveats.push('Saarthi has not heard from this device recently.');
      }

      return result(
        {
          vehicle: vehicle.registrationNumber,
          device: {
            deviceIdentifier: assignment.device.deviceIdentifier,
            provider: assignment.device.provider,
            status: assignment.device.status,
            reachable: live !== null,
            silentForSeconds: silentSeconds,
            silenceThresholdSeconds: DEVICE_HEARTBEAT_TIMEOUT_SECONDS,
            lastHeartbeatAt: assignment.device.lastHeartbeatAt?.toISOString() ?? null,
            lastTelemetryAt: assignment.device.lastTelemetryAt?.toISOString() ?? null,
            batteryPercent: live?.batteryPercent ?? assignment.device.batteryPercent,
            networkType: live?.networkType ?? assignment.device.networkType,
            // Events the device is holding because it could not upload them.
            bufferedEvents: live?.bufferedEvents ?? assignment.device.bufferedEvents,
          },
          windowHours: hours,
          events: events.map((event) => ({
            at: event.createdAt.toISOString(),
            type: event.eventType,
            description: event.description,
          })),
        },
        {
          references: [
            { type: 'vehicle', id: vehicle.id, label: vehicle.registrationNumber },
            {
              type: 'device',
              id: assignment.device.id,
              label: assignment.device.deviceIdentifier,
            },
          ],
          recordCount: events.length,
          caveats,
        },
      );
    },
  },

  {
    name: 'check_vehicle_telemetry_readings',
    description:
      'Report the engine and motion values a vehicle sent over a period, keeping measured values and simulated ones separate. Use this to answer questions about RPM, fuel, coolant temperature, battery voltage or unusual motion.',
    input: windowArgs,
    permissions: [Permission.TELEMETRY_READ],
    feature: Feature.TELEMETRY_HISTORY,
    category: 'vehicle',
    cacheTtlSeconds: 60,
    handler: async ({ organizationId }, input) => {
      const { vehicleId, hours } = input as { vehicleId: string; hours: number };
      const vehicle = await loadVehicle(organizationId, vehicleId);
      const since = new Date(Date.now() - hours * 3_600_000);

      const readings = await prisma.telemetryReading.findMany({
        where: { vehicleId, organizationId, recordedAt: { gte: since } },
        select: {
          metrics: true,
          simulatedMetrics: true,
          rpm: true,
          fuelLevel: true,
          coolantTemperature: true,
          batteryVoltage: true,
          engineLoad: true,
          harshBraking: true,
          harshAcceleration: true,
          suddenMovement: true,
          recordedAt: true,
        },
        orderBy: { recordedAt: 'asc' },
        take: MAX_READINGS,
      });

      if (readings.length === 0) {
        return result(
          { vehicle: vehicle.registrationNumber, windowHours: hours, readingCount: 0 },
          {
            references: [{ type: 'vehicle', id: vehicle.id, label: vehicle.registrationNumber }],
            recordCount: 0,
            caveats: ['This vehicle reported no telemetry in the period.'],
          },
        );
      }

      /**
       * Summarise one metric, keeping the two provenances apart.
       *
       * The separation is the entire point. A phone's invented RPM and a
       * Freematics' measured RPM must never be averaged into one number that
       * somebody then acts on.
       */
      function summarise(
        metric: TelemetryMetric,
        pick: (reading: (typeof readings)[number]) => number | null,
      ) {
        const measured: number[] = [];
        const simulated: number[] = [];
        for (const reading of readings) {
          if (!reading.metrics.includes(metric)) continue;
          const value = pick(reading);
          if (value === null) continue;
          if (reading.simulatedMetrics.includes(metric)) simulated.push(value);
          else measured.push(value);
        }
        const describe = (values: number[]) =>
          values.length === 0
            ? null
            : {
                min: Number(Math.min(...values).toFixed(1)),
                max: Number(Math.max(...values).toFixed(1)),
                average: Number(
                  (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1),
                ),
                samples: values.length,
              };
        return { measured: describe(measured), simulated: describe(simulated) };
      }

      const engine = {
        rpm: summarise(TelemetryMetric.RPM, (reading) => reading.rpm),
        fuelLevelPercent: summarise(TelemetryMetric.FUEL_LEVEL, (reading) => reading.fuelLevel),
        coolantTemperatureC: summarise(
          TelemetryMetric.COOLANT_TEMPERATURE,
          (reading) => reading.coolantTemperature,
        ),
        batteryVoltage: summarise(
          TelemetryMetric.BATTERY_VOLTAGE,
          (reading) => reading.batteryVoltage,
        ),
        engineLoadPercent: summarise(
          TelemetryMetric.ENGINE_LOAD,
          (reading) => reading.engineLoad,
        ),
      };

      const motion = {
        harshBrakingEvents: readings.filter((reading) => reading.harshBraking).length,
        harshAccelerationEvents: readings.filter((reading) => reading.harshAcceleration).length,
        suddenMovementEvents: readings.filter((reading) => reading.suddenMovement).length,
      };

      const caveats: string[] = [];
      const hasSimulated = Object.values(engine).some((entry) => entry.simulated !== null);
      if (hasSimulated) {
        caveats.push(
          'Figures listed under "simulated" were produced by a test device, not measured from the engine. They must never be presented as readings from the vehicle.',
        );
      }
      if (readings.length >= MAX_READINGS) {
        caveats.push(
          `Only the first ${MAX_READINGS} readings were analysed, so the figures cover part of the period.`,
        );
      }
      const noEngineData = Object.values(engine).every(
        (entry) => entry.measured === null && entry.simulated === null,
      );
      if (noEngineData) {
        caveats.push(
          'No engine data was reported. The device fitted to this vehicle cannot read the engine — a phone, for example, has no access to it.',
        );
      }

      return result(
        { vehicle: vehicle.registrationNumber, windowHours: hours, engine, motion },
        {
          basis: ResultBasis.RULE_RESULT,
          references: [{ type: 'vehicle', id: vehicle.id, label: vehicle.registrationNumber }],
          recordCount: readings.length,
          caveats,
        },
      );
    },
  },
] as AiTool[];
