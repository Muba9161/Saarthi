import {
  DeviceNetworkType,
  DeviceProvider,
  EMPTY_DEVICE_HEALTH,
  EMPTY_MOTION,
  EMPTY_VEHICLE_DATA,
  TelemetryMetric,
  devicePhoneFrameSchema,
  type DevicePhoneFrame,
  type NormalizedTelemetry,
} from '@saarthi/shared';
import type { AdapterContext, AdapterResult, DeviceAdapter } from './device.adapter';

/**
 * Adapter for the Saarthi Device app.
 *
 * A phone is an unusual telematics device, and the whole job of this file is to
 * be honest about the ways in which it is unusual.
 *
 * Its GPS is real. Its accelerometer is real. Its battery and its radio are
 * real, and they are measurements of something a fleet genuinely cares about —
 * a driver's phone at 4% is a tracker about to go dark. None of that is
 * simulated, and marking it so would keep a real position off the live map.
 *
 * Its RPM, fuel level, coolant temperature and trouble codes are not real and
 * cannot be. A phone has no connection to the engine. Those values come from
 * the app's own simulator, and every one of them is listed in
 * `simulatedMetrics` so that nothing downstream — no gauge, no alert, no AI
 * answer — can present an invented coolant temperature as a measurement.
 *
 * That split is why the adapter exists at all rather than reusing the generic
 * one: the generic adapter has no way to say "these fields are real and those
 * are not", because for every other device Saarthi supports the question does
 * not arise.
 */
export class PhoneDeviceAdapter implements DeviceAdapter {
  readonly provider = DeviceProvider.MOBILE;
  readonly name = 'saarthi-device-app';

  parse(payload: unknown, context: AdapterContext): AdapterResult {
    const warnings: string[] = [];
    const readings: NormalizedTelemetry[] = [];

    // A batch replayed after an outage arrives as an array; a live frame does
    // not. Both are accepted, and `frames` is unwrapped for a client that sends
    // the whole envelope rather than its contents.
    const frames = normaliseFrames(payload);

    for (const frame of frames) {
      const parsed = devicePhoneFrameSchema.safeParse(frame);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        warnings.push(
          issue
            ? `${issue.path.join('.') || 'frame'}: ${issue.message}`
            : 'Frame did not match the Saarthi Device shape.',
        );
        continue;
      }
      readings.push(toReading(parsed.data, context));
    }

    return { readings, warnings };
  }
}

function normaliseFrames(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && 'frames' in payload) {
    const frames = (payload as { frames: unknown }).frames;
    if (Array.isArray(frames)) return frames;
  }
  return [payload];
}

function toReading(frame: DevicePhoneFrame, context: AdapterContext): NormalizedTelemetry {
  const metrics: TelemetryMetric[] = [];
  const simulatedMetrics: TelemetryMetric[] = [];

  // --- Location: measured ---------------------------------------------------
  let location: NormalizedTelemetry['location'] = null;
  if (frame.location) {
    metrics.push(TelemetryMetric.LOCATION);
    // Each optional field is declared only when the fix actually carried it. An
    // indoor fix has no bearing and a cold start has no speed, and reporting
    // either as zero would corrupt the speed series the harsh-driving rules run
    // on.
    if (frame.location.speedKph !== null && frame.location.speedKph !== undefined) {
      metrics.push(TelemetryMetric.SPEED);
    }
    if (frame.location.heading !== null && frame.location.heading !== undefined) {
      metrics.push(TelemetryMetric.HEADING);
    }
    if (frame.location.altitude !== null && frame.location.altitude !== undefined) {
      metrics.push(TelemetryMetric.ALTITUDE);
    }
    if (frame.location.accuracy !== null && frame.location.accuracy !== undefined) {
      metrics.push(TelemetryMetric.GPS_ACCURACY);
    }
    if (frame.location.satellites !== null && frame.location.satellites !== undefined) {
      metrics.push(TelemetryMetric.SATELLITES);
    }

    location = {
      latitude: frame.location.latitude,
      longitude: frame.location.longitude,
      speed: frame.location.speedKph ?? null,
      heading: frame.location.heading ?? null,
      altitude: frame.location.altitude ?? null,
      accuracy: frame.location.accuracy ?? null,
      satellites: frame.location.satellites ?? null,
    };
  }

  // --- Motion: measured -----------------------------------------------------
  //
  // Real accelerometer output from a real phone in a real vehicle. It is *not*
  // equivalent to what a unit bolted to the chassis reports — a handset sliding
  // around a dashboard registers motion the truck never made — so it feeds the
  // harsh-event rules with the same caveat any consumer-grade sensor carries,
  // and is never described as CAN data.
  const motion = { ...EMPTY_MOTION };
  if (frame.motion) {
    const axes = [
      frame.motion.accelerationX,
      frame.motion.accelerationY,
      frame.motion.accelerationZ,
    ];
    if (axes.some((axis) => axis !== null && axis !== undefined)) {
      metrics.push(TelemetryMetric.ACCELEROMETER);
    }
    motion.accelerationX = frame.motion.accelerationX ?? null;
    motion.accelerationY = frame.motion.accelerationY ?? null;
    motion.accelerationZ = frame.motion.accelerationZ ?? null;
    motion.harshBraking = frame.motion.harshBraking ?? false;
    motion.harshAcceleration = frame.motion.harshAcceleration ?? false;
    motion.suddenMovement = frame.motion.suddenMovement ?? false;
  }

  // --- Device health: measured ---------------------------------------------
  const deviceHealth = { ...EMPTY_DEVICE_HEALTH };
  if (frame.health) {
    if (frame.health.signalStrength !== null && frame.health.signalStrength !== undefined) {
      metrics.push(TelemetryMetric.SIGNAL_STRENGTH);
      deviceHealth.signalStrength = frame.health.signalStrength;
    }
  }

  /*
   * --- Engine data: measured ------------------------------------------------
   *
   * Read from the vehicle's ECU over an OBD adapter, so it is declared in
   * `metrics` and deliberately *not* in `simulatedMetrics`. It is applied before
   * the simulated block below, and the simulated block then refuses to overwrite
   * any field already filled — a real coolant temperature must never be replaced
   * by an invented one just because the simulator is also running.
   */
  const vehicleData = { ...EMPTY_VEHICLE_DATA };
  const diagnostics: NormalizedTelemetry['diagnostics'] = [];

  if (frame.vehicle) {
    const engine = frame.vehicle;
    const measured = (metric: TelemetryMetric): void => {
      metrics.push(metric);
    };

    if (engine.rpm !== null && engine.rpm !== undefined) {
      vehicleData.rpm = engine.rpm;
      measured(TelemetryMetric.RPM);
    }
    if (engine.engineLoad !== null && engine.engineLoad !== undefined) {
      vehicleData.engineLoad = engine.engineLoad;
      measured(TelemetryMetric.ENGINE_LOAD);
    }
    if (engine.coolantTemperature !== null && engine.coolantTemperature !== undefined) {
      vehicleData.coolantTemperature = engine.coolantTemperature;
      measured(TelemetryMetric.COOLANT_TEMPERATURE);
    }
    if (engine.intakeTemperature !== null && engine.intakeTemperature !== undefined) {
      vehicleData.intakeTemperature = engine.intakeTemperature;
      measured(TelemetryMetric.INTAKE_TEMPERATURE);
    }
    if (engine.fuelLevel !== null && engine.fuelLevel !== undefined) {
      vehicleData.fuelLevel = engine.fuelLevel;
      measured(TelemetryMetric.FUEL_LEVEL);
    }
    if (engine.fuelRate !== null && engine.fuelRate !== undefined) {
      vehicleData.fuelRate = engine.fuelRate;
      measured(TelemetryMetric.FUEL_RATE);
    }
    if (engine.throttlePosition !== null && engine.throttlePosition !== undefined) {
      vehicleData.throttlePosition = engine.throttlePosition;
      measured(TelemetryMetric.THROTTLE_POSITION);
    }
    if (engine.batteryVoltage !== null && engine.batteryVoltage !== undefined) {
      vehicleData.batteryVoltage = engine.batteryVoltage;
      measured(TelemetryMetric.BATTERY_VOLTAGE);
    }
    if (engine.odometerKm !== null && engine.odometerKm !== undefined) {
      vehicleData.odometerKm = engine.odometerKm;
      measured(TelemetryMetric.ODOMETER);
    }
    if (engine.vin) {
      vehicleData.vin = engine.vin;
      measured(TelemetryMetric.VIN);
    }
    if (engine.diagnostics && engine.diagnostics.length > 0) {
      measured(TelemetryMetric.DTC);
      for (const code of engine.diagnostics) {
        diagnostics.push({
          code: code.code,
          description: code.description ?? null,
          // Read from the ECU's stored-code memory, which is what a confirmed
          // fault means — unlike a simulated one, where no lamp was involved.
          confirmed: true,
        });
      }
    }
  }

  // --- Engine data: simulated ----------------------------------------------
  //
  // Everything below this line is invented by the app. It is stored because the
  // whole point of a test device is to exercise the alert rules, the driver
  // scoring and the AI tools before hardware arrives — but every field is
  // enumerated in `simulatedMetrics` on the way past, so no consumer can mistake
  // it for a measurement.
  if (frame.simulated && frame.simulated.mode !== 'OFF') {
    const engine = frame.simulated;
    /*
     * Fills a gap, never overwrites a measurement.
     *
     * A terminal can run both: an adapter answering coolant while the simulator
     * covers a fuel level the vehicle does not expose. Where both offer the same
     * field the measured one has already been written and stays — anything else
     * would let an invented value shadow a real one, which is the failure the
     * two-block split exists to make impossible.
     */
    const declare = (metric: TelemetryMetric): void => {
      metrics.push(metric);
      simulatedMetrics.push(metric);
    };

    if (vehicleData.rpm === null && engine.rpm !== null && engine.rpm !== undefined) {
      vehicleData.rpm = engine.rpm;
      declare(TelemetryMetric.RPM);
    }
    if (
      vehicleData.engineLoad === null &&
      engine.engineLoad !== null &&
      engine.engineLoad !== undefined
    ) {
      vehicleData.engineLoad = engine.engineLoad;
      declare(TelemetryMetric.ENGINE_LOAD);
    }
    if (
      vehicleData.coolantTemperature === null &&
      engine.coolantTemperature !== null &&
      engine.coolantTemperature !== undefined
    ) {
      vehicleData.coolantTemperature = engine.coolantTemperature;
      declare(TelemetryMetric.COOLANT_TEMPERATURE);
    }
    if (
      vehicleData.fuelLevel === null &&
      engine.fuelLevel !== null &&
      engine.fuelLevel !== undefined
    ) {
      vehicleData.fuelLevel = engine.fuelLevel;
      declare(TelemetryMetric.FUEL_LEVEL);
    }
    if (
      vehicleData.batteryVoltage === null &&
      engine.batteryVoltage !== null &&
      engine.batteryVoltage !== undefined
    ) {
      vehicleData.batteryVoltage = engine.batteryVoltage;
      declare(TelemetryMetric.BATTERY_VOLTAGE);
    }
    if (
      vehicleData.throttlePosition === null &&
      engine.throttlePosition !== null &&
      engine.throttlePosition !== undefined
    ) {
      vehicleData.throttlePosition = engine.throttlePosition;
      declare(TelemetryMetric.THROTTLE_POSITION);
    }
    if (
      vehicleData.odometerKm === null &&
      engine.odometerKm !== null &&
      engine.odometerKm !== undefined
    ) {
      vehicleData.odometerKm = engine.odometerKm;
      declare(TelemetryMetric.ODOMETER);
    }
    if (engine.diagnostics && engine.diagnostics.length > 0) {
      declare(TelemetryMetric.DTC);
      for (const code of engine.diagnostics) {
        diagnostics.push({
          code: code.code,
          description: code.description ?? null,
          // A simulated fault is never presented as confirmed by a malfunction
          // indicator lamp, because no lamp was involved.
          confirmed: false,
        });
      }
    }
  }

  return {
    deviceId: context.deviceIdentifier,
    vehicleId: context.vehicleId,
    recordedAt: frame.recordedAt,
    metrics,
    simulatedMetrics,
    location,
    vehicleData,
    motion,
    deviceHealth,
    diagnostics,
    sequence: frame.sequence ?? null,
    // Kept so the idempotency key and the reported network state survive into
    // storage, where the columns for them do not exist. Small, and the only
    // record of why a duplicate was refused.
    raw: {
      eventId: frame.eventId,
      networkType: frame.health?.networkType ?? DeviceNetworkType.UNKNOWN,
      batteryPercent: frame.health?.batteryPercent ?? null,
      batteryCharging: frame.health?.batteryCharging ?? null,
      simulationMode: frame.simulated?.mode ?? null,
    },
  };
}

/** The idempotency key a frame carried, if any. */
export function clientEventIdOf(reading: NormalizedTelemetry): string | null {
  const raw = reading.raw;
  if (!raw) return null;
  const eventId = (raw as { eventId?: unknown }).eventId;
  return typeof eventId === 'string' ? eventId : null;
}
