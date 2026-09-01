/**
 * Normalised Saarthi telemetry model.
 *
 * Hardware vendors disagree about everything: field names, units, sampling
 * rates, which parameters a given vehicle even exposes. A Freematics ONE+ on a
 * modern OBD-II car reports coolant temperature; the same device on an older
 * J1939 truck may not. So the pipeline is:
 *
 *     vendor payload → adapter → NormalizedTelemetry → storage/rules/realtime
 *
 * Two rules make this trustworthy:
 *
 *  1. Every reading carries `metrics` — the list of values it actually
 *     contains. A consumer that wants RPM must check the list first. An absent
 *     metric is *absent*, never zero, because "0 rpm" and "this vehicle does
 *     not report rpm" mean completely different things to a mechanic.
 *  2. Adapters may only produce this shape. No vendor field name survives past
 *     the adapter boundary, so vendor-specific conditionals cannot leak into
 *     the application.
 */

import { AlertSeverity, TelemetryAlertType, TelemetryMetric } from './enums';

// ---------------------------------------------------------------------------
// The normalised reading
// ---------------------------------------------------------------------------

export interface TelemetryLocation {
  latitude: number;
  longitude: number;
  /** km/h. */
  speed: number | null;
  /** Degrees clockwise from north. */
  heading: number | null;
  altitude: number | null;
  /** Horizontal accuracy in metres. */
  accuracy: number | null;
  satellites: number | null;
}

export interface TelemetryVehicleData {
  rpm: number | null;
  /** Percent 0–100. */
  engineLoad: number | null;
  /** Degrees Celsius. */
  coolantTemperature: number | null;
  intakeTemperature: number | null;
  /** Percent 0–100. */
  fuelLevel: number | null;
  /** Litres per hour. */
  fuelRate: number | null;
  /** Percent 0–100. */
  throttlePosition: number | null;
  batteryVoltage: number | null;
  /** Vehicle-reported odometer in km. */
  odometerKm: number | null;
  vin: string | null;
}

export interface TelemetryMotion {
  /** g-force on each axis, as reported by the device accelerometer. */
  accelerationX: number | null;
  accelerationY: number | null;
  accelerationZ: number | null;
  harshBraking: boolean;
  harshAcceleration: boolean;
  suddenMovement: boolean;
}

export interface TelemetryDeviceHealth {
  /** Device internal temperature in Celsius. */
  temperature: number | null;
  /** Cellular signal strength in dBm, where reported. */
  signalStrength: number | null;
  firmwareVersion: string | null;
}

export interface TelemetryDiagnostic {
  /** Standard OBD-II / J1939 trouble code, e.g. `P0128`. */
  code: string;
  description: string | null;
  /** Malfunction-indicator-lamp state, where the device reports it. */
  confirmed: boolean;
}

/**
 * The single shape every device adapter produces, and the only shape the
 * gateway will accept from an adapter.
 */
export interface NormalizedTelemetry {
  /** Stable device identifier, as printed on the hardware. */
  deviceId: string;
  /** Resolved by the gateway from the device's active assignment. */
  vehicleId: string | null;
  /** When the *device* observed the reading. */
  recordedAt: Date;
  /** Which of the fields below are genuinely present. */
  metrics: TelemetryMetric[];
  /**
   * Metrics in this reading that were produced by a simulator rather than
   * measured.
   *
   * Always a subset of `metrics`. It exists because a phone is not uniformly
   * real or uniformly fake: its GPS fix, its accelerometer and its battery are
   * genuine measurements of a genuine vehicle, while its RPM and coolant
   * temperature come from an on-device simulator because a phone has no access
   * to the engine.
   *
   * A single `simulated` boolean cannot express that. Setting it would brand a
   * real position as fabricated and keep it off the map; leaving it clear would
   * present an invented coolant temperature as a measurement and send a mechanic
   * looking for a fault that does not exist. So the honesty is per metric, and
   * a consumer must check this list before presenting any value as measured.
   */
  simulatedMetrics: TelemetryMetric[];
  location: TelemetryLocation | null;
  vehicleData: TelemetryVehicleData;
  motion: TelemetryMotion;
  deviceHealth: TelemetryDeviceHealth;
  diagnostics: TelemetryDiagnostic[];
  /** Monotonic counter from the device, used for replay detection. */
  sequence: number | null;
  /** Untouched vendor payload, retained for support and adapter debugging. */
  raw: Record<string, unknown> | null;
}

export const EMPTY_VEHICLE_DATA: TelemetryVehicleData = {
  rpm: null,
  engineLoad: null,
  coolantTemperature: null,
  intakeTemperature: null,
  fuelLevel: null,
  fuelRate: null,
  throttlePosition: null,
  batteryVoltage: null,
  odometerKm: null,
  vin: null,
};

export const EMPTY_MOTION: TelemetryMotion = {
  accelerationX: null,
  accelerationY: null,
  accelerationZ: null,
  harshBraking: false,
  harshAcceleration: false,
  suddenMovement: false,
};

export const EMPTY_DEVICE_HEALTH: TelemetryDeviceHealth = {
  temperature: null,
  signalStrength: null,
  firmwareVersion: null,
};

/** True when the reading actually carries the metric. */
export function hasMetric(
  reading: Pick<NormalizedTelemetry, 'metrics'>,
  metric: TelemetryMetric,
): boolean {
  return reading.metrics.includes(metric);
}

/**
 * Read a metric, returning `null` when the reading does not claim to support
 * it. Prefer this over touching the field directly — it is what stops a missing
 * value being rendered as a real zero.
 */
export function readMetric<T>(
  reading: Pick<NormalizedTelemetry, 'metrics'>,
  metric: TelemetryMetric,
  value: T,
): T | null {
  return hasMetric(reading, metric) ? value : null;
}

/**
 * True when this particular metric was fabricated rather than measured.
 *
 * The check a UI must make before labelling a gauge. Written to accept a bare
 * list as well as a reading, because the stored row, the realtime payload and
 * the normalised reading all carry the same array under the same name.
 */
export function isSimulatedMetric(
  source: { simulatedMetrics?: readonly TelemetryMetric[] | readonly string[] | null },
  metric: TelemetryMetric,
): boolean {
  return (source.simulatedMetrics ?? []).includes(metric);
}

// ---------------------------------------------------------------------------
// Plausibility bounds
// ---------------------------------------------------------------------------

/**
 * Physically sensible ranges. A reading outside these is rejected rather than
 * stored: bad hardware and malicious injection look identical at this layer,
 * and neither belongs in the vehicle history.
 */
export const TELEMETRY_BOUNDS = {
  speedKph: { min: 0, max: 200 },
  rpm: { min: 0, max: 9_000 },
  enginePercent: { min: 0, max: 100 },
  coolantTemperature: { min: -40, max: 200 },
  batteryVoltage: { min: 0, max: 60 },
  odometerKm: { min: 0, max: 5_000_000 },
  acceleration: { min: -8, max: 8 },
  heading: { min: 0, max: 360 },
} as const;

/** How far in the future a device clock may run before we distrust it. */
export const TELEMETRY_MAX_CLOCK_SKEW_MS = 5 * 60_000;

/** How far back a reading may be and still be accepted. */
export const TELEMETRY_MAX_AGE_MS = 24 * 60 * 60_000;

/** Silence after which an ACTIVE device is treated as offline. */
export const DEVICE_OFFLINE_AFTER_MS = 10 * 60_000;

export function withinBounds(
  value: number | null | undefined,
  bounds: { min: number; max: number },
): boolean {
  if (value === null || value === undefined) return true;
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
}

// ---------------------------------------------------------------------------
// Alert rules
// ---------------------------------------------------------------------------

export interface TelemetryAlertRuleDefinition {
  type: TelemetryAlertType;
  label: string;
  description: string;
  severity: AlertSeverity;
  /**
   * Comparison threshold. Units depend on the rule and are documented in
   * `thresholdUnit`. `null` means the rule is not threshold-driven.
   */
  defaultThreshold: number | null;
  thresholdUnit: string | null;
  /** Metric the rule needs; a vehicle that cannot report it is skipped. */
  requiresMetric: TelemetryMetric | null;
  /** Seconds before the same rule may fire again for the same vehicle. */
  cooldownSeconds: number;
  /** Whether the rule is on by default for a new organization. */
  enabledByDefault: boolean;
}

export const TELEMETRY_ALERT_RULES: TelemetryAlertRuleDefinition[] = [
  {
    type: TelemetryAlertType.OVERSPEED,
    label: 'Overspeed',
    description: 'Vehicle exceeded the configured speed limit.',
    severity: AlertSeverity.WARNING,
    defaultThreshold: 80,
    thresholdUnit: 'km/h',
    requiresMetric: TelemetryMetric.SPEED,
    cooldownSeconds: 300,
    enabledByDefault: true,
  },
  {
    type: TelemetryAlertType.HARSH_BRAKING,
    label: 'Harsh braking',
    description: 'Deceleration sharper than the configured threshold.',
    severity: AlertSeverity.WARNING,
    defaultThreshold: 0.45,
    thresholdUnit: 'g',
    requiresMetric: TelemetryMetric.ACCELEROMETER,
    cooldownSeconds: 60,
    enabledByDefault: true,
  },
  {
    type: TelemetryAlertType.HARSH_ACCELERATION,
    label: 'Harsh acceleration',
    description: 'Acceleration sharper than the configured threshold.',
    severity: AlertSeverity.WARNING,
    defaultThreshold: 0.4,
    thresholdUnit: 'g',
    requiresMetric: TelemetryMetric.ACCELEROMETER,
    cooldownSeconds: 60,
    enabledByDefault: true,
  },
  {
    type: TelemetryAlertType.EXCESSIVE_IDLING,
    label: 'Excessive idling',
    description: 'Engine running while stationary for longer than allowed.',
    severity: AlertSeverity.INFO,
    defaultThreshold: 10,
    thresholdUnit: 'minutes',
    requiresMetric: TelemetryMetric.RPM,
    cooldownSeconds: 900,
    enabledByDefault: true,
  },
  {
    type: TelemetryAlertType.ENGINE_TEMPERATURE,
    label: 'Engine temperature',
    description: 'Coolant temperature above the safe operating range.',
    severity: AlertSeverity.CRITICAL,
    defaultThreshold: 105,
    thresholdUnit: '°C',
    requiresMetric: TelemetryMetric.COOLANT_TEMPERATURE,
    cooldownSeconds: 600,
    enabledByDefault: true,
  },
  {
    type: TelemetryAlertType.LOW_VOLTAGE,
    label: 'Low battery voltage',
    description: 'Battery voltage below the threshold — charging or battery fault.',
    severity: AlertSeverity.WARNING,
    defaultThreshold: 11.8,
    thresholdUnit: 'V',
    requiresMetric: TelemetryMetric.BATTERY_VOLTAGE,
    cooldownSeconds: 3600,
    enabledByDefault: true,
  },
  {
    type: TelemetryAlertType.FUEL_DROP,
    label: 'Sudden fuel drop',
    description: 'Fuel level fell faster than normal consumption explains.',
    severity: AlertSeverity.WARNING,
    defaultThreshold: 15,
    thresholdUnit: '% in one reading',
    requiresMetric: TelemetryMetric.FUEL_LEVEL,
    cooldownSeconds: 900,
    enabledByDefault: true,
  },
  {
    type: TelemetryAlertType.DEVICE_OFFLINE,
    label: 'Device offline',
    description: 'Device stopped reporting for longer than the offline threshold.',
    severity: AlertSeverity.WARNING,
    defaultThreshold: 10,
    thresholdUnit: 'minutes',
    requiresMetric: null,
    cooldownSeconds: 1800,
    enabledByDefault: true,
  },
  {
    type: TelemetryAlertType.DIAGNOSTIC_FAULT,
    label: 'Diagnostic fault',
    description: 'Vehicle reported a diagnostic trouble code.',
    severity: AlertSeverity.CRITICAL,
    defaultThreshold: null,
    thresholdUnit: null,
    requiresMetric: TelemetryMetric.DTC,
    cooldownSeconds: 3600,
    enabledByDefault: true,
  },
  {
    type: TelemetryAlertType.GEOFENCE_BREACH,
    label: 'Geofence breach',
    description: 'Vehicle entered or left a monitored area.',
    severity: AlertSeverity.WARNING,
    defaultThreshold: null,
    thresholdUnit: null,
    requiresMetric: TelemetryMetric.LOCATION,
    cooldownSeconds: 300,
    enabledByDefault: false,
  },
  {
    type: TelemetryAlertType.ROUTE_DEVIATION,
    label: 'Route deviation',
    description: 'Vehicle left the planned trip corridor.',
    severity: AlertSeverity.WARNING,
    defaultThreshold: 5,
    thresholdUnit: 'km',
    requiresMetric: TelemetryMetric.LOCATION,
    cooldownSeconds: 600,
    enabledByDefault: false,
  },
  {
    type: TelemetryAlertType.UNUSUAL_BEHAVIOUR,
    label: 'Unusual behaviour',
    description: 'Combination of readings outside this vehicle’s normal pattern.',
    severity: AlertSeverity.INFO,
    defaultThreshold: null,
    thresholdUnit: null,
    requiresMetric: null,
    cooldownSeconds: 3600,
    enabledByDefault: false,
  },
];

const RULES_BY_TYPE = new Map<TelemetryAlertType, TelemetryAlertRuleDefinition>(
  TELEMETRY_ALERT_RULES.map((rule) => [rule.type, rule]),
);

export function telemetryAlertRule(
  type: TelemetryAlertType,
): TelemetryAlertRuleDefinition | undefined {
  return RULES_BY_TYPE.get(type);
}

/**
 * Driver-score weight of a telemetry alert. Positive values are never awarded
 * here — good driving is credited from trip completion, not from the absence of
 * an alert — so every entry is a deduction with a stated reason.
 */
export const TELEMETRY_SCORE_PENALTIES: Partial<Record<TelemetryAlertType, number>> = {
  [TelemetryAlertType.OVERSPEED]: -4,
  [TelemetryAlertType.HARSH_BRAKING]: -3,
  [TelemetryAlertType.HARSH_ACCELERATION]: -3,
  [TelemetryAlertType.EXCESSIVE_IDLING]: -2,
  [TelemetryAlertType.ROUTE_DEVIATION]: -3,
};

// ---------------------------------------------------------------------------
// Maintenance rules
// ---------------------------------------------------------------------------

/**
 * Deterministic telemetry → maintenance recommendations.
 *
 * Deliberately *not* called predictive maintenance: these are threshold rules a
 * mechanic could state in one sentence. Prediction requires a fleet-history
 * baseline the platform does not have yet, and claiming it before then would be
 * dishonest.
 */
export interface MaintenanceRuleDefinition {
  code: string;
  label: string;
  /** Plain-language explanation shown to the owner. */
  reason: string;
  triggerAlert: TelemetryAlertType;
  /** How many times the alert must fire in the window before recommending. */
  occurrences: number;
  windowDays: number;
  recommendation: string;
}

export const TELEMETRY_MAINTENANCE_RULES: MaintenanceRuleDefinition[] = [
  {
    code: 'COOLING_SYSTEM_CHECK',
    label: 'Cooling system inspection',
    reason: 'Coolant temperature has repeatedly exceeded its safe range.',
    triggerAlert: TelemetryAlertType.ENGINE_TEMPERATURE,
    occurrences: 3,
    windowDays: 7,
    recommendation: 'Inspect radiator, coolant level, thermostat and fan operation.',
  },
  {
    code: 'CHARGING_SYSTEM_CHECK',
    label: 'Battery and charging check',
    reason: 'Battery voltage has repeatedly dropped below the healthy threshold.',
    triggerAlert: TelemetryAlertType.LOW_VOLTAGE,
    occurrences: 3,
    windowDays: 14,
    recommendation: 'Test battery health, alternator output and earth connections.',
  },
  {
    code: 'BRAKE_INSPECTION',
    label: 'Brake inspection',
    reason: 'A high number of harsh-braking events suggests brake or driving-style review.',
    triggerAlert: TelemetryAlertType.HARSH_BRAKING,
    occurrences: 15,
    windowDays: 30,
    recommendation: 'Inspect brake pads and discs, and review driving style with the driver.',
  },
  {
    code: 'DIAGNOSTIC_FOLLOW_UP',
    label: 'Diagnostic follow-up',
    reason: 'The vehicle reported a diagnostic trouble code.',
    triggerAlert: TelemetryAlertType.DIAGNOSTIC_FAULT,
    occurrences: 1,
    windowDays: 1,
    recommendation: 'Read the stored fault codes with a scan tool and address the cause.',
  },
];
