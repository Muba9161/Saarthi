import { z } from 'zod';
import {
  AlertSeverity,
  DeviceProvider,
  DeviceStatus,
  DeviceType,
  GeofenceKind,
  TelemetryAlertStatus,
  TelemetryAlertType,
  TelemetryMetric,
} from '../domain/enums';
import {
  csvEnum,
  latitudeSchema,
  longitudeSchema,
  optionalTrimmedString,
  paginationSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Hardware device and telemetry contracts.
 *
 * Two audiences share this file and they are not equally trusted:
 *
 *  * A signed-in operator registers and assigns devices — normal RBAC applies.
 *  * A *device* posts telemetry to the gateway with its own credentials. Those
 *    payloads are hostile input: anything a device sends is bounded, coerced and
 *    range-checked before it is allowed near a business table.
 */

// ---------------------------------------------------------------------------
// Device registration
// ---------------------------------------------------------------------------

/** Printed device identifier. Uppercased so lookups are stable. */
export const deviceIdentifierSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(
    z
      .string()
      .min(4, 'Enter the device identifier printed on the unit.')
      .max(64)
      .regex(
        /^[A-Z0-9][A-Z0-9_-]*$/,
        'Device identifiers use letters, digits, hyphens and underscores.',
      ),
  );

/** 15-digit IMEI, validated with the Luhn check digit. */
export const imeiSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ''))
  .pipe(z.string().length(15, 'An IMEI is exactly 15 digits.'))
  .refine((imei) => {
    let sum = 0;
    for (let index = 0; index < 15; index += 1) {
      let digit = Number(imei[index]);
      // Luhn doubles every second digit from the right; for a 15-digit IMEI
      // that is every odd index counting from the left.
      if (index % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    return sum % 10 === 0;
  }, 'That IMEI fails its checksum — re-read the number from the device.');

export const registerDeviceSchema = z.object({
  deviceIdentifier: deviceIdentifierSchema,
  provider: z.nativeEnum(DeviceProvider),
  deviceType: z.nativeEnum(DeviceType).default(DeviceType.OBD_TELEMATICS),
  serialNumber: trimmedString(3, 80),
  imei: imeiSchema.optional(),
  manufacturer: optionalTrimmedString(80),
  model: optionalTrimmedString(80),
  firmwareVersion: optionalTrimmedString(40),
  /** SIM details are stored masked and never returned in full. */
  simIccid: optionalTrimmedString(30),
  simMsisdn: optionalTrimmedString(20),
  simOperator: optionalTrimmedString(60),
  notes: optionalTrimmedString(2000),
  installedAt: z.coerce.date().optional(),
  /** Metrics this unit is expected to report on the target vehicle. */
  supportedMetrics: z.array(z.nativeEnum(TelemetryMetric)).max(30).default([]),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const updateDeviceSchema = registerDeviceSchema
  .omit({ deviceIdentifier: true, provider: true })
  .partial()
  .extend({ status: z.nativeEnum(DeviceStatus).optional() });
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;

export const deviceListQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(120),
  provider: csvEnum([
    DeviceProvider.FREEMATICS,
    DeviceProvider.MOCK,
    DeviceProvider.GENERIC_GPS,
    DeviceProvider.GENERIC_OBD,
    DeviceProvider.GENERIC_CAN,
  ]),
  status: csvEnum([
    DeviceStatus.REGISTERED,
    DeviceStatus.ACTIVE,
    DeviceStatus.OFFLINE,
    DeviceStatus.INACTIVE,
    DeviceStatus.MAINTENANCE,
    DeviceStatus.RETIRED,
    DeviceStatus.SUSPENDED,
  ]),
  /** `true` = only devices on a vehicle, `false` = only spares. */
  assigned: z.coerce.boolean().optional(),
  vehicleId: uuidSchema.optional(),
  sortBy: z.enum(['serialNumber', 'status', 'lastSeenAt', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type DeviceListQuery = z.infer<typeof deviceListQuerySchema>;

export const assignDeviceSchema = z.object({
  vehicleId: uuidSchema,
  note: optionalTrimmedString(1000),
  installedAt: z.coerce.date().optional(),
});
export type AssignDeviceInput = z.infer<typeof assignDeviceSchema>;

export const unassignDeviceSchema = z.object({
  reason: optionalTrimmedString(1000),
});
export type UnassignDeviceInput = z.infer<typeof unassignDeviceSchema>;

// ---------------------------------------------------------------------------
// Gateway payload — untrusted device input
// ---------------------------------------------------------------------------

/**
 * The vendor-neutral gateway envelope.
 *
 * A device posts this; the adapter named by `provider` then interprets `payload`
 * according to that vendor's format. Keeping the envelope typed and the payload
 * opaque is what confines vendor-specific parsing to the adapter — nothing
 * downstream ever sees a Freematics field name.
 */
export const gatewayEnvelopeSchema = z.object({
  deviceId: deviceIdentifierSchema,
  /** Device clock. Validated against server time before anything is stored. */
  timestamp: z.coerce.date().optional(),
  /** Monotonic counter used for replay detection. */
  sequence: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  /** One reading, or a batch collected while the device had no signal. */
  payload: z.union([z.record(z.unknown()), z.array(z.record(z.unknown())).max(200)]),
});
export type GatewayEnvelope = z.infer<typeof gatewayEnvelopeSchema>;

/**
 * The provider-agnostic telemetry format, accepted directly for convenience by
 * the simulator, tests and any integrator who would rather normalise on their
 * side than write an adapter. Bounds live in `domain/telemetry.ts` and are
 * re-checked by the gateway regardless of what passes here.
 */
export const genericTelemetrySchema = z.object({
  recordedAt: z.coerce.date().optional(),
  sequence: z.coerce.number().int().min(0).optional(),
  location: z
    .object({
      latitude: latitudeSchema,
      longitude: longitudeSchema,
      speedKph: z.coerce.number().min(0).max(400).optional(),
      heading: z.coerce.number().min(0).max(360).optional(),
      altitude: z.coerce.number().min(-500).max(9000).optional(),
      accuracy: z.coerce.number().min(0).max(10_000).optional(),
      satellites: z.coerce.number().int().min(0).max(64).optional(),
    })
    .optional(),
  vehicleData: z
    .object({
      rpm: z.coerce.number().min(0).max(20_000).optional(),
      engineLoad: z.coerce.number().min(0).max(100).optional(),
      coolantTemperature: z.coerce.number().min(-60).max(300).optional(),
      intakeTemperature: z.coerce.number().min(-60).max(300).optional(),
      fuelLevel: z.coerce.number().min(0).max(100).optional(),
      fuelRate: z.coerce.number().min(0).max(500).optional(),
      throttlePosition: z.coerce.number().min(0).max(100).optional(),
      batteryVoltage: z.coerce.number().min(0).max(100).optional(),
      odometerKm: z.coerce.number().min(0).max(10_000_000).optional(),
      vin: optionalTrimmedString(20),
    })
    .optional(),
  motion: z
    .object({
      accelerationX: z.coerce.number().min(-20).max(20).optional(),
      accelerationY: z.coerce.number().min(-20).max(20).optional(),
      accelerationZ: z.coerce.number().min(-20).max(20).optional(),
      harshBraking: z.boolean().optional(),
      harshAcceleration: z.boolean().optional(),
      suddenMovement: z.boolean().optional(),
    })
    .optional(),
  deviceHealth: z
    .object({
      temperature: z.coerce.number().min(-60).max(150).optional(),
      signalStrength: z.coerce.number().min(-150).max(0).optional(),
      firmwareVersion: optionalTrimmedString(40),
    })
    .optional(),
  diagnostics: z
    .array(
      z.object({
        code: trimmedString(2, 16),
        description: optionalTrimmedString(300),
        confirmed: z.boolean().default(false),
      }),
    )
    .max(20)
    .optional(),
});
export type GenericTelemetryInput = z.infer<typeof genericTelemetrySchema>;

// ---------------------------------------------------------------------------
// Telemetry queries
// ---------------------------------------------------------------------------

export const telemetryHistoryQuerySchema = paginationSchema.extend({
  vehicleId: uuidSchema.optional(),
  deviceId: uuidSchema.optional(),
  /** Return one reading per interval instead of every stored point. */
  intervalSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type TelemetryHistoryQuery = z.infer<typeof telemetryHistoryQuerySchema>;

export const telemetryAlertListQuerySchema = paginationSchema.extend({
  vehicleId: uuidSchema.optional(),
  deviceId: uuidSchema.optional(),
  driverId: uuidSchema.optional(),
  type: csvEnum([
    TelemetryAlertType.OVERSPEED,
    TelemetryAlertType.HARSH_BRAKING,
    TelemetryAlertType.HARSH_ACCELERATION,
    TelemetryAlertType.EXCESSIVE_IDLING,
    TelemetryAlertType.ENGINE_TEMPERATURE,
    TelemetryAlertType.LOW_VOLTAGE,
    TelemetryAlertType.DEVICE_OFFLINE,
    TelemetryAlertType.ROUTE_DEVIATION,
    TelemetryAlertType.GEOFENCE_BREACH,
    TelemetryAlertType.DIAGNOSTIC_FAULT,
    TelemetryAlertType.FUEL_DROP,
    TelemetryAlertType.UNUSUAL_BEHAVIOUR,
  ]),
  severity: csvEnum([AlertSeverity.INFO, AlertSeverity.WARNING, AlertSeverity.CRITICAL]),
  status: csvEnum([
    TelemetryAlertStatus.OPEN,
    TelemetryAlertStatus.ACKNOWLEDGED,
    TelemetryAlertStatus.RESOLVED,
    TelemetryAlertStatus.DISMISSED,
  ]),
  openOnly: z.coerce.boolean().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type TelemetryAlertListQuery = z.infer<typeof telemetryAlertListQuerySchema>;

export const updateTelemetryAlertSchema = z.object({
  status: z.enum([
    TelemetryAlertStatus.ACKNOWLEDGED,
    TelemetryAlertStatus.RESOLVED,
    TelemetryAlertStatus.DISMISSED,
  ]),
  note: optionalTrimmedString(1000),
});
export type UpdateTelemetryAlertInput = z.infer<typeof updateTelemetryAlertSchema>;

export const upsertAlertRuleSchema = z.object({
  type: z.nativeEnum(TelemetryAlertType),
  enabled: z.boolean().default(true),
  threshold: z.coerce.number().optional(),
  severity: z.nativeEnum(AlertSeverity).optional(),
  cooldownSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  /** Limit the rule to one vehicle; omit for the whole fleet. */
  vehicleId: uuidSchema.optional(),
});
export type UpsertAlertRuleInput = z.infer<typeof upsertAlertRuleSchema>;

// ---------------------------------------------------------------------------
// Geofences
// ---------------------------------------------------------------------------

export const upsertGeofenceSchema = z.object({
  name: trimmedString(2, 160),
  kind: z.nativeEnum(GeofenceKind).default(GeofenceKind.INCLUSION),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radiusMeters: z.coerce.number().int().min(50).max(200_000),
  enabled: z.boolean().default(true),
  vehicleId: uuidSchema.optional(),
  notes: optionalTrimmedString(1000),
});
export type UpsertGeofenceInput = z.infer<typeof upsertGeofenceSchema>;

// ---------------------------------------------------------------------------
// Mock device simulator
// ---------------------------------------------------------------------------

/**
 * Drives the mock device. It emits through the *same* gateway, adapter registry
 * and rule engine as physical hardware — the only difference is which adapter
 * parses the payload — so a dashboard that works here works with a real unit.
 */
export const startMockDeviceSchema = z.object({
  deviceId: uuidSchema,
  /** Seconds between readings. */
  intervalSeconds: z.coerce.number().int().min(1).max(300).default(5),
  /** Faults to inject so the alert and score paths can be demonstrated. */
  scenario: z
    .enum(['NORMAL', 'OVERSPEED', 'HARSH_DRIVING', 'OVERHEATING', 'LOW_VOLTAGE', 'FAULT_CODE'])
    .default('NORMAL'),
  /** Stop automatically after this many readings. */
  maxReadings: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type StartMockDeviceInput = z.infer<typeof startMockDeviceSchema>;
