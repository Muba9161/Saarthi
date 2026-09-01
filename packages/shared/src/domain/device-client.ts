/**
 * The Saarthi Device client contract.
 *
 * A phone running the Saarthi Device app is a *device*, not a privileged
 * frontend. It enrols, authenticates, pairs to a vehicle and posts through the
 * same gateway a Freematics ONE+ posts through, and it is bound by the same
 * rules: it never touches Redis or PostgreSQL, it never asserts which vehicle
 * it belongs to, and everything it sends is untrusted until the gateway has
 * finished with it.
 *
 * What lives here is the shared vocabulary — intervals, ceilings, thresholds
 * and the simulator's shape — so the API, the dashboard and the Android client
 * cannot drift apart about what a reasonable reporting interval is or how many
 * events a phone may hold offline.
 */

import type {
  DeviceCommandType,
  DeviceNetworkType,
  DeviceProvider,
  DeviceRole,
  DeviceSubsystemStatus,
  DeviceType,
} from './enums';
import { TelemetryMetric } from './enums';

// ---------------------------------------------------------------------------
// Reporting cadence
// ---------------------------------------------------------------------------

/**
 * Location reporting presets (device specification section 13).
 *
 * `TESTING` exists so a developer can watch a marker move in real time; it is
 * deliberately not the default, because one second of GPS for a working day is
 * 28,800 rows and a flat battery.
 */
export const LOCATION_REPORTING_PRESETS = {
  TESTING: 1,
  NORMAL: 5,
  BATTERY_SAVER: 15,
} as const;
export type LocationReportingPreset = keyof typeof LOCATION_REPORTING_PRESETS;

export const MIN_REPORTING_INTERVAL_SECONDS = 1;
export const MAX_REPORTING_INTERVAL_SECONDS = 300;
export const DEFAULT_REPORTING_INTERVAL_SECONDS = LOCATION_REPORTING_PRESETS.NORMAL;

/** How often a paired device reports it is alive, independently of telemetry. */
export const DEVICE_HEARTBEAT_INTERVAL_SECONDS = 30;

/**
 * Silence after which a heartbeat-capable device is treated as unreachable.
 *
 * Shorter than `DEVICE_OFFLINE_AFTER_MS`, which governs *telemetry* silence: a
 * parked phone stops producing positions long before it stops being connected,
 * and conflating the two would report every stationary vehicle as a fault.
 */
export const DEVICE_HEARTBEAT_TIMEOUT_SECONDS = 180;

// ---------------------------------------------------------------------------
// Offline buffering (section 18)
// ---------------------------------------------------------------------------

/**
 * Local buffering limits.
 *
 * Bounded on purpose. An unbounded queue on a phone that has been out of
 * coverage for a week is a full disk and a crash, and the oldest positions are
 * the least useful ones to keep — so the buffer drops from the front.
 */
export const DEVICE_BUFFER = {
  /** Hard ceiling on locally held events before the oldest are discarded. */
  maxEvents: 5_000,
  /** Events per upload batch. The gateway accepts up to 200 frames. */
  maxBatchSize: 100,
  /** Events older than this are dropped rather than uploaded. */
  maxAgeHours: 24,
} as const;

/** Backoff for a device that cannot reach the gateway (section 44). */
export const DEVICE_RETRY_BACKOFF = {
  initialMs: 2_000,
  maxMs: 120_000,
  multiplier: 2,
  /** Random spread applied to each delay, so devices do not reconnect in step. */
  jitterRatio: 0.2,
} as const;

// ---------------------------------------------------------------------------
// Credentials (sections 15 and 45)
// ---------------------------------------------------------------------------

/** Device access tokens are short-lived; the secret is what refreshes them. */
export const DEVICE_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** A pairing QR is useless within five minutes of being displayed. */
export const DEVICE_PAIRING_TOKEN_TTL_SECONDS = 300;

/**
 * How long an enrolled-but-never-paired device is kept.
 *
 * Self-enrolment is open by design, so it needs a sweep: a device that never
 * redeems a pairing token holds no tenant, no vehicle and no data, and keeping
 * it would turn an anonymous endpoint into unbounded growth.
 */
export const DEVICE_PENDING_ENROLMENT_TTL_HOURS = 24;

/** Idempotency window for replayed offline events. */
export const DEVICE_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Capability declaration
// ---------------------------------------------------------------------------

/**
 * What a phone can genuinely report.
 *
 * Deliberately excludes RPM, fuel, coolant, engine load and trouble codes. A
 * phone has no access to the engine; those values come from the on-device
 * simulator and are marked simulated, never advertised as device capability.
 */
export const MOBILE_DEVICE_METRICS: TelemetryMetric[] = [
  TelemetryMetric.LOCATION,
  TelemetryMetric.SPEED,
  TelemetryMetric.HEADING,
  TelemetryMetric.ALTITUDE,
  TelemetryMetric.GPS_ACCURACY,
  TelemetryMetric.ACCELEROMETER,
  TelemetryMetric.SIGNAL_STRENGTH,
];

/** Metrics only an engine-connected device can truthfully produce. */
export const ENGINE_ONLY_METRICS: TelemetryMetric[] = [
  TelemetryMetric.RPM,
  TelemetryMetric.ENGINE_LOAD,
  TelemetryMetric.COOLANT_TEMPERATURE,
  TelemetryMetric.INTAKE_TEMPERATURE,
  TelemetryMetric.FUEL_LEVEL,
  TelemetryMetric.FUEL_RATE,
  TelemetryMetric.THROTTLE_POSITION,
  TelemetryMetric.ODOMETER,
  TelemetryMetric.VIN,
  TelemetryMetric.DTC,
];

/** The camera channels a phone registers when it pairs. */
export const MOBILE_CAMERA_CHANNELS = [
  { channel: 1, position: 'FRONT', label: 'Road-facing camera' },
  { channel: 2, position: 'CABIN', label: 'Cabin-facing camera' },
] as const;

// ---------------------------------------------------------------------------
// Vehicle telemetry simulation (section 23)
// ---------------------------------------------------------------------------

/**
 * Simulation profiles for the values a phone cannot read.
 *
 * Every figure produced from one of these is stamped simulated end to end — in
 * the reading, in the realtime payload and in the UI — because a fabricated
 * coolant temperature that reads as real would send a mechanic looking for a
 * fault that does not exist.
 */
export const DeviceSimulationMode = {
  NORMAL: 'NORMAL',
  HIGH_RPM: 'HIGH_RPM',
  OVERHEATING: 'OVERHEATING',
  LOW_FUEL: 'LOW_FUEL',
  LOW_BATTERY: 'LOW_BATTERY',
  ENGINE_WARNING: 'ENGINE_WARNING',
  CUSTOM: 'CUSTOM',
  /** No engine block at all — the phone reports only what it can measure. */
  OFF: 'OFF',
} as const;
export type DeviceSimulationMode =
  (typeof DeviceSimulationMode)[keyof typeof DeviceSimulationMode];

export const DEVICE_SIMULATION_MODES = Object.values(
  DeviceSimulationMode,
) as DeviceSimulationMode[];

export interface SimulationProfile {
  mode: DeviceSimulationMode;
  label: string;
  /** What the profile is for, shown in the app so a tester picks correctly. */
  description: string;
  /** Idle floor and cruising ceiling, in RPM. */
  rpm: { idle: number; cruise: number } | null;
  fuelLevelPercent: number | null;
  coolantTemperatureC: number | null;
  batteryVoltage: number | null;
  engineLoadPercent: number | null;
  /** Trouble codes the profile raises, if any. */
  diagnostics: { code: string; description: string }[];
}

/**
 * A 24 V commercial-vehicle electrical system is assumed, so 27.3 V is healthy
 * and the low-battery profile sits below the alert threshold rather than at an
 * arbitrary number.
 */
export const DEVICE_SIMULATION_PROFILES: SimulationProfile[] = [
  {
    mode: DeviceSimulationMode.NORMAL,
    label: 'Normal',
    description: 'A healthy vehicle at working temperature.',
    rpm: { idle: 750, cruise: 1_850 },
    fuelLevelPercent: 64,
    coolantTemperatureC: 87,
    batteryVoltage: 27.3,
    engineLoadPercent: 42,
    diagnostics: [],
  },
  {
    mode: DeviceSimulationMode.HIGH_RPM,
    label: 'High RPM',
    description: 'Sustained high engine speed, for testing idling and load rules.',
    rpm: { idle: 900, cruise: 2_900 },
    fuelLevelPercent: 58,
    coolantTemperatureC: 94,
    batteryVoltage: 27.1,
    engineLoadPercent: 78,
    diagnostics: [],
  },
  {
    mode: DeviceSimulationMode.OVERHEATING,
    label: 'Overheating',
    description: 'Coolant above the safe range — raises the engine-temperature alert.',
    rpm: { idle: 800, cruise: 2_100 },
    fuelLevelPercent: 51,
    coolantTemperatureC: 112,
    batteryVoltage: 27.0,
    engineLoadPercent: 66,
    diagnostics: [],
  },
  {
    mode: DeviceSimulationMode.LOW_FUEL,
    label: 'Low fuel',
    description: 'Tank near empty, for testing the fuel-drop and refuel prompts.',
    rpm: { idle: 750, cruise: 1_700 },
    fuelLevelPercent: 7,
    coolantTemperatureC: 86,
    batteryVoltage: 27.2,
    engineLoadPercent: 38,
    diagnostics: [],
  },
  {
    mode: DeviceSimulationMode.LOW_BATTERY,
    label: 'Low battery',
    description: 'Charging-system fault — raises the low-voltage alert.',
    rpm: { idle: 700, cruise: 1_600 },
    fuelLevelPercent: 60,
    coolantTemperatureC: 84,
    batteryVoltage: 22.4,
    engineLoadPercent: 35,
    diagnostics: [],
  },
  {
    mode: DeviceSimulationMode.ENGINE_WARNING,
    label: 'Engine warning',
    description: 'A stored trouble code, for testing the diagnostic-fault path.',
    rpm: { idle: 820, cruise: 1_900 },
    fuelLevelPercent: 55,
    coolantTemperatureC: 91,
    batteryVoltage: 26.9,
    engineLoadPercent: 55,
    diagnostics: [
      { code: 'P0128', description: 'Coolant thermostat below regulating temperature.' },
    ],
  },
  {
    mode: DeviceSimulationMode.CUSTOM,
    label: 'Custom',
    description: 'Values entered by the tester.',
    rpm: null,
    fuelLevelPercent: null,
    coolantTemperatureC: null,
    batteryVoltage: null,
    engineLoadPercent: null,
    diagnostics: [],
  },
  {
    mode: DeviceSimulationMode.OFF,
    label: 'Off',
    description: 'No simulated engine data. Only GPS, motion and device health.',
    rpm: null,
    fuelLevelPercent: null,
    coolantTemperatureC: null,
    batteryVoltage: null,
    engineLoadPercent: null,
    diagnostics: [],
  },
];

const PROFILES_BY_MODE = new Map<DeviceSimulationMode, SimulationProfile>(
  DEVICE_SIMULATION_PROFILES.map((profile) => [profile.mode, profile]),
);

export function simulationProfile(
  mode: DeviceSimulationMode,
): SimulationProfile | undefined {
  return PROFILES_BY_MODE.get(mode);
}

// ---------------------------------------------------------------------------
// Views returned to the device
// ---------------------------------------------------------------------------

/** Everything the app needs to render its home screen (section 11). */
export interface DeviceIdentityView {
  deviceId: string;
  deviceIdentifier: string;
  provider: DeviceProvider;
  deviceType: DeviceType;
  role: DeviceRole;
  status: string;
  paired: boolean;
  organizationId: string | null;
  vehicle: {
    id: string;
    registrationNumber: string;
    vehicleType: string;
    assignedAt: string;
  } | null;
  cameras: { id: string; channel: number; position: string; label: string | null }[];
  lastSeenAt: string | null;
  lastTelemetryAt: string | null;
}

/** Server-owned settings the device must obey (sections 32 and 40). */
export interface DeviceConfigView {
  reportingIntervalSeconds: number;
  heartbeatIntervalSeconds: number;
  /** Whether the backend will issue a live-video publish ticket at all. */
  videoEnabled: boolean;
  /** Whether this environment accepts simulated engine data. */
  simulationAllowed: boolean;
  maxBatchSize: number;
  maxBufferedEvents: number;
  environment: string;
  serverTime: string;
}

export interface DeviceCommandView {
  id: string;
  type: DeviceCommandType;
  payload: Record<string, unknown> | null;
  issuedAt: string;
  expiresAt: string;
}

/** The device's own report on itself (section 29). */
export interface DeviceHealthSnapshot {
  batteryPercent: number | null;
  batteryCharging: boolean | null;
  networkType: DeviceNetworkType;
  gpsStatus: DeviceSubsystemStatus;
  cameraStatus: DeviceSubsystemStatus;
  bufferedEvents: number;
  appVersion: string | null;
}
