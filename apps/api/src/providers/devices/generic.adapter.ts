import {
  DeviceProvider,
  EMPTY_DEVICE_HEALTH,
  EMPTY_MOTION,
  EMPTY_VEHICLE_DATA,
  TelemetryMetric,
  genericTelemetrySchema,
  type NormalizedTelemetry,
} from '@saarthi/shared';
import type { AdapterContext, AdapterResult, DeviceAdapter } from './device.adapter';

/**
 * Adapter for payloads already in Saarthi's normalised shape.
 *
 * Used by the mock device, the test suite, and any integrator who would rather
 * normalise on their side than have an adapter written for them. It is still a
 * real adapter rather than a bypass: the payload is validated and the `metrics`
 * list is derived from what is actually present, so a caller cannot smuggle in
 * a zero and have it treated as a genuine reading.
 *
 * Serves MOCK, GENERIC_GPS, GENERIC_OBD and GENERIC_CAN — they differ in what
 * they typically send, not in how it is parsed.
 */
export class GenericTelemetryAdapter implements DeviceAdapter {
  readonly name = 'generic-normalized';

  constructor(readonly provider: DeviceProvider) {}

  parse(payload: unknown, context: AdapterContext): AdapterResult {
    const warnings: string[] = [];
    const frames = Array.isArray(payload) ? payload : [payload];
    const readings: NormalizedTelemetry[] = [];

    for (const frame of frames) {
      const parsed = genericTelemetrySchema.safeParse(frame);
      if (!parsed.success) {
        warnings.push(
          parsed.error.issues[0]
            ? `${parsed.error.issues[0].path.join('.')}: ${parsed.error.issues[0].message}`
            : 'Payload did not match the generic telemetry shape.',
        );
        continue;
      }

      const input = parsed.data;
      const metrics: TelemetryMetric[] = [];

      // --- Location -------------------------------------------------------
      let location: NormalizedTelemetry['location'] = null;
      if (input.location) {
        metrics.push(TelemetryMetric.LOCATION);
        if (input.location.speedKph !== undefined) metrics.push(TelemetryMetric.SPEED);
        if (input.location.heading !== undefined) metrics.push(TelemetryMetric.HEADING);
        if (input.location.altitude !== undefined) metrics.push(TelemetryMetric.ALTITUDE);
        if (input.location.accuracy !== undefined) metrics.push(TelemetryMetric.GPS_ACCURACY);
        if (input.location.satellites !== undefined) metrics.push(TelemetryMetric.SATELLITES);

        location = {
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          speed: input.location.speedKph ?? null,
          heading: input.location.heading ?? null,
          altitude: input.location.altitude ?? null,
          accuracy: input.location.accuracy ?? null,
          satellites: input.location.satellites ?? null,
        };
      }

      // --- Vehicle data ---------------------------------------------------
      const vehicleData = { ...EMPTY_VEHICLE_DATA };
      const v = input.vehicleData;
      if (v) {
        const map: [keyof typeof v, keyof typeof vehicleData, TelemetryMetric][] = [
          ['rpm', 'rpm', TelemetryMetric.RPM],
          ['engineLoad', 'engineLoad', TelemetryMetric.ENGINE_LOAD],
          ['coolantTemperature', 'coolantTemperature', TelemetryMetric.COOLANT_TEMPERATURE],
          ['intakeTemperature', 'intakeTemperature', TelemetryMetric.INTAKE_TEMPERATURE],
          ['fuelLevel', 'fuelLevel', TelemetryMetric.FUEL_LEVEL],
          ['fuelRate', 'fuelRate', TelemetryMetric.FUEL_RATE],
          ['throttlePosition', 'throttlePosition', TelemetryMetric.THROTTLE_POSITION],
          ['batteryVoltage', 'batteryVoltage', TelemetryMetric.BATTERY_VOLTAGE],
          ['odometerKm', 'odometerKm', TelemetryMetric.ODOMETER],
        ];
        for (const [source, target, metric] of map) {
          const value = v[source];
          if (typeof value === 'number') {
            (vehicleData[target] as number) = value;
            metrics.push(metric);
          }
        }
        if (v.vin) {
          vehicleData.vin = v.vin;
          metrics.push(TelemetryMetric.VIN);
        }
      }

      // --- Motion ---------------------------------------------------------
      const motion = { ...EMPTY_MOTION };
      if (input.motion) {
        const hasAxes =
          input.motion.accelerationX !== undefined ||
          input.motion.accelerationY !== undefined ||
          input.motion.accelerationZ !== undefined;
        if (hasAxes) metrics.push(TelemetryMetric.ACCELEROMETER);

        motion.accelerationX = input.motion.accelerationX ?? null;
        motion.accelerationY = input.motion.accelerationY ?? null;
        motion.accelerationZ = input.motion.accelerationZ ?? null;
        motion.harshBraking = input.motion.harshBraking ?? false;
        motion.harshAcceleration = input.motion.harshAcceleration ?? false;
        motion.suddenMovement = input.motion.suddenMovement ?? false;
      }

      // --- Device health --------------------------------------------------
      const deviceHealth = { ...EMPTY_DEVICE_HEALTH };
      if (input.deviceHealth) {
        if (typeof input.deviceHealth.temperature === 'number') {
          deviceHealth.temperature = input.deviceHealth.temperature;
          metrics.push(TelemetryMetric.DEVICE_TEMPERATURE);
        }
        if (typeof input.deviceHealth.signalStrength === 'number') {
          deviceHealth.signalStrength = input.deviceHealth.signalStrength;
          metrics.push(TelemetryMetric.SIGNAL_STRENGTH);
        }
        deviceHealth.firmwareVersion = input.deviceHealth.firmwareVersion ?? null;
      }

      const diagnostics = (input.diagnostics ?? []).map((entry) => ({
        code: entry.code.toUpperCase(),
        description: entry.description ?? null,
        confirmed: entry.confirmed,
      }));
      if (diagnostics.length > 0) metrics.push(TelemetryMetric.DTC);

      if (metrics.length === 0) {
        warnings.push('Reading carried no metric values.');
        continue;
      }

      readings.push({
        deviceId: context.deviceIdentifier,
        vehicleId: context.vehicleId,
        recordedAt: input.recordedAt ?? context.receivedAt,
        metrics,
        location,
        vehicleData,
        motion,
        deviceHealth,
        diagnostics,
        sequence: input.sequence ?? null,
        // The payload was already normalised, so keeping a "raw" copy would
        // duplicate every column for no diagnostic value.
        raw: null,
      });
    }

    return { readings, warnings };
  }
}
