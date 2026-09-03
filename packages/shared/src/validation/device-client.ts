import { z } from 'zod';
import {
  DeviceCommandType,
  DeviceNetworkType,
  DeviceSubsystemStatus,
  DeviceType,
  SosType,
} from '../domain/enums';
import {
  DEVICE_BUFFER,
  DeviceSimulationMode,
  MAX_REPORTING_INTERVAL_SECONDS,
  MIN_REPORTING_INTERVAL_SECONDS,
} from '../domain/device-client';
import {
  latitudeSchema,
  longitudeSchema,
  optionalTrimmedString,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * The Saarthi Device wire contract.
 *
 * Everything in this file crosses the boundary between a phone somebody is
 * holding and Saarthi's own infrastructure, so it is written for the least
 * trusted caller in the product. Three rules shape it:
 *
 *  1. **The device never names its vehicle.** No schema here accepts a
 *     `vehicleId`. The gateway resolves it from the authenticated device's
 *     active assignment, so a compromised phone cannot write into another
 *     truck's history by editing a field.
 *  2. **Absent is not zero.** Every optional sensor value is genuinely optional;
 *     a phone that cannot read altitude omits it rather than sending 0.
 *  3. **Simulated data announces itself.** The engine block is a separate,
 *     explicitly-labelled object, and the mode that produced it travels with it.
 *
 * The Android client mirrors these shapes as Kotlin data classes. This file is
 * the source of truth for both sides.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Client-generated device identity.
 *
 * The app generates a random identity on first launch and keeps it in secure
 * storage. It is deliberately not derived from ANDROID_ID, the IMEI or any
 * other hardware identifier: those are spoofable, they are reused across
 * factory resets, and section 5 of the specification forbids depending on one.
 * The identity is a *claim*; the secret Saarthi issues in response is the
 * credential.
 */
export const deviceInstallationIdSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(16, 'The installation identifier is too short to be unique.')
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, 'Installation identifiers are URL-safe text.'),
  );

export const enrolDeviceSchema = z.object({
  /** Stable per-installation random identity, generated on the device. */
  installationId: deviceInstallationIdSchema,
  platform: z.enum(['ANDROID', 'IOS', 'OTHER']).default('ANDROID'),
  deviceModel: optionalTrimmedString(120),
  osVersion: optionalTrimmedString(60),
  appVersion: optionalTrimmedString(40),
  /**
   * What the operator intends this unit to be.
   *
   * App-based units only. A Saarthi Terminal enrols through exactly this
   * endpoint — it is a device like any other until an authorised person pairs
   * it — and declaring its own type here is what stops it redeeming a pairing
   * code issued for a test phone, and a test phone redeeming one issued for a
   * terminal. The check is enforced at redemption, not here.
   */
  deviceType: z
    .enum([
      DeviceType.MOBILE_TEST_DEVICE,
      DeviceType.VEHICLE_TERMINAL,
      DeviceType.DASHCAM,
      DeviceType.GPS_TRACKER,
    ])
    .default(DeviceType.MOBILE_TEST_DEVICE),
});
export type EnrolDeviceInput = z.infer<typeof enrolDeviceSchema>;

export const deviceTokenRequestSchema = z.object({
  deviceIdentifier: trimmedString(4, 64),
  secret: z.string().min(16).max(512),
});
export type DeviceTokenRequestInput = z.infer<typeof deviceTokenRequestSchema>;

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

/**
 * The payload encoded in the pairing QR.
 *
 * It carries a token and the API it belongs to, and nothing else. Section 7 is
 * explicit that it must not contain vehicle, driver or financial information —
 * a QR on a screen is photographed by whoever walks past, and everything the
 * pairing discloses is decided server-side when the token is redeemed.
 */
export const devicePairingPayloadSchema = z.object({
  /** Format marker, so a scanner can reject an unrelated QR immediately. */
  v: z.literal(1),
  kind: z.literal('saarthi.device.pair'),
  /** Where to redeem it. Lets one app serve development, staging and production. */
  api: z.string().url(),
  token: z.string().min(20).max(200),
});
export type DevicePairingPayload = z.infer<typeof devicePairingPayloadSchema>;

export const pairDeviceSchema = z.object({
  token: z.string().min(20).max(200),
  /** Refreshed at pair time so the fleet record shows what actually connected. */
  deviceModel: optionalTrimmedString(120),
  osVersion: optionalTrimmedString(60),
  appVersion: optionalTrimmedString(40),
});
export type PairDeviceInput = z.infer<typeof pairDeviceSchema>;

export const unpairDeviceFromDeviceSchema = z.object({
  reason: optionalTrimmedString(500),
});
export type UnpairDeviceFromDeviceInput = z.infer<typeof unpairDeviceFromDeviceSchema>;

/** Issued by the web dashboard: Vehicle → Hardware → Add Device. */
export const createPairingTokenSchema = z.object({
  deviceType: z
    .enum([
      DeviceType.MOBILE_TEST_DEVICE,
      DeviceType.VEHICLE_TERMINAL,
      DeviceType.DASHCAM,
      DeviceType.GPS_TRACKER,
    ])
    .default(DeviceType.MOBILE_TEST_DEVICE),
  /** Seconds. Bounded so a token cannot be made long-lived by mistake. */
  ttlSeconds: z.coerce.number().int().min(60).max(3_600).optional(),
  note: optionalTrimmedString(300),
});
export type CreatePairingTokenInput = z.infer<typeof createPairingTokenSchema>;

// ---------------------------------------------------------------------------
// Location and telemetry
// ---------------------------------------------------------------------------

/**
 * Idempotency key for one event.
 *
 * Generated on the device before the event is buffered, so a reading that is
 * uploaded, times out and is retried is stored once. Section 18 requires this;
 * a monotonic sequence number alone cannot express it, because an offline batch
 * is retried as a whole.
 */
export const deviceEventIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Event identifiers are URL-safe text.');

/**
 * One GPS fix.
 *
 * `latitude` and `longitude` are the only required fields. Everything else is a
 * value Android may or may not have at that moment — a fix indoors has no
 * bearing, a fix from a cold start has no speed — and a phone that invents them
 * would corrupt the speed series and the harsh-driving detection built on it.
 */
export const deviceLocationSchema = z.object({
  eventId: deviceEventIdSchema,
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  /** km/h. Android reports m/s; the app converts before sending. */
  speedKph: z.coerce.number().min(0).max(400).nullish(),
  /** Degrees clockwise from north. */
  heading: z.coerce.number().min(0).max(360).nullish(),
  altitude: z.coerce.number().min(-500).max(9_000).nullish(),
  /** Horizontal accuracy in metres, as Android reports it. */
  accuracy: z.coerce.number().min(0).max(10_000).nullish(),
  satellites: z.coerce.number().int().min(0).max(64).nullish(),
  /** When the *device* observed the fix, not when it managed to send it. */
  recordedAt: z.coerce.date(),
});
export type DeviceLocationInput = z.infer<typeof deviceLocationSchema>;

/** Phone motion sensors (section 22). Never presented as CAN data. */
export const deviceMotionSchema = z.object({
  /** g-force per axis, device frame. */
  accelerationX: z.coerce.number().min(-20).max(20).nullish(),
  accelerationY: z.coerce.number().min(-20).max(20).nullish(),
  accelerationZ: z.coerce.number().min(-20).max(20).nullish(),
  harshBraking: z.boolean().optional(),
  harshAcceleration: z.boolean().optional(),
  suddenMovement: z.boolean().optional(),
});
export type DeviceMotionInput = z.infer<typeof deviceMotionSchema>;

/**
 * The simulated engine block (section 23).
 *
 * A separate object from the real sensor data, carrying the mode that produced
 * it. The gateway stores every reading built from this with `simulated: true`,
 * and the dashboard labels it — the distinction survives all the way to the UI
 * rather than being asserted once and forgotten.
 */
export const deviceSimulatedVehicleDataSchema = z.object({
  mode: z.nativeEnum(DeviceSimulationMode),
  rpm: z.coerce.number().min(0).max(9_000).nullish(),
  engineLoad: z.coerce.number().min(0).max(100).nullish(),
  coolantTemperature: z.coerce.number().min(-40).max(200).nullish(),
  fuelLevel: z.coerce.number().min(0).max(100).nullish(),
  batteryVoltage: z.coerce.number().min(0).max(60).nullish(),
  throttlePosition: z.coerce.number().min(0).max(100).nullish(),
  odometerKm: z.coerce.number().min(0).max(5_000_000).nullish(),
  diagnostics: z
    .array(
      z.object({
        code: trimmedString(2, 16),
        description: optionalTrimmedString(300),
      }),
    )
    .max(10)
    .optional(),
});
export type DeviceSimulatedVehicleDataInput = z.infer<
  typeof deviceSimulatedVehicleDataSchema
>;

/**
 * Engine data the vehicle actually reported.
 *
 * A separate block from `simulated`, and that separation is the whole design.
 * Until an OBD adapter existed, the only engine values a phone could send were
 * invented, so the frame had one block and the gateway marked everything in it
 * as simulated. A terminal with an adapter fitted reads the same fields from the
 * ECU, and putting those through the simulated block would have been the exact
 * failure section 19 forbids — a measurement stored under a label that says it
 * was made up, or worse, the label quietly dropped so an invented reading and a
 * real one become indistinguishable a year later.
 *
 * Two blocks, two meanings, and a frame may carry either or both: a terminal can
 * be reading real coolant from the ECU while the simulator fills in a value the
 * vehicle does not expose. Every field lands in `metrics`; only the simulated
 * ones land in `simulatedMetrics`.
 */
export const deviceVehicleDataSchema = z.object({
  rpm: z.coerce.number().min(0).max(16_000).nullish(),
  engineLoad: z.coerce.number().min(0).max(100).nullish(),
  coolantTemperature: z.coerce.number().min(-40).max(215).nullish(),
  intakeTemperature: z.coerce.number().min(-40).max(215).nullish(),
  fuelLevel: z.coerce.number().min(0).max(100).nullish(),
  /** Litres per hour, straight from the ECU. */
  fuelRate: z.coerce.number().min(0).max(1_000).nullish(),
  throttlePosition: z.coerce.number().min(0).max(100).nullish(),
  batteryVoltage: z.coerce.number().min(0).max(60).nullish(),
  odometerKm: z.coerce.number().min(0).max(5_000_000).nullish(),
  /** Seventeen characters, or absent. A partial VIN is worse than none. */
  vin: z.string().trim().length(17).nullish(),
  diagnostics: z
    .array(
      z.object({
        code: trimmedString(2, 16),
        /*
         * Nullable, not merely optional.
         *
         * A generic OBD adapter reads the code and never the text for it, so a
         * client that fills the field with an explicit null is behaving
         * reasonably. `optionalTrimmedString` accepts a string or nothing at
         * all and rejects null — which would fail validation for the whole
         * frame and discard a perfectly good set of engine readings over a
         * cosmetic field.
         */
        description: optionalTrimmedString(300).nullable(),
      }),
    )
    .max(20)
    .optional(),
});
export type DeviceVehicleDataInput = z.infer<typeof deviceVehicleDataSchema>;

/** Radio and power state the phone measures about itself. */
export const deviceRadioHealthSchema = z.object({
  /** dBm, as Android reports cellular signal strength. */
  signalStrength: z.coerce.number().min(-150).max(0).nullish(),
  networkType: z.nativeEnum(DeviceNetworkType).optional(),
  batteryPercent: z.coerce.number().int().min(0).max(100).nullish(),
  batteryCharging: z.boolean().optional(),
});
export type DeviceRadioHealthInput = z.infer<typeof deviceRadioHealthSchema>;

/**
 * One complete frame from a phone.
 *
 * Real measurements and simulated ones are in separate branches on purpose, so
 * the adapter can mark the reading honestly without having to guess which
 * fields a phone could plausibly have produced.
 */
export const devicePhoneFrameSchema = z.object({
  eventId: deviceEventIdSchema,
  recordedAt: z.coerce.date(),
  /** Monotonic per-device counter, for replay rejection. */
  sequence: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  location: deviceLocationSchema.omit({ eventId: true, recordedAt: true }).optional(),
  motion: deviceMotionSchema.optional(),
  health: deviceRadioHealthSchema.optional(),
  /** Measured engine data, when an OBD adapter is fitted and answering. */
  vehicle: deviceVehicleDataSchema.optional(),
  simulated: deviceSimulatedVehicleDataSchema.optional(),
});
export type DevicePhoneFrame = z.infer<typeof devicePhoneFrameSchema>;

/** A batch upload — one frame, or a buffer replayed after an outage. */
export const deviceTelemetryBatchSchema = z.object({
  frames: z.array(devicePhoneFrameSchema).min(1).max(DEVICE_BUFFER.maxBatchSize),
});
export type DeviceTelemetryBatchInput = z.infer<typeof deviceTelemetryBatchSchema>;

export const deviceLocationBatchSchema = z.object({
  points: z.array(deviceLocationSchema).min(1).max(DEVICE_BUFFER.maxBatchSize),
});
export type DeviceLocationBatchInput = z.infer<typeof deviceLocationBatchSchema>;

// ---------------------------------------------------------------------------
// Heartbeat (section 29)
// ---------------------------------------------------------------------------

export const deviceHeartbeatSchema = z.object({
  batteryPercent: z.coerce.number().int().min(0).max(100).nullish(),
  batteryCharging: z.boolean().optional(),
  networkType: z.nativeEnum(DeviceNetworkType).default(DeviceNetworkType.UNKNOWN),
  gpsStatus: z.nativeEnum(DeviceSubsystemStatus).default(DeviceSubsystemStatus.UNKNOWN),
  cameraStatus: z.nativeEnum(DeviceSubsystemStatus).default(DeviceSubsystemStatus.UNKNOWN),
  /** How many events the device is still holding locally. */
  bufferedEvents: z.coerce.number().int().min(0).max(1_000_000).default(0),
  appVersion: optionalTrimmedString(40),
  /** Device clock, so a skewed phone is visible in support. */
  deviceTime: z.coerce.date().optional(),
});
export type DeviceHeartbeatInput = z.infer<typeof deviceHeartbeatSchema>;

// ---------------------------------------------------------------------------
// SOS (section 27)
// ---------------------------------------------------------------------------

/**
 * A device-raised emergency.
 *
 * No `vehicleId`, no `driverId`, no organization: all three are resolved from
 * the device's active assignment. Section 27 is explicit that recipients are
 * decided by the backend, and a phone that could name its own driver could name
 * somebody else's.
 */
export const deviceSosSchema = z.object({
  eventId: deviceEventIdSchema,
  type: z.nativeEnum(SosType),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  speedKph: z.coerce.number().min(0).max(400).nullish(),
  heading: z.coerce.number().min(0).max(360).nullish(),
  accuracy: z.coerce.number().min(0).max(10_000).nullish(),
  description: optionalTrimmedString(1_000),
  cameraAvailable: z.boolean().optional(),
  networkType: z.nativeEnum(DeviceNetworkType).optional(),
  batteryPercent: z.coerce.number().int().min(0).max(100).nullish(),
  triggeredAt: z.coerce.date().optional(),
});
export type DeviceSosInput = z.infer<typeof deviceSosSchema>;

// ---------------------------------------------------------------------------
// Commands (section 40)
// ---------------------------------------------------------------------------

export const issueDeviceCommandSchema = z.object({
  type: z.nativeEnum(DeviceCommandType),
  /** Command-specific arguments, validated per type by the service. */
  payload: z.record(z.unknown()).optional(),
  /** Seconds before an uncollected command is abandoned. */
  ttlSeconds: z.coerce.number().int().min(10).max(3_600).optional(),
});
export type IssueDeviceCommandInput = z.infer<typeof issueDeviceCommandSchema>;

export const acknowledgeDeviceCommandSchema = z.object({
  success: z.boolean(),
  result: z.record(z.unknown()).optional(),
  error: optionalTrimmedString(500),
});
export type AcknowledgeDeviceCommandInput = z.infer<
  typeof acknowledgeDeviceCommandSchema
>;

/** Arguments for CHANGE_REPORTING_INTERVAL, validated when the command is issued. */
export const changeReportingIntervalPayloadSchema = z.object({
  reportingIntervalSeconds: z.coerce
    .number()
    .int()
    .min(MIN_REPORTING_INTERVAL_SECONDS)
    .max(MAX_REPORTING_INTERVAL_SECONDS),
});

/** Arguments for START_CAMERA / STOP_CAMERA. */
export const cameraCommandPayloadSchema = z.object({
  cameraId: uuidSchema.optional(),
  channel: z.coerce.number().int().min(1).max(16).optional(),
});

// ---------------------------------------------------------------------------
// Video publishing (section 20)
// ---------------------------------------------------------------------------

export const devicePublishTicketSchema = z.object({
  /** Which of the device's registered channels is about to publish. */
  channel: z.coerce.number().int().min(1).max(16),
});
export type DevicePublishTicketInput = z.infer<typeof devicePublishTicketSchema>;
