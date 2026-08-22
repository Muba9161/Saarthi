import {
  DeviceProvider,
  EMPTY_DEVICE_HEALTH,
  EMPTY_MOTION,
  EMPTY_VEHICLE_DATA,
  TelemetryMetric,
  type NormalizedTelemetry,
  type TelemetryDiagnostic,
} from '@saarthi/shared';
import type { AdapterContext, AdapterResult, DeviceAdapter } from './device.adapter';

/**
 * Freematics ONE+ Model H adapter.
 *
 * The ONE+ firmware reports readings as **OBD-II PIDs keyed by their hex code**,
 * alongside a few device-specific channels for GNSS and the accelerometer. A
 * telemetry frame looks broadly like:
 *
 * ```json
 * { "id": "FRM-0001", "tk": 41234, "0D": 54, "0C": 1450, "05": 87, "2F": 62,
 *   "10A": 26.8467, "10B": 80.9462, "10D": 120, "20": [0.02, -0.45, 0.98] }
 * ```
 *
 * ## Verify before trusting this on real hardware
 *
 * The PID mapping below is standard OBD-II and the channel numbers follow the
 * Freematics data-channel convention, but **the exact frame format depends on
 * the firmware build and the sketch flashed to the device**. Section 60 of the
 * spec requires the payload format to be verified against the physical unit
 * before it is relied on. Until that has happened, treat this adapter as the
 * documented shape it expects rather than a confirmed contract — which is
 * exactly why the mock device exists and why nothing outside this file depends
 * on these key names.
 *
 * Values that are absent are absent. The adapter never substitutes a zero.
 */

/** Standard OBD-II PIDs, as hex strings without the mode prefix. */
const PID = {
  ENGINE_LOAD: '04',
  COOLANT_TEMP: '05',
  RPM: '0C',
  SPEED: '0D',
  INTAKE_TEMP: '0F',
  THROTTLE: '11',
  FUEL_LEVEL: '2F',
  ODOMETER: 'A6',
  BATTERY_VOLTAGE: '42',
  FUEL_RATE: '5E',
} as const;

/** Freematics-specific data channels. */
const CHANNEL = {
  GPS_LATITUDE: '10A',
  GPS_LONGITUDE: '10B',
  GPS_ALTITUDE: '10C',
  GPS_HEADING: '10D',
  GPS_SPEED: '10E',
  GPS_SATELLITES: '110',
  GPS_TIME: '10F',
  ACCELEROMETER: '20',
  DEVICE_TEMP: '24',
  BATTERY_VOLTAGE: '26',
  SIGNAL_STRENGTH: '28',
} as const;

type Frame = Record<string, unknown>;

function num(frame: Frame, key: string): number | null {
  const raw = frame[key];
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

function text(frame: Frame, key: string): string | null {
  const raw = frame[key];
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  return null;
}

/** The accelerometer channel arrives as `[x, y, z]` in g. */
function accelerometer(frame: Frame): { x: number; y: number; z: number } | null {
  const raw = frame[CHANNEL.ACCELEROMETER];
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const [x, y, z] = raw.map((value) => Number(value));
  if (![x, y, z].every((value) => Number.isFinite(value))) return null;
  return { x: x!, y: y!, z: z! };
}

/**
 * Harsh-event thresholds in g.
 *
 * Longitudinal acceleration is the X axis on a ONE+ mounted in its intended
 * orientation. These are conservative: a device fitted at an angle reports part
 * of gravity on the wrong axis, so the alert engine also cross-checks against
 * speed change rather than trusting the accelerometer alone.
 */
const HARSH_BRAKING_G = -0.45;
const HARSH_ACCELERATION_G = 0.4;

function diagnostics(frame: Frame): TelemetryDiagnostic[] {
  const raw = frame['dtc'] ?? frame['DTC'];
  if (!raw) return [];

  const codes = Array.isArray(raw) ? raw : [raw];
  return codes
    .map((entry) => {
      if (typeof entry === 'string') {
        return { code: entry.toUpperCase(), description: null, confirmed: true };
      }
      if (typeof entry === 'object' && entry !== null) {
        const record = entry as Record<string, unknown>;
        const code = typeof record.code === 'string' ? record.code.toUpperCase() : null;
        if (!code) return null;
        return {
          code,
          description: typeof record.description === 'string' ? record.description : null,
          confirmed: record.confirmed !== false,
        };
      }
      return null;
    })
    .filter((entry): entry is TelemetryDiagnostic => entry !== null);
}

function parseFrame(
  frame: Frame,
  context: AdapterContext,
  warnings: string[],
): NormalizedTelemetry | null {
  const metrics: TelemetryMetric[] = [];

  // --- Location -----------------------------------------------------------
  const latitude = num(frame, CHANNEL.GPS_LATITUDE);
  const longitude = num(frame, CHANNEL.GPS_LONGITUDE);

  let location: NormalizedTelemetry['location'] = null;
  if (latitude !== null && longitude !== null) {
    // A ONE+ without a fix reports 0,0 rather than omitting the channel. That
    // is in the Gulf of Guinea, so it would draw a truck in the Atlantic —
    // treat it as "no fix" instead of a position.
    if (latitude === 0 && longitude === 0) {
      warnings.push('GNSS reported 0,0 — treated as no fix.');
    } else {
      metrics.push(TelemetryMetric.LOCATION);

      // Speed can come from GNSS or from the OBD speed PID. GNSS is used when
      // present because it survives the engine being off.
      const gpsSpeed = num(frame, CHANNEL.GPS_SPEED);
      const obdSpeed = num(frame, PID.SPEED);
      const speed = gpsSpeed ?? obdSpeed;
      if (speed !== null) metrics.push(TelemetryMetric.SPEED);

      const heading = num(frame, CHANNEL.GPS_HEADING);
      if (heading !== null) metrics.push(TelemetryMetric.HEADING);

      const altitude = num(frame, CHANNEL.GPS_ALTITUDE);
      if (altitude !== null) metrics.push(TelemetryMetric.ALTITUDE);

      const satellites = num(frame, CHANNEL.GPS_SATELLITES);
      if (satellites !== null) metrics.push(TelemetryMetric.SATELLITES);

      location = {
        latitude,
        longitude,
        speed,
        heading,
        altitude,
        // The ONE+ does not publish an HDOP-derived accuracy figure, so this
        // stays null rather than being guessed from the satellite count.
        accuracy: null,
        satellites: satellites === null ? null : Math.round(satellites),
      };
    }
  }

  // --- Vehicle data -------------------------------------------------------
  const vehicleData = { ...EMPTY_VEHICLE_DATA };

  const rpm = num(frame, PID.RPM);
  if (rpm !== null) {
    vehicleData.rpm = rpm;
    metrics.push(TelemetryMetric.RPM);
  }

  const engineLoad = num(frame, PID.ENGINE_LOAD);
  if (engineLoad !== null) {
    vehicleData.engineLoad = engineLoad;
    metrics.push(TelemetryMetric.ENGINE_LOAD);
  }

  const coolant = num(frame, PID.COOLANT_TEMP);
  if (coolant !== null) {
    vehicleData.coolantTemperature = coolant;
    metrics.push(TelemetryMetric.COOLANT_TEMPERATURE);
  }

  const intake = num(frame, PID.INTAKE_TEMP);
  if (intake !== null) {
    vehicleData.intakeTemperature = intake;
    metrics.push(TelemetryMetric.INTAKE_TEMPERATURE);
  }

  const fuelLevel = num(frame, PID.FUEL_LEVEL);
  if (fuelLevel !== null) {
    vehicleData.fuelLevel = fuelLevel;
    metrics.push(TelemetryMetric.FUEL_LEVEL);
  }

  const fuelRate = num(frame, PID.FUEL_RATE);
  if (fuelRate !== null) {
    vehicleData.fuelRate = fuelRate;
    metrics.push(TelemetryMetric.FUEL_RATE);
  }

  const throttle = num(frame, PID.THROTTLE);
  if (throttle !== null) {
    vehicleData.throttlePosition = throttle;
    metrics.push(TelemetryMetric.THROTTLE_POSITION);
  }

  // Voltage may come from the OBD PID or the device's own sense line.
  const voltage = num(frame, PID.BATTERY_VOLTAGE) ?? num(frame, CHANNEL.BATTERY_VOLTAGE);
  if (voltage !== null) {
    vehicleData.batteryVoltage = voltage;
    metrics.push(TelemetryMetric.BATTERY_VOLTAGE);
  }

  const odometer = num(frame, PID.ODOMETER);
  if (odometer !== null) {
    vehicleData.odometerKm = odometer;
    metrics.push(TelemetryMetric.ODOMETER);
  }

  const vin = text(frame, 'vin') ?? text(frame, 'VIN');
  if (vin !== null) {
    vehicleData.vin = vin;
    metrics.push(TelemetryMetric.VIN);
  }

  // --- Motion -------------------------------------------------------------
  const motion = { ...EMPTY_MOTION };
  const accel = accelerometer(frame);
  if (accel) {
    metrics.push(TelemetryMetric.ACCELEROMETER);
    motion.accelerationX = accel.x;
    motion.accelerationY = accel.y;
    motion.accelerationZ = accel.z;
    motion.harshBraking = accel.x <= HARSH_BRAKING_G;
    motion.harshAcceleration = accel.x >= HARSH_ACCELERATION_G;
    // Lateral spike without longitudinal change reads as a swerve or a pothole.
    motion.suddenMovement = Math.abs(accel.y) >= 0.5;
  }

  // --- Device health ------------------------------------------------------
  const deviceHealth = { ...EMPTY_DEVICE_HEALTH };
  const deviceTemp = num(frame, CHANNEL.DEVICE_TEMP);
  if (deviceTemp !== null) {
    deviceHealth.temperature = deviceTemp;
    metrics.push(TelemetryMetric.DEVICE_TEMPERATURE);
  }
  const signal = num(frame, CHANNEL.SIGNAL_STRENGTH);
  if (signal !== null) {
    deviceHealth.signalStrength = signal;
    metrics.push(TelemetryMetric.SIGNAL_STRENGTH);
  }
  deviceHealth.firmwareVersion = text(frame, 'fw') ?? text(frame, 'firmware');

  // --- Diagnostics --------------------------------------------------------
  const dtcs = diagnostics(frame);
  if (dtcs.length > 0) metrics.push(TelemetryMetric.DTC);

  // A frame carrying no recognisable channel is not a reading. Storing it would
  // add a row that says nothing and inflate the vehicle's telemetry history.
  if (metrics.length === 0) {
    warnings.push('Frame contained no recognised Freematics channel.');
    return null;
  }

  // The ONE+ timestamp channel is milliseconds since device boot, not wall
  // clock, so it cannot date a reading. Server receipt time is used instead and
  // the raw tick is kept for support.
  const recordedAt = context.receivedAt;

  return {
    deviceId: context.deviceIdentifier,
    vehicleId: context.vehicleId,
    recordedAt,
    metrics,
    location,
    vehicleData,
    motion,
    deviceHealth,
    diagnostics: dtcs,
    sequence: num(frame, 'seq') ?? num(frame, 'tk'),
    raw: frame as Record<string, unknown>,
  };
}

export class FreematicsAdapter implements DeviceAdapter {
  readonly provider = DeviceProvider.FREEMATICS;
  readonly name = 'freematics-one-plus-model-h';

  parse(payload: unknown, context: AdapterContext): AdapterResult {
    const warnings: string[] = [];

    // The device batches frames when it has been out of coverage, so a payload
    // is either one frame or an array of them.
    const frames: Frame[] = Array.isArray(payload)
      ? (payload as Frame[])
      : typeof payload === 'object' && payload !== null
        ? [payload as Frame]
        : [];

    if (frames.length === 0) {
      return { readings: [], warnings: ['Payload was not a Freematics frame or batch.'] };
    }

    const readings = frames
      .map((frame) => parseFrame(frame, context, warnings))
      .filter((reading): reading is NormalizedTelemetry => reading !== null);

    return { readings, warnings };
  }
}
